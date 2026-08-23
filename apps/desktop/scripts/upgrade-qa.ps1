param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$Fixture,
  [Parameter(Mandatory=$true)][string]$Report
)

$ErrorActionPreference = "Stop"
$Version = "0.2.0"
$Control = Join-Path $env:RUNNER_TEMP "selfrelay-upgrade-qa"
$LegacyDir = Join-Path $Control "legacy-install"
$LegacyExe = Join-Path $LegacyDir "selfrelay-desktop-core.exe"
$DataDir = Join-Path $env:LOCALAPPDATA "com.veltira.selfrelay"
$Database = Join-Path $DataDir "selfrelay.db"

Remove-Item $Control -Force -Recurse -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Control, $LegacyDir, $DataDir | Out-Null
Copy-Item $Fixture $LegacyExe -Force

# Represent an installed 0.1.1 data store with a real unresolved checkpoint.
$CreateDb = @'
import sqlite3, sys, os
path=sys.argv[1]
os.makedirs(os.path.dirname(path), exist_ok=True)
if os.path.exists(path): os.remove(path)
c=sqlite3.connect(path)
c.executescript("""
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL);
INSERT INTO schema_migrations VALUES(1,0); INSERT INTO schema_migrations VALUES(2,0);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES('tracking_paused','0');
INSERT INTO settings VALUES('desktop_onboarding_completed','1');
CREATE TABLE tracking_rules(id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, application_id TEXT NOT NULL, context_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at_ms INTEGER NOT NULL, application_name TEXT, executable_path TEXT);
INSERT INTO tracking_rules(scope,application_id,context_id,enabled,created_at_ms,application_name,executable_path) VALUES('application','app:notepad.exe',NULL,1,1,'Notepad','C:\\Windows\\System32\\notepad.exe');
CREATE TABLE active_context_journal(context_id TEXT PRIMARY KEY, application_id TEXT NOT NULL, state TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);
CREATE TABLE checkpoints(id INTEGER PRIMARY KEY AUTOINCREMENT, application_id TEXT NOT NULL, application_name TEXT NOT NULL, context_id TEXT NOT NULL, context_label TEXT NOT NULL, text TEXT NOT NULL, created_at_ms INTEGER NOT NULL, resolved_at_ms INTEGER);
INSERT INTO checkpoints(application_id,application_name,context_id,context_label,text,created_at_ms,resolved_at_ms) VALUES('app:notepad.exe','Notepad','app:notepad.exe','Notepad','checkpoint-preserved-from-0.1.1',12345,NULL);
CREATE INDEX idx_checkpoints_context_pending ON checkpoints(context_id, resolved_at_ms, created_at_ms);
""")
c.commit(); c.close()
'@
python -c $CreateDb $Database
if ($LASTEXITCODE -ne 0) { throw "Could not create legacy schema v2 database" }

# Run the legacy GUI fixture under the exact historical process filename.
$Legacy = Start-Process -FilePath $LegacyExe -ArgumentList @("--legacy-upgrade", "--control", $Control) -PassThru
$Deadline = (Get-Date).AddSeconds(20)
while (-not (Test-Path (Join-Path $Control "legacy-ready.txt"))) {
  if ((Get-Date) -gt $Deadline) { throw "Legacy SelfRelay fixture never became ready" }
  Start-Sleep -Milliseconds 100
}
if ($Legacy.HasExited) { throw "Legacy SelfRelay exited before upgrade began" }

# Install the actual 0.2.0 NSIS package while the old process owns a SelfRelay window.
$Install = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($Install.ExitCode -ne 0) { throw "0.2.0 silent install failed with $($Install.ExitCode)" }
$Legacy.Refresh()
if (-not $Legacy.HasExited) { throw "Installer left the old selfrelay-desktop-core.exe process running" }
if (-not (Test-Path (Join-Path $Control "legacy-closed.txt"))) { throw "Legacy process did not leave through its native message loop" }

$Candidates = Get-ChildItem $env:LOCALAPPDATA -Filter "SelfRelay.exe" -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike "*$Control*" } |
  Sort-Object LastWriteTimeUtc -Descending
$NewExe = $Candidates | Select-Object -First 1
if (-not $NewExe) { throw "Installed SelfRelay.exe could not be located" }
if (Test-Path (Join-Path $NewExe.DirectoryName "selfrelay-desktop-core.exe")) { throw "Historical executable survived inside new install directory" }

# PE gate on the executable the installer actually placed.
function Get-PESubsystem([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  $optionalHeader = $peOffset + 24
  return [BitConverter]::ToUInt16($bytes, $optionalHeader + 68)
}
$InstalledSubsystem = Get-PESubsystem $NewExe.FullName
if ($InstalledSubsystem -ne 2) { throw "Installed SelfRelay.exe is not Windows GUI subsystem: $InstalledSubsystem" }

# Launch the installed product. This is the code path that performs the real DB migration.
$NewProcess = Start-Process -FilePath $NewExe.FullName -PassThru
$Deadline = (Get-Date).AddSeconds(20)
$MigrationOk = $false
while ((Get-Date) -lt $Deadline) {
  $VerifyDb = @'
import sqlite3, sys
c=sqlite3.connect(sys.argv[1])
version=c.execute('select coalesce(max(version),0) from schema_migrations').fetchone()[0]
row=c.execute("select text, workset_id, audio_path, transcript from checkpoints where text='checkpoint-preserved-from-0.1.1'").fetchone()
print(f'{version}|{row!r}')
raise SystemExit(0 if version == 3 and row and row[0] == 'checkpoint-preserved-from-0.1.1' and row[1:] == (None,None,None) else 2)
'@
  python -c $VerifyDb $Database 2>$null
  if ($LASTEXITCODE -eq 0) { $MigrationOk = $true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $MigrationOk) { throw "0.2.0 did not migrate/preserve legacy SQLite v2 data" }
if ($NewProcess.HasExited) { throw "Installed SelfRelay.exe terminated unexpectedly after launch" }

# Single-instance: launching SelfRelay again must not create a second resident process.
$Before = @(Get-Process -Name "SelfRelay" -ErrorAction SilentlyContinue).Count
$Second = Start-Process -FilePath $NewExe.FullName -PassThru
Start-Sleep -Seconds 2
$After = @(Get-Process -Name "SelfRelay" -ErrorAction SilentlyContinue).Count
if ($Before -ne 1 -or $After -ne 1) { throw "Single-instance gate failed: before=$Before after=$After" }

# The running new app is intentionally closed by reinstalling the same package,
# proving the updater can also replace the final process name without stale UI.
$Reinstall = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($Reinstall.ExitCode -ne 0) { throw "Reinstall over running SelfRelay.exe failed" }
Start-Sleep -Milliseconds 600
if (@(Get-Process -Name "SelfRelay" -ErrorAction SilentlyContinue).Count -ne 0) { throw "Reinstall left a stale SelfRelay.exe resident" }

# Version probe starts the exact installed GUI binary and exits without a console.
$VersionFile = Join-Path $Control "version.txt"
$Probe = Start-Process -FilePath $NewExe.FullName -ArgumentList @("--selfrelay-version-file", $VersionFile) -PassThru -Wait
if ($Probe.ExitCode -ne 0 -or -not (Test-Path $VersionFile)) { throw "Installed version probe failed" }
$InstalledVersion = (Get-Content $VersionFile -Raw).Trim()
if ($InstalledVersion -ne $Version) { throw "Installed code is stale: expected $Version got $InstalledVersion" }

$Signature = Get-AuthenticodeSignature $NewExe.FullName
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\SelfRelay"
$Uninstaller = Get-ChildItem $NewExe.DirectoryName -Filter "uninstall*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $Uninstaller) { throw "SelfRelay uninstaller is missing" }

# Verify uninstall removes program/autostart but preserves user data.
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SelfRelay" -Value "`"$($NewExe.FullName)`" --autostart" -Force
$Uninstall = Start-Process -FilePath $Uninstaller.FullName -ArgumentList "/S" -PassThru -Wait
if ($Uninstall.ExitCode -ne 0) { throw "SelfRelay uninstall failed: $($Uninstall.ExitCode)" }
if (Test-Path $NewExe.FullName) { throw "Uninstall left SelfRelay.exe installed" }
if (Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SelfRelay" -ErrorAction SilentlyContinue) { throw "Uninstall left SelfRelay autostart entry" }
if (-not (Test-Path $Database)) { throw "Uninstall unexpectedly deleted local user data" }

$Lines = @(
  "legacy_process_name=selfrelay-desktop-core.exe"
  "legacy_running_before_install=PASS"
  "legacy_process_closed_by_installer=PASS"
  "installed_binary_name=SelfRelay.exe"
  "historical_binary_removed=PASS"
  "installed_pe_subsystem=$InstalledSubsystem"
  "installed_version=$InstalledVersion"
  "new_running_process_closed_on_reinstall=PASS"
  "single_instance=PASS"
  "sqlite_v2_to_v3_preserves_checkpoint=PASS"
  "uninstall_removes_binary=PASS"
  "uninstall_removes_autostart=PASS"
  "uninstall_preserves_local_data=PASS"
  "installed_authenticode=$($Signature.Status)"
  "start_menu_folder_seen=$(Test-Path $StartMenu)"
)
$Lines | Set-Content $Report -Encoding utf8
$Lines | ForEach-Object { Write-Host $_ }
