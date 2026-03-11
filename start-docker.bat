@echo off
REM Script de démarrage de l'application Bytebot avec Docker pour Windows

echo === Démarrage de l'application Bytebot avec Docker ===

REM Vérifier si Docker est installé
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker n'est pas installé. Veuillez installer Docker Desktop avant de continuer.
    pause
    exit /b 1
)

REM Aller dans le répertoire docker
cd docker

REM Démarrer les services
echo Démarrage des services Docker...
docker-compose up -d

REM Vérifier si les services ont démarré correctement
echo Vérification des services...
timeout /t 10 /nobreak >nul

docker-compose ps | findstr "Up" >nul
if %errorlevel% equ 0 (
    echo Les services ont démarré avec succès !
    echo.
    echo Accès aux services :
    echo   - Bytebot Desktop: http://localhost:9990
    echo   - Bytebot Agent: http://localhost:9991
    echo   - Bytebot UI: http://localhost:9992
    echo   - Base de données PostgreSQL: localhost:5432
    echo.
    echo Pour arrêter les services, exécutez : docker-compose down
) else (
    echo Erreur lors du démarrage des services. Vérifiez les logs avec : docker-compose logs
)

pause