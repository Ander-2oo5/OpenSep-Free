param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
Set-Location $InstallRoot
$localRoot = Join-Path $env:LOCALAPPDATA "OpenSep"
$cacheRoot = Join-Path $localRoot "InstallerCache"
$logsRoot = Join-Path $localRoot "logs"
$modelsRoot = Join-Path $localRoot "models"
New-Item -ItemType Directory -Force -Path $cacheRoot, $logsRoot, $modelsRoot | Out-Null
$logPath = Join-Path $logsRoot ("install-{0}.log" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))
$script:ExitCode = 1

function Write-InstallLog([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $Message
}

function Set-InstallStage([int]$Percent, [string]$Message, [int]$ExitCode) {
  $script:ExitCode = $ExitCode
  Write-Progress -Activity "Instalando OpenSep" -Status $Message -PercentComplete $Percent
  Write-InstallLog $Message
}

function Invoke-External([string]$File, [string[]]$Arguments) {
  Write-InstallLog ("Ejecutando: {0} {1}" -f $File, ($Arguments -join " "))
  & $File @Arguments 2>&1 | ForEach-Object {
    Add-Content -LiteralPath $logPath -Value $_ -Encoding UTF8
    Write-Host $_
  }
  if ($LASTEXITCODE -ne 0) {
    throw "El proceso terminó con código ${LASTEXITCODE}: $File"
  }
}

function Invoke-GuiInstaller([string]$File, [string[]]$Arguments) {
  Write-InstallLog ("Ejecutando instalador: {0} {1}" -f $File, ($Arguments -join " "))
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "El instalador terminó con código $($process.ExitCode): $File"
  }
}

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return (($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Test-FileHash([string]$Path, [string]$ExpectedSha256) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  return (Get-Sha256 $Path) -eq $ExpectedSha256
}

function Get-VerifiedDownload([string]$Url, [string]$Destination, [string]$ExpectedSha256) {
  if (Test-FileHash $Destination $ExpectedSha256) {
    Write-InstallLog "Archivo verificado en caché: $Destination"
    return
  }
  Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
  $partial = "$Destination.partial"
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
      Write-InstallLog "Descargando intento $attempt de 3: $Url"
      $client = New-Object Net.WebClient
      try {
        $client.Headers["User-Agent"] = "OpenSep-Installer/1.0"
        $client.DownloadFile($Url, $partial)
      } finally {
        $client.Dispose()
      }
      Move-Item -LiteralPath $partial -Destination $Destination -Force
      if (-not (Test-FileHash $Destination $ExpectedSha256)) {
        $script:ExitCode = 21
        throw "El SHA-256 descargado no coincide para $Destination"
      }
      return
    } catch {
      Write-InstallLog "Fallo de descarga: $($_.Exception.Message)"
      Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
      if ($attempt -eq 3) {
        if ($script:ExitCode -ne 21) { $script:ExitCode = 20 }
        throw
      }
      Start-Sleep -Seconds (3 * $attempt)
    }
  }
}

try {
  if (-not [Environment]::Is64BitOperatingSystem) {
    $script:ExitCode = 10
    throw "OpenSep requiere Windows de 64 bits."
  }

  Set-InstallStage 5 "Comprobando archivos incluidos" 40
  $node = Join-Path $InstallRoot "runtime\node\node.exe"
  $corepack = Join-Path $InstallRoot "runtime\node\corepack.cmd"
  $ffmpeg = Join-Path $InstallRoot "runtime\ffmpeg\ffmpeg.exe"
  $ffprobe = Join-Path $InstallRoot "runtime\ffmpeg\ffprobe.exe"
  $pythonInstaller = Join-Path $InstallRoot "setup-assets\python-3.11.9-amd64.exe"
  foreach ($required in @($node, $corepack, $ffmpeg, $ffprobe, $pythonInstaller)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
      throw "Falta un componente incluido: $required"
    }
  }

  $env:PATH = "$(Split-Path -Parent $node);$(Split-Path -Parent $ffmpeg);$env:PATH"
  $env:COREPACK_HOME = Join-Path $localRoot "corepack"
  $env:TORCH_HOME = $modelsRoot
  $env:HF_HOME = Join-Path $modelsRoot "huggingface"

  Set-InstallStage 10 "Instalando Python privado" 40
  $pythonRoot = Join-Path $InstallRoot "runtime\python"
  $python = Join-Path $pythonRoot "python.exe"
  if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    Invoke-GuiInstaller $pythonInstaller @(
      "/quiet", "InstallAllUsers=0", "TargetDir=$pythonRoot", "PrependPath=0",
      "Include_launcher=0", "Include_test=0", "Include_doc=0", "Include_tcltk=0",
      "Include_pip=1", "Shortcuts=0", "AssociateFiles=0"
    )
  }

  Set-InstallStage 18 "Instalando dependencias de la aplicación" 40
  Invoke-External $corepack @(
    "pnpm", "install", "--prod", "--frozen-lockfile",
    "--filter", "@opensep/api...", "--filter", "@opensep/runner...",
    "--store-dir", (Join-Path $localRoot "pnpm-store")
  )

  Set-InstallStage 28 "Instalando Demucs y PyTorch" 40
  $demucsRoot = Join-Path $InstallRoot "runtime\demucs"
  $demucsPython = Join-Path $demucsRoot "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $demucsPython -PathType Leaf)) {
    Invoke-External $python @("-m", "venv", $demucsRoot)
  }
  Invoke-External $demucsPython @("-m", "pip", "install", "--upgrade", "pip")
  Invoke-External $demucsPython @(
    "-m", "pip", "install", "torch==2.5.1", "torchaudio==2.5.1",
    "--index-url", "https://download.pytorch.org/whl/cpu"
  )
  Invoke-External $demucsPython @("-m", "pip", "install", "-r", (Join-Path $InstallRoot "worker\requirements.txt"))

  Set-InstallStage 42 "Descargando AudioSep verificado" 20
  $audioSepArchive = Join-Path $cacheRoot "AudioSep-944583f.zip"
  Get-VerifiedDownload `
    "https://github.com/Audio-AGI/AudioSep/archive/944583f.zip" `
    $audioSepArchive `
    "f4c35d910c9f35069f2683eb781ff6f7742589171b88335b88581807a0aff4ba"
  $audioSepRoot = Join-Path $InstallRoot "vendor\AudioSep"
  if (-not (Test-Path -LiteralPath (Join-Path $audioSepRoot "pipeline.py") -PathType Leaf)) {
    $extractRoot = Join-Path $cacheRoot "AudioSep-extract"
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $audioSepRoot -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $audioSepArchive -DestinationPath $extractRoot -Force
    $sourceRoot = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw "El archivo de AudioSep no contiene una carpeta válida." }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $audioSepRoot) | Out-Null
    Move-Item -LiteralPath $sourceRoot.FullName -Destination $audioSepRoot
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  }

  Set-InstallStage 50 "Instalando el entorno de AudioSep" 40
  $audioEnv = Join-Path $InstallRoot "runtime\audiosep"
  $audioPython = Join-Path $audioEnv "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $audioPython -PathType Leaf)) {
    Invoke-External $python @("-m", "venv", $audioEnv)
  }
  Invoke-External $audioPython @("-m", "pip", "install", "--upgrade", "pip")
  Invoke-External $audioPython @(
    "-m", "pip", "install", "torch==2.0.1", "torchaudio==2.0.2", "torchvision==0.15.2",
    "--index-url", "https://download.pytorch.org/whl/cpu"
  )
  Invoke-External $audioPython @(
    "-m", "pip", "install", "numpy==1.26.4", "torchlibrosa==0.1.0", "lightning==2.1.0",
    "transformers==4.28.1", "braceexpand==0.1.7", "webdataset==0.2.60", "soundfile==0.12.1",
    "h5py==3.10.0", "ftfy==6.1.1", "pandas==2.1.1", "wget==3.2", "librosa==0.10.1",
    "scipy==1.11.4", "pyyaml==6.0.1", "huggingface-hub==0.20.3", "timm==0.9.12"
  )

  Set-InstallStage 67 "Descargando el modelo AudioSep (aprox. 1.3 GB)" 20
  $checkpointDir = Join-Path $audioSepRoot "checkpoint"
  New-Item -ItemType Directory -Force -Path $checkpointDir | Out-Null
  $checkpoint = Join-Path $checkpointDir "audiosep_base_4M_steps.ckpt"
  Get-VerifiedDownload `
    "https://huggingface.co/spaces/Audio-AGI/AudioSep/resolve/main/checkpoint/audiosep_base_4M_steps.ckpt?download=true" `
    $checkpoint `
    "f8cda01bfd0ebd141eef45d41db7a3ada23a56568465840d3cff04b8010ce82c"

  Set-InstallStage 80 "Descargando y verificando modelos Demucs" 20
  Invoke-External $demucsPython @(
    (Join-Path $InstallRoot "worker\prefetch_models.py"),
    "htdemucs", "htdemucs_ft", "htdemucs_6s", "mdx_extra"
  )

  Set-InstallStage 95 "Verificando la instalación" 50
  $env:OPENSEP_FFMPEG = $ffmpeg
  $env:OPENSEP_FFPROBE = $ffprobe
  $env:OPENSEP_AUDIOSEP_PYTHON = $audioPython
  $env:OPENSEP_AUDIOSEP_ROOT = $audioSepRoot
  $env:OPENSEP_AUDIOSEP_ADAPTER = Join-Path $InstallRoot "worker\audiosep_adapter.py"
  $workerScript = Join-Path $InstallRoot "worker\opensep_worker\__main__.py"
  Invoke-External $demucsPython @($workerScript, "--check")
  Invoke-External $demucsPython @($workerScript, "--check-audiosep")

  Write-Progress -Activity "Instalando OpenSep" -Completed
  Write-InstallLog "Instalación terminada correctamente."
  exit 0
} catch {
  Write-Progress -Activity "Instalando OpenSep" -Completed
  Write-InstallLog "ERROR $script:ExitCode - $($_.Exception.Message)"
  Write-Host "La instalación falló. Registro: $logPath" -ForegroundColor Red
  exit $script:ExitCode
}

