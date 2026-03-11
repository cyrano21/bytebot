@echo off
REM Script d'initialisation pour configurer l'environnement Bytebot (Windows)

echo === Initialisation de l'environnement Bytebot ===

echo Plateforme détectée: Windows

REM Installer les dépendances Python
echo Installation des dépendances Python...
pip install -r requirements.txt

REM Créer le fichier .env s'il n'existe pas
if not exist ".env" (
    echo Création du fichier .env...
    echo # Clé API OpenRouter > .env
    echo # OPENROUTER_API_KEY=sk-or-v1-... >> .env
    echo. >> .env
    echo # Clés API pour les fournisseurs d'IA >> .env
    echo # ANTHROPIC_API_KEY=sk-ant-... >> .env
    echo # OPENAI_API_KEY=sk-... >> .env
    echo # GEMINI_API_KEY=... >> .env
)

REM Copier le fichier models.toml dans le répertoire docker s'il existe
if exist "docker" if exist "models.toml" (
    echo Copie du fichier models.toml dans le répertoire docker...
    copy models.toml docker\
)

echo.
echo Initialisation terminée !
echo.
echo Étapes suivantes :
echo 1. Ajoutez vos clés API dans le fichier .env
echo 2. Installez Ollama si vous voulez utiliser des modèles locaux ^(https://ollama.com/download^)
echo 3. Démarrez Bytebot avec la commande appropriée :
echo    - Sur Windows : bytebot.bat
echo.