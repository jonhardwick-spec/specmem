#!/usr/bin/env python3
"""
BigBrain Migration: Fix corrupted embeddings - CONCURRENT MODE
Uses ThreadPoolExecutor for parallel embedding generation
"""

import socket
import json
import psycopg2
import sys
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

SOCKET_PATH = '/newServer/specmem/sockets/embeddings.sock'
MAX_WORKERS = 20  # 20 parallel connections
PROJECT = '/newServer'

def get_embedding(text):
    """Get single embedding"""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(30)
    sock.connect(SOCKET_PATH)
    sock.send(json.dumps({'type': 'embed', 'text': text}).encode() + b'\n')

    response = b''
    while b'\n' not in response:
        chunk = sock.recv(65536)
        if not chunk:
            break
        response += chunk
    sock.close()

    data = json.loads(response.decode().strip())
    if 'embedding' not in data:
        raise Exception(f"No embedding: {data}")
    return data['embedding']

def process_memory(args):
    """Process single memory - returns (id, embedding)"""
    mem_id, content = args
    try:
        embedding = get_embedding(content)
        return (mem_id, embedding, None)
    except Exception as e:
        return (mem_id, None, str(e))

def main():
    print(f"{'='*60}")
    print(f"CONCURRENT EMBEDDING MIGRATION - {MAX_WORKERS} workers")
    print(f"{'='*60}")
    start = datetime.now()

    conn = psycopg2.connect(
        host='localhost', port=5432,
        dbname='specmem_westayunprofessional',
        user='specmem_westayunprofessional',
        password='specmem_westayunprofessional'
    )
    cur = conn.cursor()

    # Get all memories
    cur.execute("""
        SELECT id, content FROM memories
        WHERE project_path = %s AND embedding IS NOT NULL
        ORDER BY created_at DESC
    """, (PROJECT,))
    memories = cur.fetchall()
    total = len(memories)
    print(f"Found {total} memories to re-embed")
    print()

    # Process with thread pool
    updated = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_memory, m): m[0] for m in memories}

        for future in as_completed(futures):
            mem_id, embedding, error = future.result()

            if error:
                errors += 1
                print(f"ERROR {mem_id}: {error}")
            else:
                emb_str = '[' + ','.join(str(x) for x in embedding) + ']'
                cur.execute("UPDATE memories SET embedding = %s::vector WHERE id = %s", (emb_str, mem_id))
                updated += 1

            # Commit every 50 and show progress
            if (updated + errors) % 50 == 0:
                conn.commit()
                elapsed = (datetime.now() - start).total_seconds()
                done = updated + errors
                rate = done / elapsed if elapsed > 0 else 0
                print(f"Progress: {done}/{total} ({100*done/total:.0f}%) - {rate:.0f}/sec")

    conn.commit()
    elapsed = (datetime.now() - start).total_seconds()

    print(f"\n{'='*60}")
    print(f"DONE! {updated} updated, {errors} errors in {elapsed:.1f}s")
    print(f"Rate: {updated/elapsed:.0f} embeddings/sec")
    print(f"{'='*60}")

    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
