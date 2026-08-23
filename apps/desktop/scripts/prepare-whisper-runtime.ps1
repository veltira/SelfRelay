$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$Out = Join-Path $Root "apps/desktop/src-tauri/resources/whisper"
$Work = Join-Path $env:RUNNER_TEMP "selfrelay-desktop-whisper"
$ModelCommit = "c521a4b02f422512d734391fdf08bb08c0862f68"
$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/$ModelCommit/ggml-base-q5_1.bin?download=true"
$ModelSha256 = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
$SampleCommit = "f86a51a04e5c9e6b82dc9f22c01ada4cb8c40c5f"
$SampleUrl = "https://raw.githubusercontent.com/wudale/whisper-asr-server/$SampleCommit/samples/es.wav"

Remove-Item $Work -Force -Recurse -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Work, $Out | Out-Null
Remove-Item (Join-Path $Out "*") -Force -Recurse -ErrorAction SilentlyContinue

$Model = Join-Path $Out "ggml-base-q5_1.bin"
Invoke-WebRequest -Uri $ModelUrl -OutFile $Model
$ActualModelSha = (Get-FileHash $Model -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualModelSha -ne $ModelSha256) { throw "Whisper model checksum mismatch: $ActualModelSha" }

$Sample = Join-Path $Work "spanish.wav"
Invoke-WebRequest -Uri $SampleUrl -OutFile $Sample
if (-not (Test-Path $Sample) -or (Get-Item $Sample).Length -lt 1000) { throw "Spanish Whisper sample download failed" }

@(
  "WHISPER_BINDING=whisper-rs-0.16.0"
  "MODEL_COMMIT=$ModelCommit"
  "MODEL_SHA256=$ActualModelSha"
  "EXECUTION=IN_PROCESS"
  "CHILD_EXECUTABLE=NONE"
  "CONSOLE_WINDOW=NONE"
) | Set-Content (Join-Path $Out "runtime-metadata.txt") -Encoding utf8

Write-Host "Prepared SelfRelay in-process Whisper model. No whisper-cli.exe is bundled."
