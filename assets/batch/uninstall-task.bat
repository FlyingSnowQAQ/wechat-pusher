@echo off
chcp 65001 >nul
REM 取消已注册的任务计划
schtasks /delete /tn "雕龙绣虎公众号推送" /f 2>nul
echo 已移除任务计划（如果存在）。
pause
