@echo off
chcp 65001 >nul
REM ============================================================
REM  注册 Windows 任务计划：每周三 08:00 自动推送
REM  需要以管理员权限运行此脚本
REM ============================================================

set "TASK_NAME=雕龙绣虎公众号推送"
set "BAT_PATH=%~dp0run.bat"

echo 正在注册任务计划: %TASK_NAME%
echo 执行脚本: %BAT_PATH%
echo 触发器: 每周三 08:00
echo.

schtasks /create /tn "%TASK_NAME%" /tr "\"%BAT_PATH%\"" /sc WEEKLY /d WED /st 08:00 /rl HIGHEST /f

if %errorlevel%==0 (
    echo.
    echo ✅ 任务计划注册成功！
    echo    每周三 08:00 将自动运行推送脚本。
    echo.
    echo 查看方式: 打开「任务计划程序」，搜索"%TASK_NAME%"
) else (
    echo.
    echo ❌ 注册失败。请确保以管理员身份运行此脚本。
)

echo.
pause
