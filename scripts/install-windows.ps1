$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Ensure-WingetPackage([string]$command, [string]$packageId) {
  if (Get-Command $command -ErrorAction SilentlyContinue) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Falta $command y winget no esta disponible para instalarlo."
  }
  Write-Host "Instalando $packageId..." -ForegroundColor Cyan
  winget install --id $packageId --exact --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar $packageId." }
  Refresh-Path
}

Ensure-WingetPackage "node" "OpenJS.NodeJS.LTS"
Ensure-WingetPackage "py" "Python.Python.3.11"
Ensure-WingetPackage "ffmpeg" "Gyan.FFmpeg"

Write-Host "Instalando dependencias de la aplicacion..." -ForegroundColor Cyan
corepack pnpm install
if ($LASTEXITCODE -ne 0) { throw "Fallo pnpm install." }

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  py -3.11 -m venv .venv
}
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -r "worker\requirements.txt"

$audioSepRoot = Join-Path $projectRoot "vendor\AudioSep"
if (-not (Test-Path (Join-Path $audioSepRoot "pipeline.py"))) {
  Write-Host "Descargando el codigo abierto de AudioSep..." -ForegroundColor Cyan
  $archive = Join-Path $env:TEMP "opensep-audiosep.zip"
  $extract = Join-Path $env:TEMP "opensep-audiosep-source"
  Invoke-WebRequest "https://github.com/Audio-AGI/AudioSep/archive/refs/heads/main.zip" -OutFile $archive
  if (Test-Path $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  Expand-Archive -LiteralPath $archive -DestinationPath $extract
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $audioSepRoot) | Out-Null
  Move-Item -LiteralPath (Join-Path $extract "AudioSep-main") -Destination $audioSepRoot
  Remove-Item -LiteralPath $archive -Force
  Remove-Item -LiteralPath $extract -Recurse -Force
}

if (-not (Test-Path ".audiosep-venv\Scripts\python.exe")) {
  py -3.11 -m venv .audiosep-venv
}
$audioPython = ".audiosep-venv\Scripts\python.exe"
& $audioPython -m pip install --upgrade pip
& $audioPython -m pip install torch==2.0.1 torchaudio==2.0.2 torchvision==0.15.2 --index-url https://download.pytorch.org/whl/cpu
& $audioPython -m pip install torchlibrosa==0.1.0 lightning==2.1.0 transformers==4.28.1 braceexpand==0.1.7 webdataset==0.2.60 soundfile==0.12.1 h5py==3.10.0 ftfy==6.1.1 pandas==2.1.1 wget==3.2 librosa==0.10.1 scipy==1.11.4 pyyaml==6.0.1 huggingface-hub==0.20.3 timm==0.9.12

$checkpointDir = Join-Path $audioSepRoot "checkpoint"
$checkpoint = Join-Path $checkpointDir "audiosep_base_4M_steps.ckpt"
if (-not (Test-Path $checkpoint)) {
  Write-Host "Descargando AudioSep (aprox. 1.3 GB)..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $checkpointDir | Out-Null
  Invoke-WebRequest "https://huggingface.co/spaces/Audio-AGI/AudioSep/resolve/main/checkpoint/audiosep_base_4M_steps.ckpt?download=true" -OutFile $checkpoint
}
$actualHash = (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedHash = "f8cda01bfd0ebd141eef45d41db7a3ada23a56568465840d3cff04b8010ce82c"
if ($actualHash -ne $expectedHash) {
  throw "El checkpoint de AudioSep no coincide con su SHA-256 oficial."
}

Write-Host "Instalacion terminada." -ForegroundColor Green

