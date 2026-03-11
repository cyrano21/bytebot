# Bytebot - Configuration des Modèles

Ce projet contient les configurations pour utiliser différents modèles d'IA, notamment les modèles locaux Ollama et les modèles distants via OpenRouter.

## Fichiers de Configuration

### `.env`
Contient la clé API OpenRouter :
```
OPENROUTER_API_KEY=sk-or-v1-...
```

### `models.toml`
Fichier de configuration des modèles avec les sections suivantes :
- `[models]` : Liste des modèles disponibles
- `[default]` : Modèle par défaut à utiliser

## Utilisation

### En Python
```python
from packages.model_config import ModelConfig

# Charger la configuration
config = ModelConfig()

# Obtenir le modèle par défaut
default_model = config.get_default_model()

# Obtenir le nom réel du modèle
actual_name = config.get_model_name(default_model)

# Lister tous les modèles
models = config.list_models()
```

### Variables d'environnement requises
- `OPENROUTER_API_KEY` : Clé API pour OpenRouter

## Modèles Disponibles

### Modèles Ollama Locaux
- `ollama.gemma3-12b`
- `ollama.gemma3-27b`
- `ollama.llama3.1-8b`
- `ollama.qwen3-30b`
- `ollama.deepseek-r1-14b`
- `ollama.deepseek-r1-32b`
- `ollama.qwq`
- `ollama.magistral`

### Modèles OpenRouter (Gratuits)
- `openrouter.gemma3-7b`
- `openrouter.llama3.1-8b`
- `openrouter.llama3.2-3b`
- `openrouter.qwen2.5-7b`
- `openrouter.qwen2.5-coder-7b`
- `openrouter.phi4-14b`

## Installation des Dépendances

```bash
pip install -r requirements.txt
```