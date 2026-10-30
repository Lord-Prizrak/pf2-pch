@echo off
rem ============================================================
rem  Build PF2e character sheet frontend (frontend\sheet.html)
rem  Usage:
rem      build.cmd                 - default theme/layout
rem      build.cmd official        - Paizo official sheet look & layout
rem      build.cmd sanych          - existing character sheet (Sanych) style
rem      build.cmd dark            - dark VTT style
rem      build.cmd dark official   - dark colors + official layout
rem      build.cmd --list-themes   - list available themes
rem      build.cmd --no-data       - rebuild empty sheet only
rem  Other args (--theme X, --layout Y, --no-data) are passed to tools\build.py as is.
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found in PATH. Install Python 3 and retry.
    exit /b 1
)

set "ARGS="
for %%A in (%*) do (
    set "T=%%~A"
    if /i "!T!"=="default" set "ARGS=!ARGS! --theme default"
    if /i "!T!"=="official" set "ARGS=!ARGS! --theme official"
    if /i "!T!"=="sanych" set "ARGS=!ARGS! --theme sanych"
    if /i "!T!"=="dark" set "ARGS=!ARGS! --theme dark"
    if "!T!"=="--no-data" set "ARGS=!ARGS! --no-data"
    if "!T!"=="--list-themes" set "ARGS=!ARGS! --list-themes"
    if "!T!"=="--theme" set "ARGS=!ARGS! --theme"
    if "!T!"=="--layout" set "ARGS=!ARGS! --layout"
)

python tools\build.py !ARGS!
if errorlevel 1 (
    echo [ERROR] Build failed.
    exit /b 1
)
echo.
echo Done. Output: frontend\sheet.html and frontend\sheet-empty.html
endlocal
