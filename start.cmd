@echo off
rem Khoi dong A80RT Configurator (uu tien file .exe doc lap, khong hien cua so CMD den).
cd /d "%~dp0"
if exist "%~dp0A80RT-Configurator.exe" (
  start "" "%~dp0A80RT-Configurator.exe" %*
  exit /b 0
)
rem Mo trinh duyet sau 2 giay de may chu Python kip khoi dong.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8787/"
python -I scripts\a80rt_local.py %*
