#!/usr/bin/env python3
"""Check status of recent tasks"""

import requests
import time
from datetime import datetime, timedelta

API_URL = "http://localhost:9991/api"

def get_recent_tasks(limit=10):
    """Get recent tasks"""
    try:
        response = requests.get(f"{API_URL}/tasks")
        response.raise_for_status()
        data = response.json()
        
        # Handle if response is wrapped in an object
        if isinstance(data, dict):
            tasks = data.get('tasks', data.get('data', []))
            if not isinstance(tasks, list):
                # If still not a list, try to get values
                tasks = list(data.values()) if data else []
        else:
            tasks = data
        
        # Sort by created time and get most recent
        if tasks and isinstance(tasks, list):
            tasks.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
            return tasks[:limit]
        return []
    except Exception as e:
        print(f"Error getting tasks: {e}")
        return []

def main():
    print("=" * 70)
    print("RECENT TASK STATUS CHECK")
    print("=" * 70)
    
    tasks = get_recent_tasks(10)
    
    if not tasks:
        print("No tasks found")
        return
    
    for task in tasks:
        created_at = task.get('createdAt', 'Unknown')
        model_name = task.get('model', {}).get('name', 'Unknown')
        status = task.get('status', 'Unknown')
        description = task.get('description', 'No description')[:50]
        
        # Color code status
        status_display = status
        if status == 'COMPLETED':
            status_display = f"[OK] {status}"
        elif status == 'FAILED':
            status_display = f"[FAIL] {status}"
        elif status == 'RUNNING':
            status_display = f"[RUN] {status}"
        else:
            status_display = f"[ ] {status}"
        
        print(f"\nTask ID: {task.get('id', 'Unknown')[:8]}...")
        print(f"  Created: {created_at}")
        print(f"  Model: {model_name}")
        print(f"  Status: {status_display}")
        print(f"  Description: {description}")
    
    print("\n" + "=" * 70)
    
    # Count statuses
    status_counts = {}
    for task in tasks:
        status = task.get('status', 'Unknown')
        status_counts[status] = status_counts.get(status, 0) + 1
    
    print("STATUS SUMMARY:")
    for status, count in status_counts.items():
        print(f"  {status}: {count}")
    
    print("=" * 70)

if __name__ == "__main__":
    main()
