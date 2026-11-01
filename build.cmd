@echo off
rem ============================================================
rem  Build PF2e character sheet frontend (frontend\sheet.html)
rem  Usage:
rem      build.cmd                          - default layout + default palette
rem      build.cmd official                 - Paizo official layout
rem      build.cmd sanych                   - combat layout (Sanych sheet)
rem      build.cmd dark                     - dark VTT overlay layout
rem      build.cmd dark pal:official        - dark VTT layout + Paizo colors
rem      build.cmd official pal:dark        - Paizo layout + dark colors
rem      build.cmd pal:sanych               - default layout + Sanych colors
rem      build.cmd --list-themes            - list layouts and palettes
rem      build.cmd --no-data                - rebuild empty sheet only
rem  Themes (--theme) = block LAYOUT ONLY. Palettes (--palette / pal:X) = COLORS ONLY.
rem  Other args (--theme X, --palette Y, --no-data) are passed to tools\build.py as is.
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
    rem bare names = layout themes
    if /i "!T!"=="default" set "ARGS=!ARGS! --theme default"
    if /i "!T!"=="official" set "ARGS=!ARGS! --theme official"
    if /i "!T!"=="sanych" set "ARGS=!ARGS! --theme sanych"
    if /i "!T!"=="dark" set "ARGS=!ARGS! --theme dark"
    rem pal:<name> = color palette shortcut
    if /i "!T:~0,4!"=="pal:" (
        for /f "tokens=2 delims=:" %%P in ("!T!") do set "ARGS=!ARGS! --palette %%P"
    )
    if "!T!"=="--no-data" set "ARGS=!ARGS! --no-data"
    if "!T!"=="--list-themes" set "ARGS=!ARGS! --list-themes"
    if "!T!"=="--theme" set "ARGS=!ARGS! --theme"
    if "!T!"=="--palette" set "ARGS=!ARGS! --palette"
)

python tools\build.py !ARGS!
if errorlevel 1 (
    echo [ERROR] Build failed.
    exit /b 1
)
echo.
echo Done. Output: frontend\sheet.html and frontend\sheet-empty.html
endlocal
