@echo off
chcp 65001 >nul
rem Start the dev server and open the viewer in the browser (no packaging needed).
cd /d "%~dp0"
where npm >nul 2>nul || (echo 未找到 npm，请先安装 Node.js：https://nodejs.org/ & pause & exit /b 1)
if not exist node_modules (
  echo 首次运行，正在安装依赖…
  call npm ci || (echo 依赖安装失败 & pause & exit /b 1)
)
echo 正在启动测试服务器：http://127.0.0.1:5173 （关闭此窗口即停止）
call npm run browser
pause
