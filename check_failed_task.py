#!/usr/bin/env python3
"""
Check the last failed task details directly from PostgreSQL
"""

import psycopg2
import json
from datetime import datetime, timedelta

# Connect to PostgreSQL
conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="bytebotdb",
    user="postgres",
    password="postgres"
)

cur = conn.cursor()

# Get the last failed task
cur.execute("""
    SELECT id, description, status, error, result, model, created_at, updated_at 
    FROM "Task" 
    WHERE status = 'FAILED'
    ORDER BY updated_at DESC 
    LIMIT 1
""")

result = cur.fetchone()

if result:
    id, description, status, error, result_json, model, created_at, updated_at = result
    print("=" * 70)
    print("LAST FAILED TASK")
    print("=" * 70)
    print(f"ID: {id}")
    print(f"Description: {description}")
    print(f"Status: {status}")
    print(f"Model: {json.dumps(model, indent=2) if model else 'None'}")
    print(f"Error: {error}")
    print(f"Result: {json.dumps(result_json, indent=2) if result_json else 'None'}")
    print(f"Created: {created_at}")
    print(f"Updated: {updated_at}")
    print()
    
    # Get messages for this task
    print("=" * 70)
    print("TASK MESSAGES")
    print("=" * 70)
    cur.execute("""
        SELECT id, role, content, created_at
        FROM "Message"
        WHERE "taskId" = %s
        ORDER BY created_at ASC
    """, (id,))
    
    messages = cur.fetchall()
    for msg_id, role, content_json, created in messages:
        content_data = json.loads(content_json) if isinstance(content_json, str) else content_json
        print(f"\n[{created}] {role}:")
        if isinstance(content_data, list):
            for i, block in enumerate(content_data):
                print(f"  Block {i}: {block.get('type', 'unknown')}")
                if 'text' in block:
                    print(f"    Text: {block['text'][:50]}...")
        else:
            print(f"  {str(content_data)[:100]}")
else:
    print("No failed tasks found")

cur.close()
conn.close()
