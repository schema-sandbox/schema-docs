@echo off
title Schema Docs - Web Tester
echo ====================================================
echo   Schema Docs - Local Development Web Tester
echo ====================================================
echo Starting Node.js local API server...
echo Auto-opening: http://localhost:4177 in your browser.
echo ====================================================
timeout /t 2 >nul
start http://localhost:4177
npm run serve
pause
