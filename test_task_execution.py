#!/usr/bin/env python3
"""
Test task creation and execution via Bytebot Agent API
This tests the entire chain: UI → Agent → Proxy → LLM
"""

import requests
import json
import time
import sys

AGENT_URL = "http://localhost:9991"

def create_test_task():
    """Create a simple test task via the Agent API"""
    
    payload = {
        "type": "IMMEDIATE",
        "description": "Simple test task: Say hello in 5 words",
        "model": {
            "provider": "proxy",
            "name": "mistral-small",
            "title": "Mistral Small",
            "description": "Mistral's small open model",
            "badge": "✅ Fast & Free",
            "status": "free"
        },
        "priority": "MEDIUM",
    }
    
    try:
        print(f"Creating task...")
        response = requests.post(
            f"{AGENT_URL}/api/tasks",
            json=payload,
            timeout=10
        )
        
        if response.status_code in [200, 201]:
            task_data = response.json()
            task_id = task_data.get("id")
            print(f"✅ Task created: {task_id}")
            return task_id
        else:
            print(f"❌ Task creation failed: HTTP {response.status_code}")
            print(f"   Response: {response.text[:200]}")
            return None
            
    except Exception as e:
        print(f"❌ Error creating task: {e}")
        return None

def wait_for_task_complete(task_id: str, timeout: int = 60):
    """Wait for task to complete and check result"""
    
    start_time = time.time()
    last_status = None
    
    while time.time() - start_time < timeout:
        try:
            response = requests.get(
                f"{AGENT_URL}/api/tasks/{task_id}",
                timeout=5
            )
            
            if response.status_code == 200:
                task = response.json()
                status = task.get("status")
                
                if status != last_status:
                    print(f"  Status: {status}")
                    last_status = status
                
                if status == "COMPLETED":
                    result = task.get("result", "")
                    print(f"✅ Task completed!")
                    print(f"   Result: {result[:100]}")
                    return True
                elif status == "FAILED":
                    error = task.get("error", "Unknown error")
                    print(f"❌ Task failed: {error}")
                    return False
            
            time.sleep(2)
            
        except requests.exceptions.Timeout:
            print(f"  ⏱️  Timeout checking task status...")
        except Exception as e:
            print(f"  Error: {e}")
            time.sleep(2)
    
    print(f"❌ Task did not complete within {timeout} seconds")
    return False

def main():
    print("=" * 70)
    print("BYTEBOT TASK EXECUTION TEST")
    print("=" * 70)
    
    print("\nTesting: UI → Agent → Proxy → LLM")
    print("-" * 70)
    
    # Create task
    task_id = create_test_task()
    if not task_id:
        print("\n⚠️  Cannot proceed - task creation failed")
        return False
    
    # Wait for completion
    print(f"\nWaiting for task to complete...")
    success = wait_for_task_complete(task_id)
    
    print("\n" + "=" * 70)
    if success:
        print("✅ SUCCESS! Full task execution chain is working!")
        print("   - Agent API responding")
        print("   - Proxy models accessible")
        print("   - LLM responding with results")
        print("\n   Next: Try creating tasks in the UI (http://localhost:9992)")
    else:
        print("❌ Task execution failed - check:")
        print("   - docker logs bytebot-agent")
        print("   - docker logs bytebot-llm-proxy")
    
    return success

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
