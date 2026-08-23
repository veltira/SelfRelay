$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$Out = Join-Path $Root "apps/desktop/src-tauri/resources/whisper"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$Cli = Join-Path $Out "whisper-cli.exe"
$Model = Join-Path $Out "ggml-base-q5_1.bin"

# Tauri validates configured bundle resources even during cargo check/test and
# debug --no-bundle builds. Desktop CI does not execute transcription; Desktop
# Package separately builds, smoke-tests and overwrites these paths with the
# real pinned Whisper runtime before producing any distributable artifact.
[IO.File]::WriteAllBytes($Cli, [Text.Encoding]::ASCII.GetBytes("SELFRELAY_CI_RESOURCE_PLACEHOLDER_WHISPER_CLI"))
[IO.File]::WriteAllBytes($Model, [Text.Encoding]::ASCII.GetBytes("SELFRELAY_CI_RESOURCE_PLACEHOLDER_MODEL"))

if ((Get-Item $Cli).Length -eq 0 -or (Get-Item $Model).Length -eq 0) {
  throw "Failed to create CI-only Tauri resource placeholders"
}

Write-Host "Prepared CI-only Whisper resource placeholders. Packaging replaces them with the real pinned runtime."
