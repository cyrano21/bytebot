@echo off
REM Script de démarrage simplifié pour Bytebot (Windows)

echo === Démarrage de Bytebot ===

REM Création du répertoire de logs si nécessaire
if not exist logs mkdir logs

REM Démarrage du bureau virtuel (Xvfb)
echo Démarrage du serveur X virtuel...
start /b Xvfb :99 -screen 0 1024x768x24
echo %ERRORLEVEL% > %TEMP%\xvfb.pid

REM Attente que Xvfb démarre
timeout /t 2 /nobreak >nul

REM Configuration de l'affichage
set DISPLAY=:99

REM Démarrage du gestionnaire de fenêtres XFCE
echo Démarrage de XFCE...
start /b xfce4-session
echo %ERRORLEVEL% > %TEMP%\xfce.pid

REM Attente que XFCE démarre
timeout /t 3 /nobreak >nul

REM Démarrage du serveur VNC pour l'accès à distance
echo Démarrage du serveur VNC...
start /b x11vnc -display :99 -rfbport 5900 -shared -forever -passwd bytebot
echo %ERRORLEVEL% > %TEMP%\x11vnc.pid

REM Démarrage de l'agent Bytebot
echo Démarrage de l'agent Bytebot...
cd packages\bytebot-agent
start /b npm start
echo %ERRORLEVEL% > %TEMP%\bytebot-agent.pid
cd ..\..

echo Bytebot est maintenant en cours d'exécution !
echo.
echo Vous pouvez accéder à l'interface via :
echo   - Bureau virtuel VNC : localhost:5900 (mot de passe: bytebot)
echo.
echo Pour arrêter Bytebot, appuyez sur Ctrl+C ou exécutez stop-bytebot.bat