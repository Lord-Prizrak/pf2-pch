@echo off
rem ============================================================
rem  Build Go backend (server\pf2e-server.exe) and start it.
rem  Optional args: address (default :8090), e.g.:
rem      run.cmd
rem      run.cmd :8080
rem ============================================================
setlocal
cd /d "%~dp0server"

where go >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Go not found in PATH. Install Go 1.19+ and retry.
    exit /b 1
)

set "ADDR=%~1"
if "%ADDR%"=="" set "ADDR=:8090"

echo Building server...
go build -o pf2e-server.exe .
if errorlevel 1 (
    echo [ERROR] Compilation failed.
    exit /b 1
)

echo Starting server on %ADDR% ... (Ctrl+C to stop)
pf2e-server.exe -addr %ADDR% -data .\data -frontend ..\frontend
endlocal
