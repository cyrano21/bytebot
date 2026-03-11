#!/usr/bin/env python3
"""
Test script to verify LiteLLM proxy is working correctly
and task execution is no longer failing
"""

import requests
import json
import time
from typing import List, Dict

# Configuration
PROXY_URL = "http://localhost:40001"
AGENT_URL = "http://localhost:9991"

def get_available_models() -> List[Dict]:
    """Get list of available models from proxy"""
    try:
        response = requests.get(f"{PROXY_URL}/models", timeout=5)
        response.raise_for_status()
        data = response.json()
        models = data.get("data", [])
        return models
    except Exception as e:
        print(f"[ERROR] Error getting models: {e}")
        return []

def test_proxy_connectivity() -> bool:
    """Test if proxy is accessible"""
    try:
        response = requests.get(f"{PROXY_URL}/health", timeout=5)
        print(f"[OK] Proxy is accessible (HTTP {response.status_code})")
        return True
    except requests.exceptions.ConnectionError:
        print(f"[ERROR] Cannot connect to proxy at {PROXY_URL}")
        print("   Make sure docker containers are running: docker compose ps")
        return False
    except Exception as e:
        print(f"[ERROR] Proxy health check failed: {e}")
        return False

def test_model_response(model_name: str) -> bool:
    """Test if a specific model can be called"""
    try:
        payload = {
            "model": model_name,
            "messages": [
                {"role": "user", "content": "Say 'test' and nothing else"}
            ],
            "max_tokens": 10,
            "temperature": 0.1
        }
        
        response = requests.post(
            f"{PROXY_URL}/v1/chat/completions",
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            if "choices" in data and len(data["choices"]) > 0:
                content = data["choices"][0].get("message", {}).get("content", "")
                print(f"  [OK] {model_name}: {content.strip()[:50]}")
                return True
            else:
                print(f"  [WARNING] {model_name}: No choices in response")
                return False
        else:
            print(f"  [ERROR] {model_name}: HTTP {response.status_code}")
            if response.text:
                print(f"     Error: {response.text[:100]}")
            return False
    except requests.exceptions.Timeout:
        print(f"  [TIMEOUT] {model_name}: Timeout (30s) - may indicate connection issue")
        return False
    except Exception as e:
        print(f"  [ERROR] {model_name}: {str(e)[:50]}")
        return False

def main():
    # Set UTF-8 encoding for Windows
    import sys
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    
    print("=" * 70)
    print("BYTEBOT LLM PROXY TEST")
    print("=" * 70)
    
    # Test 1: Proxy connectivity
    print("\n[TEST 1] Proxy Connectivity")
    if not test_proxy_connectivity():
        print("\n[WARNING] Cannot proceed - proxy is not accessible")
        return
    
    # Test 2: Get available models
    print("\n[TEST 2] Available Models")
    models = get_available_models()
    print(f"Found {len(models)} models:")
    for model in models[:5]:
        print(f"  - {model.get('id', 'UNKNOWN')}")
    if len(models) > 5:
        print(f"  ... and {len(models) - 5} more")
    
    # Test 3: Quick test of a few models
    print("\n[TEST 3] Model Response Test")
    print("Testing selected models (this may take a minute):")
    
    test_models = [
        "groq-llama-3.3",  # Should work - Groq is fast
        "mistral-small",   # Should work - Mistral
        "gemini-2.0-flash" # Should work - Gemini
    ]
    
    success_count = 0
    for model in test_models:
        if test_model_response(model):
            success_count += 1
        time.sleep(1)  # Rate limit
    
    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    print(f"[SUCCESS] {success_count}/{len(test_models)} models responding correctly")
    
    if success_count > 0:
        print("\n[SUCCESS] PROXY WORKING! Task execution should now complete successfully.")
        print("   Next: Try creating a task in the Bytebot UI")
    else:
        print("\n[FAILURE] Models not responding. Check:")
        print("   - docker logs bytebot-llm-proxy")
        print("   - API keys in litellm-config.yaml")
        print("   - Internet connectivity for API calls")

if __name__ == "__main__":
    main()
