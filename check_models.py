#!/usr/bin/env python3
import requests
import json

try:
    r = requests.get('http://localhost:40001/v1/models', timeout=5)
    data = r.json()
    models = data.get('data', [])
    print(f"✅ LiteLLM Proxy: {len(models)} models available")
    print("\nModels list:")
    for model in models:
        print(f"  - {model['id']}")
except Exception as e:
    print(f"❌ Error: {e}")
