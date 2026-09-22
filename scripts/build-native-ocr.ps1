param(
  [Parameter(Mandatory=$true)][string]$ArchiveDirectory,
  [string]$OutputDirectory = '.ai-doc-exchange/native-ocr-rebuild'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
if (-not $output.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Build output must be inside this workspace.'
}
if (Test-Path -LiteralPath $output) { throw 'Build output already exists; choose a new directory to preserve previous evidence.' }
$archives = (Resolve-Path -LiteralPath $ArchiveDirectory).Path
$lockPath = Join-Path $root 'config/native-ocr-sources.json'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
foreach ($source in $lock.sources) {
  $archive = Join-Path $archives $source.archive
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $source.sha256) {
    throw "Source checksum mismatch: $($source.archive)"
  }
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs -or $LASTEXITCODE -ne 0) { throw 'Visual Studio C++ Build Tools are required.' }
New-Item -ItemType Directory -Path $output | Out-Null
$envFile = Join-Path $output 'build-env.cmd'
@('@echo off', ('call "' + $vs + '\VC\Auxiliary\Build\vcvars64.bat" >nul'), 'if errorlevel 1 exit /b 1', 'set') | Set-Content -LiteralPath $envFile -Encoding ascii
$buildEnv = & cmd /d /c $envFile
if ($LASTEXITCODE -ne 0) { throw 'C++ environment initialization failed.' }
foreach ($line in $buildEnv) {
  if ($line -match '^([^=]+)=(.*)$' -and $matches[1] -ine 'PATH') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
$cmakeRoot = Join-Path $vs 'Common7/IDE/CommonExtensions/Microsoft/CMake'
$compilerRoot = Join-Path $env:VCToolsInstallDir 'bin/Hostx64/x64'
$sdkBin = Join-Path $env:WindowsSdkVerBinPath 'x64'
$env:PATH = "$compilerRoot;$sdkBin;$cmakeRoot/CMake/bin;$cmakeRoot/Ninja;" + $env:PATH
$env:CC = (Get-Command cl.exe).Source
$env:CXX = $env:CC
$prefix = Join-Path $output 'installed'
$sourceRoot = Join-Path $output 'source'
foreach ($source in $lock.sources) { Expand-Archive -LiteralPath (Join-Path $archives $source.archive) -DestinationPath $sourceRoot }
$commands = [Collections.Generic.List[object]]::new()
function Invoke-CMake {
  $commands.Add(@($args))
  & cmake @args
  if ($LASTEXITCODE -ne 0) { throw "CMake failed: $LASTEXITCODE" }
}
function Build-Component([string]$name, [string[]]$options) {
  $source = $lock.sources | Where-Object name -EQ $name
  $build = Join-Path $output $name
  Invoke-CMake -S (Join-Path $sourceRoot $source.directory) -B $build -G Ninja "-DCMAKE_INSTALL_PREFIX=$prefix" "-DCMAKE_PREFIX_PATH=$prefix" -DCMAKE_BUILD_TYPE=Release -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DCMAKE_POLICY_DEFAULT_CMP0091=NEW @options
  Invoke-CMake --build $build --parallel 4
  Invoke-CMake --install $build
}
Build-Component 'zlib' @('-DZLIB_BUILD_SHARED=OFF','-DZLIB_BUILD_STATIC=ON','-DZLIB_BUILD_TESTING=OFF')
Build-Component 'libpng' @("-DZLIB_LIBRARY=$prefix/lib/zs.lib",'-DPNG_SHARED=OFF','-DPNG_STATIC=ON','-DPNG_TESTS=OFF','-DPNG_TOOLS=OFF')
Build-Component 'leptonica' @("-DZLIB_LIBRARY=$prefix/lib/zs.lib",'-DSW_BUILD=OFF','-DBUILD_SHARED_LIBS=OFF','-DBUILD_PROG=OFF','-DENABLE_ZLIB=ON','-DENABLE_PNG=ON','-DENABLE_GIF=OFF','-DENABLE_JPEG=OFF','-DENABLE_TIFF=OFF','-DENABLE_WEBP=OFF','-DENABLE_OPENJPEG=OFF')
Build-Component 'tesseract' @('-DSW_BUILD=OFF','-DBUILD_SHARED_LIBS=ON','-DBUILD_TRAINING_TOOLS=OFF','-DBUILD_TESTS=OFF','-DOPENMP_BUILD=OFF','-DGRAPHICS_DISABLED=ON','-DDISABLED_LEGACY_ENGINE=ON','-DDISABLE_TIFF=ON','-DDISABLE_ARCHIVE=ON','-DDISABLE_CURL=ON','-DWIN32_MT_BUILD=ON','-DINSTALL_CONFIGS=OFF')
$package = Join-Path $output 'package'
New-Item -ItemType Directory -Path "$package/notices" | Out-Null
foreach ($name in @('tesseract.exe','tesseract55.dll')) { Copy-Item -LiteralPath "$prefix/bin/$name" -Destination $package }
foreach ($source in $lock.sources) {
  foreach ($notice in $source.notices) {
    Copy-Item -LiteralPath "$sourceRoot/$($source.directory)/$notice" -Destination "$package/notices/$($source.name)-$notice"
  }
}
Copy-Item -LiteralPath $lockPath -Destination "$package/notices/sources.json"
Copy-Item -LiteralPath (Join-Path $root 'docs/native-ocr-build.md') -Destination "$package/notices/build.md"
$files = @(Get-ChildItem -LiteralPath $package -Recurse -File | ForEach-Object {
  @{path=[IO.Path]::GetRelativePath($package,$_.FullName).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()}
} | Sort-Object {$_.path})
@{schema='schema-docs.native-ocr-build.v1';created=(Get-Date).ToUniversalTime().ToString('o');sources=$lock.sources;
  compiler=(Get-Item -LiteralPath $env:CC).VersionInfo.FileVersion;windowsSdk=$env:WindowsSDKVersion;
  linkage='MSVC release static CRT; static Leptonica, libpng, zlib';commands=$commands;files=$files;
  nativeTransitiveNotices='pending-review-before-public-distribution'} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath "$package/build-receipt.json" -Encoding utf8NoBOM
Write-Output "Native OCR package: $package"
