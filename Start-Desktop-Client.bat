@echo off
setlocal
title Schema Docs - Desktop Tester
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js was not found.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: npm was not found.
  echo Repair the Node.js installation, then run this file again.
  pause
  exit /b 1
)

where cargo.exe >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Rust/Cargo was not found.
  echo Install the Rust toolchain from https://rustup.rs and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\@tauri-apps\cli\tauri.js" (
  echo ====================================================
  echo   Installing desktop development dependencies...
  echo   This is required only after a fresh clone or cleanup.
  echo ====================================================
  call npm ci
  if errorlevel 1 (
    echo.
    echo ERROR: npm dependencies could not be installed.
    echo Check the network and npm configuration, then run this file again.
    pause
    exit /b 1
  )
)

if not exist "src-tauri\resources\node.exe" (
  echo ====================================================
  echo   Preparing the desktop runtime...
  echo   This is required only after a fresh clone or cleanup.
  echo ====================================================
  node scripts\prepare-release.js
  if errorlevel 1 (
    echo.
    echo ERROR: The desktop Node.js runtime could not be prepared.
    pause
    exit /b 1
  )
)

if exist "%ProgramFiles%\Tesseract-OCR\tesseract.exe" (
  set "SCHEMA_DOCS_TESSERACT=%ProgramFiles%\Tesseract-OCR\tesseract.exe"
  set "PATH=%ProgramFiles%\Tesseract-OCR;%PATH%"
)
if exist "%LOCALAPPDATA%\SchemaDocs\tessdata\chi_sim.traineddata" (
  set "SCHEMA_DOCS_TESSDATA=%LOCALAPPDATA%\SchemaDocs\tessdata"
)
if exist "%LOCALAPPDATA%\SchemaDocs\marker-env\Scripts\marker_single.exe" (
  set "SCHEMA_DOCS_MARKER=%LOCALAPPDATA%\SchemaDocs\marker-env\Scripts\marker_single.exe"
)
for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_*") do (
  for /d %%P in ("%%~fD\poppler-*") do if exist "%%~fP\Library\bin\pdftoppm.exe" set "PATH=%%~fP\Library\bin;%PATH%"
)
if /i "%~1"=="--check-adapters" (
  where python
  python -c "import pdfplumber; print('pdfplumber', pdfplumber.__version__)"
  where pdftoppm
  where pdfinfo
  where tesseract
  "%SCHEMA_DOCS_TESSERACT%" --tessdata-dir "%SCHEMA_DOCS_TESSDATA%" --list-langs
  "%SCHEMA_DOCS_MARKER%" --help >nul && echo marker_single %SCHEMA_DOCS_MARKER%
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$listeners = Get-NetTCPConnection -LocalPort 4177 -State Listen -ErrorAction SilentlyContinue; foreach ($listener in $listeners) { $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess) -ErrorAction SilentlyContinue; if ($owner.CommandLine -match 'src[\\/]cli[\\/]serve\.js') { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } else { Write-Error ('Port 4177 is used by another application. PID: ' + $listener.OwningProcess); exit 2 } }"
if errorlevel 2 (
  echo.
  echo ERROR: Port 4177 is occupied by another application.
  echo Close that application, then run this file again.
  pause
  exit /b 1
)
echo ====================================================
echo   Schema Docs - Tauri Desktop Client Tester
echo ====================================================
echo Starting Tauri development server (tauri dev)...
echo ====================================================
npm run desktop:dev
if errorlevel 1 (
  echo.
  echo ERROR: Schema Docs failed to start. Review the error above.
  pause
  exit /b 1
)
endlocal
