#!/bin/bash
# Script d'arrêt pour Bytebot

echo "=== Arrêt de Bytebot ==="

# Arrêt de l'agent Bytebot
if [ -f /tmp/bytebot-agent.pid ]; then
    echo "Arrêt de l'agent Bytebot..."
    kill $(cat /tmp/bytebot-agent.pid)
    rm /tmp/bytebot-agent.pid
fi

# Arrêt du serveur VNC
if [ -f /tmp/x11vnc.pid ]; then
    echo "Arrêt du serveur VNC..."
    kill $(cat /tmp/x11vnc.pid)
    rm /tmp/x11vnc.pid
fi

# Arrêt de XFCE
if [ -f /tmp/xfce.pid ]; then
    echo "Arrêt de XFCE..."
    kill $(cat /tmp/xfce.pid)
    rm /tmp/xfce.pid
fi

# Arrêt de Xvfb
if [ -f /tmp/xvfb.pid ]; then
    echo "Arrêt du serveur X virtuel..."
    kill $(cat /tmp/xvfb.pid)
    rm /tmp/xvfb.pid
fi

echo "Bytebot a été arrêté."