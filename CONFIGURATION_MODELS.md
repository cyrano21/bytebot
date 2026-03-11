# Configuration des Modèles LLM - Bytebot

Guide complet pour configurer tous les modèles disponibles dans Bytebot.

## 📋 Table des matières

1. [Modèles gratuits préconfigurés](#modèles-gratuits-préconfigurés)
2. [Modèles à configurer](#modèles-à-configurer)
3. [Clés API requises](#clés-api-requises)
4. [Configuration détaillée](#configuration-détaillée)

---

## ✅ Modèles gratuits préconfigurés

Ces modèles fonctionnent **directement sans configuration** :

### 🚀 Groq (Ultra-rapide - Gratuit)

- **groq-llama-3.3** : Llama 3.3 70b Versatile
- **groq-llama-3.1-8b** : Llama 3.1 8b Instant (très rapide)
- **groq-qwen-3.2b** : Qwen 3 32b

**Status** : ✅ Prêt via variable d'environnement
**Clé API** : `GROQ_API_KEY`

### ⚡ Mistral (Gratuit avec limite)

- **mistral-small** : Rapide et léger
- **mistral-medium** : Équilibre qualité/vitesse
- **mistral-large** : Très puissant

**Status** : ✅ Prêt via variable d'environnement
**Clé API** : `MISTRAL_API_KEY`

### 🔴 Ollama Local (Gratuit - Offline)

- **llama3.1** : Llama 3.1
- **codellama** : Spécialisé programmation
- **mistral** : Modèle local

**Status** : ⚠️ Offline (192.168.1.47:11434 non accessible)
**Action** : Démarrer Ollama sur votre machine

---

## ⚙️ Modèles à configurer

### 🟦 Google Gemini (Gratuit avec limite)

**Étapes** :

1. Aller sur : https://makersuite.google.com/app/apikeys
2. Créer une nouvelle clé API
3. Copier la clé API (commence par `AIzaSy...`)
4. Remplacer dans `litellm-config.yaml` :

```yaml
- model_name: gemini-2.0-flash
  litellm_params:
    model: gemini-2.0-flash
    api_key: AIzaSyA_VOTRE_CLÉ_ICI # ← Remplacer
    drop_params: true
```

**Modèles disponibles** :

- `gemini-2.0-flash` : Très rapide
- `gemini-1.5-pro` : Plus puissant

---

### 🤗 Hugging Face (Gratuit avec limite)

**Étapes** :

1. Créer un compte : https://huggingface.co/join
2. Générer un token : https://huggingface.co/settings/tokens
3. Copier le token (commence par `hf_...`)
4. Remplacer dans `litellm-config.yaml` :

```yaml
- model_name: huggingface-mistral-7b
  litellm_params:
    model: huggingfaceh4/zephyr-7b-beta
    api_key: hf_VOTRE_TOKEN_ICI # ← Remplacer
    drop_params: true
```

**Modèles disponibles** :

- `huggingfaceh4/zephyr-7b-beta` : Bon rapport qualité/vitesse
- `meta-llama/Llama-2-7b-chat-hf` : Llama 2 officiel

---

### ☁️ Ollama Cloud (Gratuit - API distante)

**Étapes** :

1. **Option A** : Déployer Ollama sur un serveur distant

   - https://github.com/ollama/ollama

2. **Option B** : Utiliser Ollama Cloud (si disponible)

   - Accéder à votre instance Ollama

3. Remplacer dans `litellm-config.yaml` :

```yaml
- model_name: ollama-cloud-llama2
  litellm_params:
    model: ollama/llama2
    api_base: https://votre-ollama.com:11434 # ← Remplacer par votre URL
    drop_params: true
```

**Note** : L'URL doit être accessible publiquement avec HTTPS

---

## 🔑 Clés API requises

| Provider          | Clé          | Status             | URL                                    |
| ----------------- | ------------ | ------------------ | -------------------------------------- |
| **Groq**          | `GROQ_API_KEY` | ✅ À injecter    | https://console.groq.com               |
| **Mistral**       | `MISTRAL_API_KEY` | ✅ À injecter | https://console.mistral.ai             |
| **Google Gemini** | AIzaSy...    | ⚠️ À configurer    | https://makersuite.google.com          |
| **Hugging Face**  | hf\_...      | ⚠️ À configurer    | https://huggingface.co/settings/tokens |
| **Ollama Cloud**  | (aucune)     | ⚠️ À configurer    | Votre URL Ollama                       |
| **OpenRouter**    | sk-or-v1-... | ❌ Crédits épuisés | https://openrouter.ai                  |

---

## 📝 Configuration détaillée

### Exemple complet de `litellm-config.yaml`

```yaml
model_list:
  # Groq - Déjà configuré ✅
  - model_name: groq-llama-3.3
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: os.environ/GROQ_API_KEY
      drop_params: true

  # Mistral - Déjà configuré ✅
  - model_name: mistral-small
    litellm_params:
      model: mistral/mistral-small-latest
      api_key: os.environ/MISTRAL_API_KEY
      drop_params: true

  # Google Gemini - À configurer
  - model_name: gemini-2.0-flash
    litellm_params:
      model: gemini-2.0-flash
      api_key: AIzaSy_VOTRE_CLÉ_GOOGLE_GEMINI # ← À remplir
      drop_params: true

  # Hugging Face - À configurer
  - model_name: huggingface-mistral-7b
    litellm_params:
      model: huggingfaceh4/zephyr-7b-beta
      api_key: hf_VOTRE_TOKEN_HUGGING_FACE # ← À remplir
      drop_params: true

  # Ollama Cloud - À configurer
  - model_name: ollama-cloud-llama2
    litellm_params:
      model: ollama/llama2
      api_base: https://VOTRE_URL_OLLAMA # ← À remplir
      drop_params: true

litellm_settings:
  drop_params: true
```

---

## ✅ Checklist de configuration

- [ ] Google Gemini : Clé API ajoutée dans `litellm-config.yaml`
- [ ] Hugging Face : Token ajouté dans `litellm-config.yaml`
- [ ] Ollama Cloud : URL distante configurée
- [ ] Proxy redémarré après modification
- [ ] Vérifier les modèles dans l'interface : http://localhost:9992
- [ ] Tester chaque modèle configuré

---

## 🔄 Redémarrer le proxy

Une fois les modifications apportées à `litellm-config.yaml` :

```bash
docker restart bytebot-llm-proxy
```

Puis vérifier les logs :

```bash
docker logs bytebot-llm-proxy --tail 20 | grep "Set models"
```

---

## 🆘 Dépannage

### Les nouveaux modèles n'apparaissent pas

- ✅ Redémarrer le proxy : `docker restart bytebot-llm-proxy`
- ✅ Vérifier la syntaxe YAML : Pas de tabulations, uniquement des espaces
- ✅ Vérifier les logs : `docker logs bytebot-llm-proxy`

### Erreur "Invalid API Key"

- ✅ Vérifier que la clé est correcte
- ✅ Vérifier que la clé n'a pas expiré
- ✅ Tester la clé directement via curl

### Modèle timeout

- ✅ Vérifier la connexion internet
- ✅ Vérifier que l'API est accessible
- ✅ Augmenter le timeout si nécessaire

---

## 📊 Comparaison des modèles

| Modèle            | Vitesse  | Qualité    | Coût             | Notes                |
| ----------------- | -------- | ---------- | ---------------- | -------------------- |
| Groq Llama 3.3    | 🚀🚀🚀   | ⭐⭐⭐⭐   | Gratuit          | **MEILLEUR RAPPORT** |
| Groq Llama 3.1 8b | 🚀🚀🚀🚀 | ⭐⭐⭐     | Gratuit          | Ultra-rapide, petit  |
| Mistral Medium    | ⚡⚡⚡   | ⭐⭐⭐⭐   | Gratuit (limite) | Équilibré            |
| Gemini 2.0 Flash  | ⚡⚡⚡   | ⭐⭐⭐⭐   | Gratuit (limite) | Rapide et performant |
| Mistral Large     | ⚡⚡     | ⭐⭐⭐⭐⭐ | Gratuit (limite) | Très puissant        |
| Ollama Local      | ⚡⚡     | ⭐⭐⭐     | Gratuit          | Dépend du PC         |

---

**Besoin d'aide ?** Consultez la documentation LiteLLM : https://docs.litellm.ai
