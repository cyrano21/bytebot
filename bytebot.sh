#!/bin/bash
# Script shell pour démarrer/arrêter Bytebot (Linux/macOS)

COMMAND=${1:-start}

start_services() {
    echo "=== Démarrage de Bytebot ==="
    
    # Vérifier si Node.js est installé
    if ! command -v node &> /dev/null; then
        echo "ERREUR: Node.js n'est pas installé."
        echo "Veuillez installer Node.js (version 18 ou supérieure) avant de continuer."
        exit 1
    fi
    
    # Vérifier si npm est installé
    if ! command -v npm &> /dev/null; then
        echo "ERREUR: npm n'est pas installé."
        echo "Veuillez installer Node.js/npm avant de continuer."
        exit 1
    fi
    
    # Afficher les versions
    echo "Node.js version: $(node --version)"
    echo "npm version: $(npm --version)"
    
    # Créer le répertoire de logs si nécessaire
    mkdir -p logs
    
    # Démarrage de l'agent Bytebot
    echo "Démarrage de l'agent Bytebot..."
    cd packages/bytebot-agent
    
    # Installer les dépendances si nécessaire
    if [ ! -d "node_modules" ]; then
        echo "Installation des dépendances de l'agent..."
        npm install
    fi
    
    # Démarrer l'agent en arrière-plan
    npm start &
    cd ../..
    
    # Démarrage de l'interface utilisateur
    echo "Démarrage de l'interface utilisateur..."
    cd packages/bytebot-ui
    
    # Installer les dépendances si nécessaire
    if [ ! -d "node_modules" ]; then
        echo "Installation des dépendances de l'interface..."
        npm install
    fi
    
    # Démarrer l'interface en arrière-plan
    npm run dev &
    cd ../..
    
    echo ""
    echo "Bytebot est maintenant en cours d'exécution !"
    echo ""
    echo "Vous pouvez accéder aux interfaces via :"
    echo "  - Interface utilisateur: http://localhost:3000"
    echo "  - API de l'agent: http://localhost:3001"
    echo ""
    echo "Appuyez sur Ctrl+C pour arrêter les services."
}

stop_services() {
    echo "=== Arrêt de Bytebot ==="
    
    # Tuer tous les processus Node.js
    echo "Arrêt des processus Node.js..."
    pkill -f "node.*npm.*start" 2>/dev/null
    pkill -f "node.*npm.*run.*dev" 2>/dev/null
    
    echo "Services arrêtés."
}

# Exécuter la commande appropriée
case "$COMMAND" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    *)
        echo "Commande inconnue. Utilisez 'start' ou 'stop'."
        exit 1
        ;;
esac