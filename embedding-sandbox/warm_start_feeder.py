#!/usr/bin/env python3
"""
WARM START FEEDER - PostgreSQL Edition

Handles AI container startup:

COLD START:
  - Feed entire SpecMem database (all memories + codebase_files)
  - Full model training on existing data

WARM START (unpause):
  - Feed only what changed while paused (overflow queue + new memories)
  - Delta updates only

Also handles:
- Training data accumulation (5GB cap)
- 30-day unused data purge
- Priority-based processing
"""

import os
import hashlib as _hashlib_early
SPECMEM_HOME = os.environ.get('SPECMEM_HOME', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPECMEM_RUN_DIR = os.environ.get('SPECMEM_RUN_DIR', os.path.join(SPECMEM_HOME, 'run'))
SPECMEM_SOCKET_DIR = os.environ.get('SPECMEM_SOCKET_DIR', SPECMEM_RUN_DIR)

# Project hash for path isolation
_project_path = os.environ.get('SPECMEM_PROJECT_PATH', os.getcwd())
SPECMEM_PROJECT_HASH = os.environ.get('SPECMEM_PROJECT_HASH',
    _hashlib_early.sha256(os.path.abspath(_project_path).encode()).hexdigest()[:12])

import sys
import json
import time
import socket
import hashlib
import argparse
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

import psycopg2
from psycopg2.extras import RealDictCursor, Json

# Database configs
OVERFLOW_DB = {
    'host': os.environ.get('OVERFLOW_DB_HOST', os.environ.get('SPECMEM_DB_HOST', 'localhost')),
    'port': os.environ.get('OVERFLOW_DB_PORT', os.environ.get('SPECMEM_DB_PORT', '5432')),
    'dbname': os.environ.get('OVERFLOW_DB_NAME', 'specmem_overflow'),
    'user': os.environ.get('OVERFLOW_DB_USER', os.environ.get('SPECMEM_DB_USER', 'specmem_westayunprofessional')),
    'password': os.environ.get('OVERFLOW_DB_PASSWORD', os.environ.get('SPECMEM_DB_PASSWORD', 'specmem_westayunprofessional'))
}

SPECMEM_DB = {
    'host': os.environ.get('SPECMEM_DB_HOST', 'localhost'),
    'port': os.environ.get('SPECMEM_DB_PORT', '5432'),
    'dbname': os.environ.get('SPECMEM_DB_NAME', 'specmem_westayunprofessional'),
    'user': os.environ.get('SPECMEM_DB_USER', 'specmem_westayunprofessional'),
    'password': os.environ.get('SPECMEM_DB_PASSWORD', 'specmem_westayunprofessional')
}

# Socket paths
EMBEDDING_SOCKET = os.path.join(SPECMEM_SOCKET_DIR, 'embeddings.sock')
COT_SOCKET = os.path.join(SPECMEM_SOCKET_DIR, 'mini-cot.sock')

# Limits (as per user spec)
MAX_TRAINING_SIZE_GB = 5   # 5GB overflow cap
PURGE_DAYS = 30            # 30-day unused data purge
BATCH_SIZE = 50

# Track last pause time for delta queries - project isolated
PAUSE_TRACKING_DIR = f'/var/lib/specmem-{SPECMEM_PROJECT_HASH}/overflow'
PAUSE_TRACKING_FILE = os.path.join(PAUSE_TRACKING_DIR, 'last_pause.txt')

# Ensure tracking directory exists
try:
    os.makedirs(PAUSE_TRACKING_DIR, exist_ok=True)
except PermissionError:
    # Fall back to tmp if /var/lib not writable
    PAUSE_TRACKING_DIR = f'/tmp/specmem-{SPECMEM_PROJECT_HASH}/overflow'
    PAUSE_TRACKING_FILE = os.path.join(PAUSE_TRACKING_DIR, 'last_pause.txt')
    os.makedirs(PAUSE_TRACKING_DIR, exist_ok=True)


class WarmStartFeeder:
    """Feeds queued data to AI on warm start, full data on cold start"""

    def __init__(self):
        self.overflow_conn = None
        self.specmem_conn = None

    def _get_overflow_conn(self):
        """Get overflow database connection"""
        if self.overflow_conn is None or self.overflow_conn.closed:
            self.overflow_conn = psycopg2.connect(**OVERFLOW_DB)
            self.overflow_conn.autocommit = True
        return self.overflow_conn

    def _get_specmem_conn(self):
        """Get SpecMem database connection"""
        if self.specmem_conn is None or self.specmem_conn.closed:
            self.specmem_conn = psycopg2.connect(**SPECMEM_DB)
            self.specmem_conn.autocommit = True
        return self.specmem_conn

    def socket_alive(self, socket_path: str) -> bool:
        """Check if a socket is responding"""
        if not os.path.exists(socket_path):
            return False
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(2)
            sock.connect(socket_path)
            sock.send(b'{"stats":true}\n')
            response = sock.recv(4096)
            sock.close()
            return b'total_' in response
        except Exception:
            return False

    def send_to_socket(self, socket_path: str, request: dict, timeout: int = 30) -> Optional[dict]:
        """Send request to socket and get response"""
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect(socket_path)
            sock.send((json.dumps(request) + '\n').encode())

            response = b''
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                response += chunk
                if b'\n' in response:
                    break

            sock.close()
            return json.loads(response.decode().strip())
        except Exception as e:
            print(f"  Socket error: {e}", file=sys.stderr)
            return None

    def get_pending_count(self) -> int:
        """Get count of pending overflow entries"""
        try:
            conn = self._get_overflow_conn()
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM embedding_queue WHERE status = 'pending'")
                return cur.fetchone()[0]
        except Exception:
            return 0

    def record_pause_time(self):
        """Record current time as pause timestamp"""
        os.makedirs(os.path.dirname(PAUSE_TRACKING_FILE), exist_ok=True)
        with open(PAUSE_TRACKING_FILE, 'w') as f:
            f.write(str(time.time()))

    def get_last_pause_time(self) -> Optional[float]:
        """Get last recorded pause time"""
        if os.path.exists(PAUSE_TRACKING_FILE):
            with open(PAUSE_TRACKING_FILE, 'r') as f:
                return float(f.read().strip())
        return None

    # =========================================================================
    # COLD START - Feed entire SpecMem database
    # =========================================================================

    def cold_start(self, socket_path: str = EMBEDDING_SOCKET) -> Dict[str, int]:
        """
        Cold start: Feed entire SpecMem database to AI.
        Used when container is freshly started (not resumed from pause).
        """
        stats = {'memories': 0, 'codebase': 0, 'errors': 0}

        if not self.socket_alive(socket_path):
            print(f"  Socket not alive: {socket_path}", file=sys.stderr)
            return stats

        print(f"  COLD START: Feeding entire SpecMem database...", file=sys.stderr)

        try:
            conn = self._get_specmem_conn()

            # Feed all memories
            print(f"  Feeding memories...", file=sys.stderr)
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, content, memory_type, importance, tags
                    FROM memories
                    WHERE embedding IS NOT NULL
                    ORDER BY created_at DESC
                    LIMIT 10000
                """)
                memories = cur.fetchall()

            for batch_start in range(0, len(memories), BATCH_SIZE):
                batch = memories[batch_start:batch_start + BATCH_SIZE]
                texts = [m['content'] for m in batch]

                result = self.send_to_socket(socket_path, {
                    'type': 'batch',
                    'texts': texts,
                    'priority': 'low'  # Background training
                })

                if result and 'embeddings' in result:
                    stats['memories'] += len(batch)
                    self._store_training_data('memories', texts, result)
                    print(".", end="", file=sys.stderr, flush=True)
                else:
                    stats['errors'] += 1

            print("", file=sys.stderr)

            # Feed codebase files
            print(f"  Feeding codebase files...", file=sys.stderr)
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, file_path, content, language_name
                    FROM codebase_files
                    WHERE embedding IS NOT NULL
                    ORDER BY updated_at DESC
                    LIMIT 10000
                """)
                files = cur.fetchall()

            for batch_start in range(0, len(files), BATCH_SIZE):
                batch = files[batch_start:batch_start + BATCH_SIZE]
                texts = [f"{f['file_path']}: {(f['content'] or '')[:500]}" for f in batch]

                result = self.send_to_socket(socket_path, {
                    'type': 'batch',
                    'texts': texts,
                    'priority': 'low'
                })

                if result and 'embeddings' in result:
                    stats['codebase'] += len(batch)
                    self._store_training_data('codebase', texts, result)
                    print(".", end="", file=sys.stderr, flush=True)
                else:
                    stats['errors'] += 1

            print("", file=sys.stderr)

        except Exception as e:
            print(f"  Cold start error: {e}", file=sys.stderr)
            stats['errors'] += 1

        return stats

    # =========================================================================
    # WARM START - Feed only what changed while paused
    # =========================================================================

    def warm_start(self, socket_path: str = EMBEDDING_SOCKET) -> Dict[str, int]:
        """
        Warm start: Feed only new data since last pause.
        - Overflow queue (requests that came in while paused)
        - New memories added while paused
        - New codebase files added while paused
        """
        stats = {'overflow': 0, 'new_memories': 0, 'new_codebase': 0, 'errors': 0}

        if not self.socket_alive(socket_path):
            print(f"  Socket not alive: {socket_path}", file=sys.stderr)
            return stats

        last_pause = self.get_last_pause_time()
        print(f"  WARM START: Feeding delta since last pause...", file=sys.stderr)

        # 1. Drain overflow queue
        overflow_stats = self.drain_overflow_queue(socket_path)
        stats['overflow'] = overflow_stats['processed']
        stats['errors'] += overflow_stats['errors']

        # 2. Feed new memories since pause
        if last_pause:
            try:
                conn = self._get_specmem_conn()
                pause_time = datetime.fromtimestamp(last_pause)

                print(f"  Checking for new memories since {pause_time}...", file=sys.stderr)
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT id, content, memory_type
                        FROM memories
                        WHERE created_at > %s
                        ORDER BY created_at ASC
                    """, (pause_time,))
                    new_memories = cur.fetchall()

                if new_memories:
                    print(f"  Feeding {len(new_memories)} new memories...", file=sys.stderr)
                    for batch_start in range(0, len(new_memories), BATCH_SIZE):
                        batch = new_memories[batch_start:batch_start + BATCH_SIZE]
                        texts = [m['content'] for m in batch]

                        result = self.send_to_socket(socket_path, {
                            'type': 'batch',
                            'texts': texts,
                            'priority': 'medium'
                        })

                        if result and 'embeddings' in result:
                            stats['new_memories'] += len(batch)
                            self._store_training_data('memories', texts, result)
                        else:
                            stats['errors'] += 1

                # 3. Feed new codebase files since pause
                print(f"  Checking for new codebase files...", file=sys.stderr)
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT id, file_path, content
                        FROM codebase_files
                        WHERE updated_at > %s
                        ORDER BY updated_at ASC
                    """, (pause_time,))
                    new_files = cur.fetchall()

                if new_files:
                    print(f"  Feeding {len(new_files)} updated codebase files...", file=sys.stderr)
                    for batch_start in range(0, len(new_files), BATCH_SIZE):
                        batch = new_files[batch_start:batch_start + BATCH_SIZE]
                        texts = [f"{f['file_path']}: {(f['content'] or '')[:500]}" for f in batch]

                        result = self.send_to_socket(socket_path, {
                            'type': 'batch',
                            'texts': texts,
                            'priority': 'medium'
                        })

                        if result and 'embeddings' in result:
                            stats['new_codebase'] += len(batch)
                            self._store_training_data('codebase', texts, result)
                        else:
                            stats['errors'] += 1

            except Exception as e:
                print(f"  Warm start delta error: {e}", file=sys.stderr)
                stats['errors'] += 1

        return stats

    def drain_overflow_queue(self, socket_path: str = EMBEDDING_SOCKET) -> Dict[str, int]:
        """
        Drain all pending requests from overflow queue to AI service.
        """
        stats = {'processed': 0, 'errors': 0, 'skipped': 0}

        if not self.socket_alive(socket_path):
            print(f"  Socket not alive: {socket_path}", file=sys.stderr)
            return stats

        print(f"  Draining overflow queue...", file=sys.stderr)

        try:
            conn = self._get_overflow_conn()

            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, request_type, texts_json, priority, dimensions, callback_id
                    FROM embedding_queue
                    WHERE status = 'pending'
                    ORDER BY priority ASC, timestamp ASC
                    LIMIT %s
                """, (BATCH_SIZE * 10,))
                rows = cur.fetchall()

            for row in rows:
                try:
                    texts = row['texts_json']
                    if isinstance(texts, str):
                        texts = json.loads(texts)

                    request = {
                        'type': row['request_type'],
                        'texts': texts if isinstance(texts, list) else [texts],
                        'priority': ['critical', 'high', 'medium', 'low', 'trivial'][min(row['priority'], 4)]
                    }
                    if row['dimensions']:
                        request['dimensions'] = row['dimensions']

                    result = self.send_to_socket(socket_path, request)

                    with conn.cursor() as cur:
                        if result and 'error' not in result:
                            cur.execute("""
                                UPDATE embedding_queue
                                SET status = 'completed', result_json = %s, processed_at = NOW()
                                WHERE id = %s
                            """, (Json(result), row['id']))
                            self._store_training_data('overflow', texts if isinstance(texts, list) else [texts], result)
                            stats['processed'] += 1
                            print(".", end="", file=sys.stderr, flush=True)
                        else:
                            error_msg = result.get('error', 'Unknown error') if result else 'No response'
                            cur.execute("""
                                UPDATE embedding_queue
                                SET status = 'error', error = %s, processed_at = NOW()
                                WHERE id = %s
                            """, (error_msg, row['id']))
                            stats['errors'] += 1

                except Exception as e:
                    with conn.cursor() as cur:
                        cur.execute("""
                            UPDATE embedding_queue
                            SET status = 'error', error = %s, processed_at = NOW()
                            WHERE id = %s
                        """, (str(e), row['id']))
                    stats['errors'] += 1

            print("", file=sys.stderr)

        except Exception as e:
            print(f"  Overflow drain error: {e}", file=sys.stderr)
            stats['errors'] += 1

        return stats

    def _store_training_data(self, service: str, inputs: List[str], result: dict):
        """Store successful embeddings for training"""
        try:
            conn = self._get_overflow_conn()

            for i, text in enumerate(inputs):
                input_hash = hashlib.sha256(text.encode()).hexdigest()[:32]
                embedding = None

                if 'embeddings' in result and i < len(result['embeddings']):
                    embedding = result['embeddings'][i]

                size_bytes = len(text.encode()) + (len(json.dumps(embedding)) if embedding else 0)

                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO training_data
                        (service, input_text, input_hash, embedding_json, size_bytes)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (input_hash) DO UPDATE SET
                            last_used_at = NOW(),
                            use_count = training_data.use_count + 1
                    """, (service, text, input_hash, Json(embedding), size_bytes))

        except Exception as e:
            print(f"  Training store error: {e}", file=sys.stderr)

    def purge_old_training_data(self) -> Dict[str, int]:
        """
        Purge training data:
        1. Delete entries unused for 30 days
        2. Delete oldest entries if over 5GB cap
        """
        stats = {'purged_old': 0, 'purged_size': 0}

        try:
            conn = self._get_overflow_conn()

            # Delete entries unused for 30 days
            with conn.cursor() as cur:
                cur.execute("""
                    DELETE FROM training_data
                    WHERE last_used_at < NOW() - INTERVAL '%s days'
                """, (PURGE_DAYS,))
                stats['purged_old'] = cur.rowcount

            # Check total size
            with conn.cursor() as cur:
                cur.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM training_data")
                total_size = cur.fetchone()[0]

            max_size = MAX_TRAINING_SIZE_GB * 1024 * 1024 * 1024

            if total_size > max_size:
                excess = total_size - max_size
                deleted_size = 0

                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT id, size_bytes FROM training_data
                        ORDER BY last_used_at ASC
                    """)

                    ids_to_delete = []
                    for row in cur:
                        if deleted_size >= excess:
                            break
                        ids_to_delete.append(row['id'])
                        deleted_size += row['size_bytes'] or 0

                if ids_to_delete:
                    with conn.cursor() as cur:
                        cur.execute("""
                            DELETE FROM training_data WHERE id = ANY(%s)
                        """, (ids_to_delete,))
                    stats['purged_size'] = len(ids_to_delete)

        except Exception as e:
            print(f"  Purge error: {e}", file=sys.stderr)

        return stats

    def get_training_stats(self) -> Dict[str, Any]:
        """Get training data statistics"""
        try:
            conn = self._get_overflow_conn()

            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT service, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as size
                    FROM training_data
                    GROUP BY service
                """)

                services = {}
                total_entries = 0
                total_size = 0

                for row in cur:
                    service = row['service']
                    count = row['count']
                    size = row['size']
                    services[service] = {'entries': count, 'size_mb': round(size / 1024 / 1024, 2)}
                    total_entries += count
                    total_size += size

                return {
                    'entries': total_entries,
                    'size_mb': round(total_size / 1024 / 1024, 2),
                    'size_gb': round(total_size / 1024 / 1024 / 1024, 2),
                    'max_gb': MAX_TRAINING_SIZE_GB,
                    'services': services
                }

        except Exception as e:
            return {'entries': 0, 'size_mb': 0, 'size_gb': 0, 'max_gb': MAX_TRAINING_SIZE_GB, 'services': {}, 'error': str(e)}

    def cleanup_old_overflow(self, hours: int = 24) -> int:
        """Remove completed/error overflow entries older than X hours"""
        try:
            conn = self._get_overflow_conn()
            with conn.cursor() as cur:
                cur.execute("""
                    DELETE FROM embedding_queue
                    WHERE status IN ('completed', 'error')
                    AND processed_at < NOW() - INTERVAL '%s hours'
                """, (hours,))
                return cur.rowcount
        except Exception:
            return 0

    def close(self):
        """Close database connections"""
        if self.overflow_conn and not self.overflow_conn.closed:
            self.overflow_conn.close()
        if self.specmem_conn and not self.specmem_conn.closed:
            self.specmem_conn.close()


def main():
    parser = argparse.ArgumentParser(description='Warm Start Feeder - PostgreSQL Edition')
    parser.add_argument('--cold', action='store_true', help='Cold start (feed entire DB)')
    parser.add_argument('--warm', action='store_true', help='Warm start (feed delta only)')
    parser.add_argument('--drain', action='store_true', help='Drain overflow queue only')
    parser.add_argument('--purge', action='store_true', help='Purge old training data')
    parser.add_argument('--stats', action='store_true', help='Show training stats')
    parser.add_argument('--cleanup', action='store_true', help='Cleanup old overflow entries')
    parser.add_argument('--record-pause', action='store_true', help='Record current time as pause time')
    parser.add_argument('--socket', default=EMBEDDING_SOCKET, help='Socket path')

    args = parser.parse_args()
    feeder = WarmStartFeeder()

    try:
        if args.record_pause:
            feeder.record_pause_time()
            print(f"  Recorded pause time: {time.time()}", file=sys.stderr)
            return

        if args.stats:
            stats = feeder.get_training_stats()
            print(f"  Training Data Stats:", file=sys.stderr)
            print(f"   Total entries: {stats['entries']}", file=sys.stderr)
            print(f"   Total size: {stats['size_gb']}GB / {stats['max_gb']}GB", file=sys.stderr)
            for service, data in stats.get('services', {}).items():
                print(f"   {service}: {data['entries']} entries, {data['size_mb']}MB", file=sys.stderr)
            return

        if args.cold:
            print("  COLD START - Full database feed...", file=sys.stderr)
            stats = feeder.cold_start(args.socket)
            print(f"   Memories: {stats['memories']}, Codebase: {stats['codebase']}, Errors: {stats['errors']}", file=sys.stderr)
            return

        if args.warm:
            print("  WARM START - Delta feed...", file=sys.stderr)
            stats = feeder.warm_start(args.socket)
            print(f"   Overflow: {stats['overflow']}, New memories: {stats['new_memories']}, New codebase: {stats['new_codebase']}", file=sys.stderr)
            return

        if args.drain:
            pending = feeder.get_pending_count()
            if pending > 0:
                print(f"  Draining {pending} pending overflow entries...", file=sys.stderr)
                stats = feeder.drain_overflow_queue(args.socket)
                print(f"   Processed: {stats['processed']}, Errors: {stats['errors']}", file=sys.stderr)
            else:
                print("  No pending overflow entries", file=sys.stderr)
            return

        if args.purge:
            print("  Purging old training data...", file=sys.stderr)
            stats = feeder.purge_old_training_data()
            print(f"   Purged {stats['purged_old']} entries (>{PURGE_DAYS} days unused)", file=sys.stderr)
            print(f"   Purged {stats['purged_size']} entries (>{MAX_TRAINING_SIZE_GB}GB cap)", file=sys.stderr)
            return

        if args.cleanup:
            print("  Cleaning up old overflow entries...", file=sys.stderr)
            deleted = feeder.cleanup_old_overflow()
            print(f"   Deleted {deleted} old entries", file=sys.stderr)
            return

        # Default: warm start + purge + cleanup
        print("  WARM START FEEDER", file=sys.stderr)
        print("=" * 50, file=sys.stderr)

        # Warm start (delta only)
        stats = feeder.warm_start(args.socket)
        print(f"\n   Overflow: {stats['overflow']}, New memories: {stats['new_memories']}, New codebase: {stats['new_codebase']}", file=sys.stderr)

        # Purge old training data
        print(f"\n  Checking training data ({PURGE_DAYS}-day purge, {MAX_TRAINING_SIZE_GB}GB cap)...", file=sys.stderr)
        purge_stats = feeder.purge_old_training_data()
        if purge_stats['purged_old'] > 0 or purge_stats['purged_size'] > 0:
            print(f"   Purged: {purge_stats['purged_old']} old, {purge_stats['purged_size']} over cap", file=sys.stderr)
        else:
            print("   No purge needed", file=sys.stderr)

        # Show stats
        stats = feeder.get_training_stats()
        print(f"\n  Training data: {stats['size_gb']}GB / {MAX_TRAINING_SIZE_GB}GB ({stats['entries']} entries)", file=sys.stderr)

        # Cleanup old overflow
        deleted = feeder.cleanup_old_overflow()
        if deleted > 0:
            print(f"\n   Cleaned {deleted} old overflow entries", file=sys.stderr)

        print("\n  Warm start complete!", file=sys.stderr)

    finally:
        feeder.close()


if __name__ == '__main__':
    main()
