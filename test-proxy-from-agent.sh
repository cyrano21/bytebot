#!/bin/bash

# Test direct du proxy depuis le container agent qui a accès au réseau Docker

echo "🔍 Test du proxy depuis le container agent..."

# Test de connectivité au proxy
echo ""
echo "Test 1: Connectivité au proxy"
docker exec bytebot-agent sh -c 'wget -q -O- http://bytebot-llm-proxy:4000/health || echo "FAILED"' | head -5

# Test de la liste des modèles
echo ""
echo "Test 2: Liste des modèles"
docker exec bytebot-agent sh -c 'wget -q -O- http://bytebot-llm-proxy:4000/models 2>/dev/null | head -c 200' || echo "FAILED"

# Test d'un appel simple au modèle
echo ""
echo "Test 3: Appel au modèle Groq"
docker exec bytebot-agent sh -c 'cat > /tmp/test.json << '"'"'EOF'"'"'
{
  "model": "groq-llama-3.3",
  "messages": [
    {"role": "system", "content": "You are helpful"},
    {"role": "user", "content": "Say hello"}
  ],
  "max_tokens": 10
}
EOF
wget -q -O- --post-data @/tmp/test.json --header "Content-Type: application/json" http://bytebot-llm-proxy:4000/v1/chat/completions 2>/dev/null | head -c 300' || echo "FAILED"

echo ""
echo "✅ Tests directement depuis le container agent terminés"
