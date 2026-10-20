@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please install Node.js 24.15 or newer in the 24 LTS series.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit((major===24&&minor>=15)||major>=26?0:1)"
if errorlevel 1 (
  echo This app requires Node.js 24.15+ in the 24 LTS series, or Node.js 26+.
  pause
  exit /b 1
)
if not exist "node_modules\vite" (
  echo Dependencies are missing. In this folder, run: npm ci --ignore-scripts
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo WriEng local preview: http://127.0.0.1:4173/
echo Keep this window open while using WriEng. Press Ctrl+C to stop.
call npm run preview -- --open
pause
