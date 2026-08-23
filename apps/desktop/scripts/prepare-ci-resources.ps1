$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$Out = Join-Path $Root "apps/desktop/src-tauri/resources/whisper"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Helper = Join-Path $Out "whisper-cli.exe"
$Model = Join-Path $Out "ggml-base-q5_1.bin"

# Tauri validates configured resources during check/test. CI needs only a model
# placeholder; production packaging downloads the pinned real model. Whisper is
# linked into SelfRelay.exe, so no whisper-cli.exe is ever bundled.
Remove-Item $Helper -Force -ErrorAction SilentlyContinue
[IO.File]::WriteAllBytes($Model, [Text.Encoding]::ASCII.GetBytes("SELFRELAY_CI_RESOURCE_PLACEHOLDER_MODEL"))
if (Test-Path $Helper) { throw "CI resource preparation left a deprecated whisper-cli.exe behind" }
if ((Get-Item $Model).Length -eq 0) { throw "Failed to create CI-only model placeholder" }
Write-Host "Prepared CI-only Whisper model placeholder (in-process runtime; no helper executable)."
