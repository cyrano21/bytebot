#!/bin/bash
# Script d'initialisation pour configurer l'environnement Bytebot

echo "=== Initialisation de l'environnement Bytebot ==="

# Vérifier si nous sommes sur Windows
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    PLATFORM="windows"
    echo "Plateforme détectée: Windows"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macos"
    echo "Plateforme détectée: macOS"
else
    PLATFORM="linux"
    echo "Plateforme détectée: Linux"
fi

# Installer les dépendances Python
echo "Installation des dépendances Python..."
pip install -r requirements.txt

# Créer le fichier .env s'il n'existe pas
if [ ! -f ".env" ]; then
    echo "Création du fichier .env..."
    echo "# Clé API OpenRouter" > .env
    echo "# OPENROUTER_API_KEY=sk-or-v1-..." >> .env
    echo "" >> .env
    echo "# Clés API pour les fournisseurs d'IA" >> .env
    echo "# ANTHROPIC_API_KEY=sk-ant-..." >> .env
    echo "# OPENAI_API_KEY=sk-..." >> .env
    echo "# GEMINI_API_KEY=..." >> .env
fi

# Copier le fichier models.toml dans le répertoire docker s'il existe
if [ -d "docker" ] && [ -f "models.toml" ]; then
    echo "Copie du fichier models.toml dans le répertoire docker..."
    cp models.toml docker/
fi

echo ""
echo "Initialisation terminée !"
echo ""
echo "Étapes suivantes :"
echo "1. Ajoutez vos clés API dans le fichier .env"
echo "2. Installez Ollama si vous voulez utiliser des modèles locaux (https://ollama.com/download)"
echo "3. Démarrez Bytebot avec la commande appropriée :"
echo "   - Sur Windows : bytebot.bat"
echo "   - Sur Linux/macOS : ./bytebot.sh"
echo ""