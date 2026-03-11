@echo off
cd /d f:\bytebot
echo Building agent...
docker compose -f docker/docker-compose.yml build bytebot-agent --no-cache
echo Restarting agent...
docker compose -f docker/docker-compose.yml restart bytebot-agent
echo Done!
