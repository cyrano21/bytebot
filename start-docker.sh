#!/bin/bash
# Script de démarrage de l'application Bytebot avec Docker

echo "=== Démarrage de l'application Bytebot avec Docker ==="

# Vérifier si Docker est installé
if ! command -v docker &> /dev/null
then
    echo "Docker n'est pas installé. Veuillez installer Docker avant de continuer."
    exit 1
fi

# Vérifier si Docker Compose est installé
if ! command -v docker-compose &> /dev/null
then
    echo "Docker Compose n'est pas installé. Veuillez installer Docker Compose avant de continuer."
    exit 1
fi

# Aller dans le répertoire docker
cd docker

# Démarrer les services
echo "Démarrage des services Docker..."
docker-compose up -d

# Vérifier si les services ont démarré correctement
echo "Vérification des services..."
sleep 10

if docker-compose ps | grep -q "running"; then
    echo "Les services ont démarré avec succès !"
    echo ""
    echo "Accès aux services :"
    echo "  - Bytebot Desktop: http://localhost:9990"
    echo "  - Base de données PostgreSQL: localhost:5432"
    echo ""
    echo "Pour arrêter les services, exécutez : docker-compose down"
else
    echo "Erreur lors du démarrage des services. Vérifiez les logs avec : docker-compose logs"
fi