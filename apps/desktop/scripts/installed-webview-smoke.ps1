param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$Report
)

$ErrorActionPreference = "Stop"
$Control = Join-Path $env:RUNNER_TEMP "selfrelay-installed-webview-smoke"
$SmokeDir = Join-Path $Control "runtime"
Remove-Item $Control -Force -Recurse -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $SmokeDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $Report -Parent) | Out-Null

$Install = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($Install.ExitCode -ne 0) { throw "0.2.2 silent install failed before installed WebView smoke: $($Install.ExitCode)" }

$Candidates = Get-ChildItem $env:LOCALAPPDATA -Filter "SelfRelay.exe" -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike "*$Control*" } |
  Sort-Object LastWriteTimeUtc -Descending
$SelfRelay = $Candidates | Select-Object -First 1
if (-not $SelfRelay) { throw "Installed SelfRelay.exe could not be located for WebView runtime smoke" }

$Process = Start-Process -FilePath $SelfRelay.FullName -ArgumentList @("--selfrelay-webview-smoke-dir", $SmokeDir) -PassThru
$RuntimeReport = Join-Path $SmokeDir "runtime-smoke.txt"
$Expected = Join-Path $SmokeDir "expected.txt"
$CaptureReady = Join-Path $SmokeDir "capture-ready.txt"
$RecoveryReady = Join-Path $SmokeDir "recovery-ready.txt"
$Deadline = (Get-Date).AddSeconds(45)
while (-not (Test-Path $RuntimeReport)) {
  $Process.Refresh()
  if ($Process.HasExited) {
    throw "Installed SelfRelay.exe exited before capture/recovery WebViews reported ready"
  }
  if ((Get-Date) -gt $Deadline) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    throw "Installed WebView capture/recovery smoke timed out"
  }
  Start-Sleep -Milliseconds 150
}

$Process.WaitForExit(10000) | Out-Null
if (-not $Process.HasExited) {
  Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  throw "Installed SelfRelay.exe did not exit after runtime smoke completed"
}
if ($Process.ExitCode -ne 0) { throw "Installed WebView smoke process exited with $($Process.ExitCode)" }
if (-not (Test-Path $Expected) -or -not (Test-Path $CaptureReady) -or -not (Test-Path $RecoveryReady)) {
  throw "Installed WebView smoke did not produce all binding evidence files"
}

$Lines = @(Get-Content $RuntimeReport)
if ($Lines -notcontains "capture_webview_runtime_ready=PASS") { throw "Capture WebView never reached runtime ready" }
if ($Lines -notcontains "recovery_webview_runtime_ready=PASS") { throw "Recovery WebView never reached runtime ready" }
$CaptureId = (($Lines | Where-Object { $_ -like "capture_id=*" }) -replace '^capture_id=', '').Trim()
$RecoveryToken = (($Lines | Where-Object { $_ -like "recovery_token=*" }) -replace '^recovery_token=', '').Trim()
$CheckpointIds = (($Lines | Where-Object { $_ -like "checkpoint_ids=*" }) -replace '^checkpoint_ids=', '').Trim()
if ([string]::IsNullOrWhiteSpace($CaptureId)) { throw "Capture WebView smoke did not report a durable capture ID" }
if ([string]::IsNullOrWhiteSpace($RecoveryToken)) { throw "Recovery WebView smoke did not report its binding token" }
if ([string]::IsNullOrWhiteSpace($CheckpointIds)) { throw "Recovery WebView smoke did not report checkpoint IDs" }
if ((Get-Content $CaptureReady -Raw).Trim() -ne $CaptureId) { throw "Capture readiness file does not match expected durable ID" }
$RecoveryBinding = (Get-Content $RecoveryReady -Raw).Trim()
if ($RecoveryBinding -ne "$RecoveryToken|$CheckpointIds") { throw "Recovery readiness file does not match expected target/checkpoints" }

$Output = @(
  "installed_binary=$($SelfRelay.FullName)"
  "capture_webview_runtime_ready=PASS"
  "recovery_webview_runtime_ready=PASS"
  "capture_id=$CaptureId"
  "recovery_token=$RecoveryToken"
  "checkpoint_ids=$CheckpointIds"
  "production_surface_routing=TAURI_WINDOW_LABEL"
)
$Output | Set-Content $Report -Encoding utf8
$Output | ForEach-Object { Write-Host $_ }
