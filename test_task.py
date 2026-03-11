#!/usr/bin/env python3
"""
Test script to create a simple task and check if models work
"""

import requests
import json
import time
import sys

# Configuration
AGENT_URL = "http://localhost:9991"

def create_test_task(description, model_name):
    """Create a test task with specified model"""
    try:
        payload = {
            "description": description,
            "type": "IMMEDIATE",
            "priority": "MEDIUM",
            "model": {
                "provider": "proxy",
                "name": model_name
            }
        }
        
        response = requests.post(
            f"{AGENT_URL}/api/tasks",
            json=payload,
            timeout=10
        )
        
        if response.status_code == 201:
            task = response.json()
            print(f"[OK] Task created: {task['id']}")
            return task['id']
        else:
            print(f"[ERROR] Failed to create task: HTTP {response.status_code}")
            print(f"  Response: {response.text}")
            return None
    except Exception as e:
        print(f"[ERROR] Failed to create task: {e}")
        return None

def check_task_status(task_id):
    """Check the status of a task"""
    try:
        response = requests.get(
            f"{AGENT_URL}/api/tasks/{task_id}",
            timeout=10
        )
        
        if response.status_code == 200:
            task = response.json()
            return task['status']
        else:
            return "ERROR"
    except Exception as e:
        print(f"[ERROR] Failed to check task status: {e}")
        return "ERROR"

def main():
    print("=" * 70)
    print("BYTEBOT TASK EXECUTION TEST")
    print("=" * 70)
    
    # Test models that were failing
    test_cases = [
        ("groq-llama-3.3", "Say hello world in exactly 5 words"),
        ("mistral-small", "Say hello world in exactly 5 words"),
    ]
    
    for model_name, description in test_cases:
        print(f"\n[TESTING] Model: {model_name}")
        print(f"  Task: {description}")
        
        # Create task
        task_id = create_test_task(description, model_name)
        if not task_id:
            continue
        
        # Wait and check status
        print("  Waiting for task to complete...")
        for i in range(30):  # Wait up to 30 seconds
            time.sleep(1)
            status = check_task_status(task_id)
            
            if status in ["COMPLETED", "FAILED", "NEEDS_HELP"]:
                print(f"  Final status: {status}")
                if status == "COMPLETED":
                    print(f"  [SUCCESS] Model {model_name} works!")
                else:
                    print(f"  [FAILURE] Model {model_name} failed")
                break
        else:
            print(f"  [TIMEOUT] Task did not complete in 30 seconds")
    
    print("\n" + "=" * 70)
    print("TEST COMPLETE")
    print("=" * 70)

if __name__ == "__main__":
    main()
