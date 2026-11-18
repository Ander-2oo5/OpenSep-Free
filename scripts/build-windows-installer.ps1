param(
  [string]$NodeVersion = "22.14.0"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$assetsRoot = Join-Path $projectRoot "setup\assets"
$nodeAssets = Join-Path $assetsRoot "node"
$ffmpegAssets = Join-Path $assetsRoot "ffmpeg"
$pythonAssets = Join-Path $assetsRoot "python"
$downloadCache = Join-Path $env:TEMP "opensep-installer-build"
New-Item -ItemType Directory -Force -Path $assetsRoot, $downloadCache | Out-Null

function Invoke-Native([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File terminó con código $LASTEXITCODE." }
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

Write-Host "Compilando OpenSep..." -ForegroundColor Cyan
Invoke-Native "npm.cmd" @("run", "build")

Write-Host "Preparando Node.js portable $NodeVersion..." -ForegroundColor Cyan
$nodeArchiveName = "node-v$NodeVersion-win-x64.zip"
$nodeArchive = Join-Path $downloadCache $nodeArchiveName
$checksums = Join-Path $downloadCache "SHASUMS256-$NodeVersion.txt"
Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $checksums
$expectedLine = Get-Content -LiteralPath $checksums | Where-Object { $_ -match "\s+$([regex]::Escape($nodeArchiveName))$" } | Select-Object -First 1
if (-not $expectedLine) { throw "No se encontró el SHA-256 oficial de $nodeArchiveName." }
$expectedHash = ($expectedLine -split "\s+")[0].ToLowerInvariant()
if (-not (Test-Path -LiteralPath $nodeArchive) -or (Get-Sha256 $nodeArchive) -ne $expectedHash) {
  Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$nodeArchiveName" -OutFile $nodeArchive
}
if ((Get-Sha256 $nodeArchive) -ne $expectedHash) {
  throw "El archivo de Node.js no coincide con el SHA-256 oficial."
}
Remove-Item -LiteralPath $nodeAssets -Recurse -Force -ErrorAction SilentlyContinue
$nodeExtract = Join-Path $downloadCache "node-extract"
Remove-Item -LiteralPath $nodeExtract -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeExtract -Force
$nodeSource = Get-ChildItem -LiteralPath $nodeExtract -Directory | Select-Object -First 1
if (-not $nodeSource) { throw "El ZIP de Node.js no contiene una carpeta válida." }
New-Item -ItemType Directory -Force -Path $nodeAssets | Out-Null
Copy-Item -Path (Join-Path $nodeSource.FullName "*") -Destination $nodeAssets -Recurse -Force

Write-Host "Preparando Python 3.11.9..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $pythonAssets | Out-Null
$pythonInstaller = Join-Path $pythonAssets "python-3.11.9-amd64.exe"
$pythonSha256 = "5ee42c4eee1e6b4464bb23722f90b45303f79442df63083f05322f1785f5fdde"
if (-not (Test-Path -LiteralPath $pythonInstaller -PathType Leaf) -or (Get-Sha256 $pythonInstaller) -ne $pythonSha256) {
  Invoke-WebRequest "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe" -OutFile $pythonInstaller
}
if ((Get-Sha256 $pythonInstaller) -ne $pythonSha256) {
  throw "El instalador de Python no coincide con el SHA-256 fijado."
}

Write-Host "Copiando FFmpeg y FFprobe portables..." -ForegroundColor Cyan
$ffmpeg = (Get-Command ffmpeg.exe -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe.exe -ErrorAction Stop).Source
$ffmpegSha256 = "589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0"
$ffprobeSha256 = "02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3"
if ((Get-Sha256 $ffmpeg) -ne $ffmpegSha256 -or (Get-Sha256 $ffprobe) -ne $ffprobeSha256) {
  throw "FFmpeg debe ser exactamente Gyan FFmpeg 9.0.2 full_build con los SHA-256 fijados."
}
New-Item -ItemType Directory -Force -Path $ffmpegAssets | Out-Null
Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $ffmpegAssets "ffmpeg.exe") -Force
Copy-Item -LiteralPath $ffprobe -Destination (Join-Path $ffmpegAssets "ffprobe.exe") -Force
$ffmpegRoot = Split-Path -Parent (Split-Path -Parent $ffmpeg)
Copy-Item -LiteralPath (Join-Path $ffmpegRoot "LICENSE") -Destination (Join-Path $ffmpegAssets "LICENSE.txt") -Force

$isccCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
  (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
)
$iscc = $isccCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $iscc) {
  throw "No se encontró Inno Setup 6. Instálalo con: winget install --id JRSoftware.InnoSetup --exact"
}

Write-Host "Generando OpenSep-Setup.exe..." -ForegroundColor Cyan
Invoke-Native $iscc @((Join-Path $projectRoot "setup\OpenSep.iss"))
$installer = Join-Path $projectRoot "dist-installer\OpenSep-Setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Inno Setup no generó el instalador esperado." }
Write-Host "Instalador creado: $installer" -ForegroundColor Green

