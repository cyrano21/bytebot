#!/bin/bash
# Script de démarrage simplifié pour Bytebot

echo "=== Démarrage de Bytebot ==="

# Création du répertoire de logs si nécessaire
mkdir -p logs

# Démarrage du bureau virtuel (Xvfb)
echo "Démarrage du serveur X virtuel..."
Xvfb :99 -screen 0 1024x768x24 &
echo $! > /tmp/xvfb.pid

# Attente que Xvfb démarre
sleep 2

# Configuration de l'affichage
export DISPLAY=:99

# Démarrage du gestionnaire de fenêtres XFCE
echo "Démarrage de XFCE..."
xfce4-session &
echo $! > /tmp/xfce.pid

# Attente que XFCE démarre
sleep 3

# Démarrage du serveur VNC pour l'accès à distance
echo "Démarrage du serveur VNC..."
x11vnc -display :99 -rfbport 5900 -shared -forever -passwd bytebot &
echo $! > /tmp/x11vnc.pid

# Démarrage de l'agent Bytebot
echo "Démarrage de l'agent Bytebot..."
cd packages/bytebot-agent
npm start &
echo $! > /tmp/bytebot-agent.pid
cd ../../

echo "Bytebot est maintenant en cours d'exécution !"
echo ""
echo "Vous pouvez accéder à l'interface via :"
echo "  - Bureau virtuel VNC : localhost:5900 (mot de passe: bytebot)"
echo ""
echo "Pour arrêter Bytebot, appuyez sur Ctrl+C ou exécutez stop-bytebot.sh"