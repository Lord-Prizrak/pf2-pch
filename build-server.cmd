@echo off
rem ============================================================
rem  Compile Go backend only -> server\pf2e-server.exe
rem  Cross-compile examples:
rem      build-server.cmd linux
rem      build-server.cmd darwin
rem ============================================================
setlocal
cd /d "%~dp0server"

where go >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Go not found in PATH. Install Go 1.19+ and retry.
    exit /b 1
)

set "OUT=pf2e-server.exe"
if /i "%~1"=="linux" (
    set "GOOS=linux"
    set "GOARCH=amd64"
    set "OUT=pf2e-server-linux"
)
if /i "%~1"=="darwin" (
    set "GOOS=darwin"
    set "GOARCH=amd64"
    set "OUT=pf2e-server-mac"
)

echo Compiling server ...
go build -o %OUT% .
if errorlevel 1 (
    echo [ERROR] Compilation failed.
    exit /b 1
)
echo Done: server\%OUT%
endlocal
