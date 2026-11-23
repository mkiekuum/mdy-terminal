@echo off
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
 echo Download the Windows portable zip for your processor from the MDY Terminal release.
 echo Extract it and run the Start-MCP.cmd at the top level. It includes Node.js.
 pause
 exit /b 1
)
node mcp/start-local.mjs %*
pause
