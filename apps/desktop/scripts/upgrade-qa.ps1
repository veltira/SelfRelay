param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$Fixture,
  [Parameter(Mandatory=$true)][string]$Report
)

$ErrorActionPreference = "Stop"
$Version = "0.2.3"
$Control = Join-Path $env:RUNNER_TEMP "selfrelay-upgrade-qa"
$LegacyDir = Join-Path $Control "legacy-0.2.1-install"
$LegacyExe = Join-Path $LegacyDir "SelfRelay.exe"
$DataDir = Join-Path $env:LOCALAPPDATA "com.veltira.selfrelay"
$Database = Join-Path $DataDir "selfrelay.db"

Remove-Item $Control -Force -Recurse -ErrorAction SilentlyContinue
Remove-Item $DataDir -Force -Recurse -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Control, $LegacyDir, $DataDir | Out-Null
Copy-Item $Fixture $LegacyExe -Force

# Reproduce the persistence shape left by 0.2.1: schema v3 plus the path
# identity migration (v4) and durable pending-capture/diagnostic tables (v5).
$CreateDb = @'
import sqlite3, sys, os
path=sys.argv[1]
os.makedirs(os.path.dirname(path), exist_ok=True)
if os.path.exists(path): os.remove(path)
c=sqlite3.connect(path)
app_id='path:c:\\windows\\system32\\notepad.exe'
c.executescript("""
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL);
INSERT INTO schema_migrations VALUES(1,0); INSERT INTO schema_migrations VALUES(2,0); INSERT INTO schema_migrations VALUES(3,0); INSERT INTO schema_migrations VALUES(4,0); INSERT INTO schema_migrations VALUES(5,0);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES('tracking_paused','0');
INSERT INTO settings VALUES('desktop_onboarding_completed','1');
INSERT INTO settings VALUES('launch_at_startup','0');
CREATE TABLE tracking_rules(id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, application_id TEXT NOT NULL, context_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at_ms INTEGER NOT NULL, application_name TEXT, executable_path TEXT);
CREATE TABLE active_context_journal(context_id TEXT PRIMARY KEY, application_id TEXT NOT NULL, state TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);
CREATE TABLE checkpoints(id INTEGER PRIMARY KEY AUTOINCREMENT, application_id TEXT NOT NULL, application_name TEXT NOT NULL, context_id TEXT NOT NULL, context_label TEXT NOT NULL, text TEXT NOT NULL, created_at_ms INTEGER NOT NULL, resolved_at_ms INTEGER, workset_id TEXT, audio_path TEXT, transcript TEXT);
CREATE INDEX idx_checkpoints_context_pending ON checkpoints(context_id, resolved_at_ms, created_at_ms);
CREATE TABLE worksets(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
CREATE TABLE workset_applications(workset_id TEXT NOT NULL, application_id TEXT NOT NULL, PRIMARY KEY(workset_id, application_id), FOREIGN KEY(workset_id) REFERENCES worksets(id) ON DELETE CASCADE);
CREATE TABLE pending_captures(id TEXT PRIMARY KEY, application_id TEXT NOT NULL, application_name TEXT NOT NULL, context_id TEXT NOT NULL, context_label TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
CREATE INDEX idx_pending_captures_order ON pending_captures(created_at_ms, id);
CREATE TABLE desktop_diagnostics(id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, detail TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
""")
c.execute("INSERT INTO tracking_rules(scope,application_id,context_id,enabled,created_at_ms,application_name,executable_path) VALUES('application',?,NULL,1,1,'Notepad','C:\\Windows\\System32\\notepad.exe')", (app_id,))
c.execute("INSERT INTO checkpoints(application_id,application_name,context_id,context_label,text,created_at_ms,resolved_at_ms,workset_id,audio_path,transcript) VALUES(?,'Notepad',?,'Notepad','checkpoint-preserved-from-0.2.1',12345,NULL,NULL,NULL,NULL)", (app_id, app_id))
c.execute("INSERT INTO worksets VALUES('ws:upgrade','Upgrade project',1,1)")
c.execute("INSERT INTO workset_applications VALUES('ws:upgrade',?)", (app_id,))
c.execute("INSERT INTO pending_captures VALUES('capture:upgrade-0.2.1',?,'Notepad',?,'Notepad',12346)", (app_id, app_id))
c.commit(); c.close()
'@
python -c $CreateDb $Database
if ($LASTEXITCODE -ne 0) { throw "Could not create 0.2.1 persistence database" }

# Represent a resident 0.2.1 GUI process under the final executable name.
$Legacy = Start-Process -FilePath $LegacyExe -ArgumentList @("--legacy-upgrade", "--control", $Control) -PassThru
$Deadline = (Get-Date).AddSeconds(20)
while (-not (Test-Path (Join-Path $Control "legacy-ready.txt"))) {
  if ((Get-Date) -gt $Deadline) { throw "0.2.1 SelfRelay fixture never became ready" }
  Start-Sleep -Milliseconds 100
}
if ($Legacy.HasExited) { throw "0.2.1 SelfRelay exited before upgrade began" }

$Install = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($Install.ExitCode -ne 0) { throw "0.2.3 silent install failed with $($Install.ExitCode)" }
$Legacy.Refresh()
if (-not $Legacy.HasExited) { throw "0.2.3 installer left the old SelfRelay.exe process running" }
if (-not (Test-Path (Join-Path $Control "legacy-closed.txt"))) { throw "Old process did not leave through its native message loop" }

$Candidates = Get-ChildItem $env:LOCALAPPDATA -Filter "SelfRelay.exe" -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike "*$Control*" } | Sort-Object LastWriteTimeUtc -Descending
$NewExe = $Candidates | Select-Object -First 1
if (-not $NewExe) { throw "Installed SelfRelay.exe could not be located" }
if (Test-Path (Join-Path $NewExe.DirectoryName "selfrelay-desktop-core.exe")) { throw "Historical executable survived inside new install directory" }

function Get-PESubsystem([string]$Path) {
  $bytes = [System.IO.File]::ReadAllBytes($Path); $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  return [BitConverter]::ToUInt16($bytes, $peOffset + 24 + 68)
}
$InstalledSubsystem = Get-PESubsystem $NewExe.FullName
if ($InstalledSubsystem -ne 2) { throw "Installed SelfRelay.exe is not Windows GUI subsystem: $InstalledSubsystem" }

# Real 0.2.3 startup must preserve the exact 0.2.1 selection, settings,
# workset, checkpoint and durable pending-capture row.
$NewProcess = Start-Process -FilePath $NewExe.FullName -PassThru
$Deadline = (Get-Date).AddSeconds(20); $MigrationOk = $false
while ((Get-Date) -lt $Deadline) {
  $VerifyDb = @'
import sqlite3, sys
c=sqlite3.connect(sys.argv[1])
version=c.execute('select coalesce(max(version),0) from schema_migrations').fetchone()[0]
checkpoint=c.execute("select application_id,context_id,text from checkpoints where text='checkpoint-preserved-from-0.2.1'").fetchone()
tracked=c.execute("select application_id,application_name,executable_path from tracking_rules where enabled=1").fetchone()
member=c.execute("select application_id from workset_applications where workset_id='ws:upgrade'").fetchone()
pending=c.execute("select id,application_id,context_id from pending_captures where id='capture:upgrade-0.2.1'").fetchone()
settings=dict(c.execute("select key,value from settings where key in ('tracking_paused','desktop_onboarding_completed','launch_at_startup')"))
ok=(version>=5 and checkpoint and tracked and member and pending and checkpoint[2]=='checkpoint-preserved-from-0.2.1' and tracked[1]=='Notepad' and tracked[2].lower().endswith('notepad.exe') and tracked[0]==checkpoint[0]==checkpoint[1]==member[0]==pending[1]==pending[2] and settings=={'tracking_paused':'0','desktop_onboarding_completed':'1','launch_at_startup':'0'})
print(f'version={version} tracked={tracked} checkpoint={checkpoint} member={member} pending={pending} settings={settings}')
raise SystemExit(0 if ok else 2)
'@
  python -c $VerifyDb $Database 2>$null
  if ($LASTEXITCODE -eq 0) { $MigrationOk = $true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $MigrationOk) { throw "0.2.3 did not preserve 0.2.1 selections, settings, worksets, checkpoint and pending-capture data" }
if ($NewProcess.HasExited) { throw "Installed SelfRelay.exe terminated unexpectedly after launch" }

$Before = @(Get-Process -Name "SelfRelay" -ErrorAction SilentlyContinue).Count
$Second = Start-Process -FilePath $NewExe.FullName -PassThru
Start-Sleep -Seconds 2
$After = @(Get-Process -Name "SelfRelay" -ErrorAction SilentlyContinue).Count
if ($Before -ne 1 -or $After -ne 1) { throw "Single-instance gate failed: before=$Before after=$After" }

$Reinstall = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($Reinstall.ExitCode -ne 0) { throw "Reinstall over running SelfRelay.exe failed" }
Start-Sleep -Milliseconds 600
if (@(Get-Process -Name "SelfRelay" -ErrorAction SilentlyContinue).Count -ne 0) { throw "Reinstall left a stale SelfRelay.exe resident" }

$VersionFile = Join-Path $Control "version.txt"
$Probe = Start-Process -FilePath $NewExe.FullName -ArgumentList @("--selfrelay-version-file", $VersionFile) -PassThru -Wait
if ($Probe.ExitCode -ne 0 -or -not (Test-Path $VersionFile)) { throw "Installed version probe failed" }
$InstalledVersion = (Get-Content $VersionFile -Raw).Trim()
if ($InstalledVersion -ne $Version) { throw "Installed code is stale: expected $Version got $InstalledVersion" }

$Signature = Get-AuthenticodeSignature $NewExe.FullName
$StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\SelfRelay"
$Uninstaller = Get-ChildItem $NewExe.DirectoryName -Filter "uninstall*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $Uninstaller) { throw "SelfRelay uninstaller is missing" }

Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SelfRelay" -Value "`"$($NewExe.FullName)`" --autostart" -Force
$Uninstall = Start-Process -FilePath $Uninstaller.FullName -ArgumentList "/S" -PassThru -Wait
if ($Uninstall.ExitCode -ne 0) { throw "SelfRelay uninstall failed: $($Uninstall.ExitCode)" }
if (Test-Path $NewExe.FullName) { throw "Uninstall left SelfRelay.exe installed" }
if (Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SelfRelay" -ErrorAction SilentlyContinue) { throw "Uninstall left SelfRelay autostart entry" }
if (-not (Test-Path $Database)) { throw "Uninstall unexpectedly deleted local user data" }

$Lines = @(
  "upgrade_from=0.2.1"
  "legacy_process_name=SelfRelay.exe"
  "legacy_running_before_install=PASS"
  "legacy_process_closed_by_installer=PASS"
  "installed_binary_name=SelfRelay.exe"
  "installed_pe_subsystem=$InstalledSubsystem"
  "installed_version=$InstalledVersion"
  "selection_preserved=PASS"
  "settings_preserved=PASS"
  "workset_membership_preserved=PASS"
  "checkpoint_preserved=PASS"
  "pending_capture_preserved=PASS"
  "new_running_process_closed_on_reinstall=PASS"
  "single_instance=PASS"
  "uninstall_removes_binary=PASS"
  "uninstall_removes_autostart=PASS"
  "uninstall_preserves_local_data=PASS"
  "installed_authenticode=$($Signature.Status)"
  "start_menu_folder_seen=$(Test-Path $StartMenu)"
)
$Lines | Set-Content $Report -Encoding utf8
$Lines | ForEach-Object { Write-Host $_ }
