$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$Out = Join-Path $Root "apps/desktop/src-tauri/resources/whisper"
$Work = Join-Path $env:RUNNER_TEMP "selfrelay-desktop-whisper"
$WhisperVersion = "v1.9.1"
$ModelCommit = "c521a4b02f422512d734391fdf08bb08c0862f68"
$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/$ModelCommit/ggml-base-q5_1.bin?download=true"
$ModelSha256 = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
$SampleCommit = "f86a51a04e5c9e6b82dc9f22c01ada4cb8c40c5f"
$SampleUrl = "https://raw.githubusercontent.com/wudale/whisper-asr-server/$SampleCommit/samples/es.wav"

Remove-Item $Work -Force -Recurse -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Work, $Out | Out-Null
Remove-Item (Join-Path $Out "*") -Force -Recurse -ErrorAction SilentlyContinue

git clone --quiet --depth 1 --branch $WhisperVersion https://github.com/ggml-org/whisper.cpp.git (Join-Path $Work "whisper.cpp")
if ($LASTEXITCODE -ne 0) { throw "Unable to clone pinned whisper.cpp $WhisperVersion" }

$Model = Join-Path $Out "ggml-base-q5_1.bin"
Invoke-WebRequest -Uri $ModelUrl -OutFile $Model
$ActualModelSha = (Get-FileHash $Model -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ActualModelSha -ne $ModelSha256) {
  throw "Whisper model checksum mismatch: $ActualModelSha"
}

$Build = Join-Path $Work "build"
cmake -S (Join-Path $Work "whisper.cpp") -B $Build `
  -DCMAKE_BUILD_TYPE=Release `
  -DBUILD_SHARED_LIBS=OFF `
  -DWHISPER_BUILD_TESTS=OFF `
  -DWHISPER_BUILD_SERVER=OFF `
  -DGGML_NATIVE=OFF
if ($LASTEXITCODE -ne 0) { throw "Whisper CMake configure failed" }
cmake --build $Build --target whisper-cli --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw "Whisper CLI build failed" }

$Cli = Get-ChildItem -Path $Build -Filter "whisper-cli.exe" -File -Recurse | Select-Object -First 1
if (-not $Cli) { throw "whisper-cli.exe was not produced" }
Copy-Item $Cli.FullName (Join-Path $Out "whisper-cli.exe") -Force

$Sample = Join-Path $Work "spanish.wav"
Invoke-WebRequest -Uri $SampleUrl -OutFile $Sample
$SmokeBase = Join-Path $Work "spanish-base"
& (Join-Path $Out "whisper-cli.exe") -m $Model -f $Sample -l es -otxt -of $SmokeBase -nt -np
if ($LASTEXITCODE -ne 0) { throw "Local Whisper Spanish smoke test failed" }
$SmokeTextPath = "$SmokeBase.txt"
if (-not (Test-Path $SmokeTextPath)) { throw "Whisper smoke test produced no transcript" }
$SmokeText = (Get-Content $SmokeTextPath -Raw).Trim()
$Score = 0
foreach ($Token in @("hola", "prueba", "sistema", "reconocimiento")) {
  if ($SmokeText -match [regex]::Escape($Token)) { $Score++ }
}
Write-Host "Desktop local Whisper Spanish sample: $SmokeText"
Write-Host "Desktop Spanish keyword recall: $Score/4"
if ($Score -lt 3) { throw "Pinned Desktop Whisper runtime failed Spanish quality gate ($Score/4)" }

$CliHash = (Get-FileHash (Join-Path $Out "whisper-cli.exe") -Algorithm SHA256).Hash.ToLowerInvariant()
@(
  "WHISPER_VERSION=$WhisperVersion"
  "MODEL_COMMIT=$ModelCommit"
  "MODEL_SHA256=$ActualModelSha"
  "WHISPER_CLI_SHA256=$CliHash"
  "SPANISH_KEYWORD_RECALL=$Score/4"
) | Set-Content (Join-Path $Out "runtime-metadata.txt") -Encoding utf8

Write-Host "Prepared SelfRelay Desktop local Whisper runtime in $Out"
