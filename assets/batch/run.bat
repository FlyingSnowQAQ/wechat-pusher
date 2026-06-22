@echo off
chcp 65001 >nul
setlocal

echo ============================================================
echo   雕龙绣虎 公众号自动推送
echo ============================================================
echo.

REM ── 检查 .env 配置 ──
set "ENV_FILE=%~dp0.env"
findstr /C:"请填写" "%ENV_FILE%" >nul 2>&1
if %errorlevel%==0 (
    echo [错误] .env 文件中还有未填写的配置项，请先编辑 .env 填入真实值。
    echo   编辑路径: %ENV_FILE%
    echo.
    pause
    exit /b 1
)

REM ── 检查 Node.js ──
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装。
    echo   下载地址: https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM ── 确保依赖已安装 ──
if not exist "%~dp0node_modules" (
    echo 正在安装依赖...
    cd /d "%~dp0"
    npm install
    echo.
)

REM ── 运行推送 ──
cd /d "%~dp0"
echo [%date% %time%] 开始推送...
node push.js

echo.
echo [%date% %time%] 推送流程结束。
endlocal
