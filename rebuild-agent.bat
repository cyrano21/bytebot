@echo off
cd /d f:\bytebot
docker compose -f docker/docker-compose.yml build bytebot-agent --no-cache
docker compose -f docker/docker-compose.yml restart bytebot-agent
echo Agent rebuilt and restarted
