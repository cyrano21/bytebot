@echo off
REM Script d'arrêt pour Bytebot (Windows)

echo === Arrêt de Bytebot ===

REM Arrêt de l'agent Bytebot
if exist %TEMP%\bytebot-agent.pid (
    echo Arrêt de l'agent Bytebot...
    set /p pid=<%TEMP%\bytebot-agent.pid
    taskkill /PID %pid% /F
    del %TEMP%\bytebot-agent.pid
)

REM Arrêt du serveur VNC
if exist %TEMP%\x11vnc.pid (
    echo Arrêt du serveur VNC...
    set /p pid=<%TEMP%\x11vnc.pid
    taskkill /PID %pid% /F
    del %TEMP%\x11vnc.pid
)

REM Arrêt de XFCE
if exist %TEMP%\xfce.pid (
    echo Arrêt de XFCE...
    set /p pid=<%TEMP%\xfce.pid
    taskkill /PID %pid% /F
    del %TEMP%\xfce.pid
)

REM Arrêt de Xvfb
if exist %TEMP%\xvfb.pid (
    echo Arrêt du serveur X virtuel...
    set /p pid=<%TEMP%\xvfb.pid
    taskkill /PID %pid% /F
    del %TEMP%\xvfb.pid
)

echo Bytebot a été arrêté.