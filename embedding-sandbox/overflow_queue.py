"""
Overflow Queue for Frankenstein Embeddings - PostgreSQL Edition

When the Docker container is paused/stopped, embedding requests are queued
in this PostgreSQL database. When the container warms up again, the queue is
processed and results are injected back.

Database: specmem_overflow (separate from main specmem DB)

Multi-Instance Support:
- Each project gets its own overflow directory: ~/.specmem/instances/{hash}/overflow/
- Project hash is derived from SPECMEM_PROJECT_PATH (sha256[:12])
- Supports SPECMEM_OVERFLOW_DB env var for manual override
"""

import json
import time
import os
import hashlib
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime
import threading

# PostgreSQL
import psycopg2
from psycopg2.extras import RealDictCursor, Json


# ==============================================================================
# Project Isolation - Multi-Instance Support
# ==============================================================================

def get_project_hash() -> str:
    """
    Generate 12-char hash of project path for instance isolation.
    Same algorithm as TypeScript side (sha256[:12]).
    """
    project_path = os.environ.get('SPECMEM_PROJECT_PATH', os.getcwd())
    return hashlib.sha256(project_path.encode()).hexdigest()[:12]


def get_project_overflow_path() -> str:
    """
    Get the project-scoped overflow directory path.
    Pattern: ~/.specmem/instances/{project_hash}/overflow/

    Creates the directory if it doesn't exist.
    Respects SPECMEM_OVERFLOW_DB env var for manual override.
    """
    # Allow explicit override via env var
    if os.environ.get('SPECMEM_OVERFLOW_DB'):
        overflow_path = os.environ.get('SPECMEM_OVERFLOW_DB')
        # Ensure parent directory exists
        overflow_dir = os.path.dirname(overflow_path)
        if overflow_dir:
            os.makedirs(overflow_dir, exist_ok=True)
        return overflow_path

    # Build project-scoped path
    home = os.path.expanduser('~')
    project_hash = get_project_hash()
    overflow_dir = os.path.join(home, '.specmem', 'instances', project_hash, 'overflow')

    # Ensure directory exists
    os.makedirs(overflow_dir, exist_ok=True)

    return overflow_dir


def get_project_overflow_db_path() -> str:
    """
    Get the full path to the overflow queue SQLite database file.
    Pattern: ~/.specmem/instances/{project_hash}/overflow/queue.db
    """
    overflow_dir = get_project_overflow_path()
    return os.path.join(overflow_dir, 'queue.db')


# ==============================================================================
# PostgreSQL Configuration
# ==============================================================================

# Environment-based config
OVERFLOW_DB_HOST = os.environ.get('OVERFLOW_DB_HOST', os.environ.get('SPECMEM_DB_HOST', 'localhost'))
OVERFLOW_DB_PORT = os.environ.get('OVERFLOW_DB_PORT', os.environ.get('SPECMEM_DB_PORT', '5432'))
OVERFLOW_DB_NAME = os.environ.get('OVERFLOW_DB_NAME', 'specmem_overflow')
OVERFLOW_DB_USER = os.environ.get('OVERFLOW_DB_USER', os.environ.get('SPECMEM_DB_USER', 'specmem_westayunprofessional'))
OVERFLOW_DB_PASSWORD = os.environ.get('OVERFLOW_DB_PASSWORD', os.environ.get('SPECMEM_DB_PASSWORD', 'specmem_westayunprofessional'))


@dataclass
class QueuedRequest:
    """A queued embedding request"""
    id: int
    request_type: str  # 'single' or 'batch'
    texts: List[str]
    priority: int
    timestamp: float
    callback_id: Optional[str]  # For async callback
    dimensions: Optional[int]

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'request_type': self.request_type,
            'texts': self.texts,
            'priority': self.priority,
            'timestamp': self.timestamp,
            'callback_id': self.callback_id,
            'dimensions': self.dimensions
        }


class OverflowQueue:
    """
    PostgreSQL-backed overflow queue for embedding requests.

    Used when:
    - Docker container is paused
    - CPU is overloaded and requests need to be deferred
    - Batch processing is enabled

    Database: specmem_overflow (separate from main specmem)
    """

    def __init__(
        self,
        host: str = OVERFLOW_DB_HOST,
        port: str = OVERFLOW_DB_PORT,
        dbname: str = OVERFLOW_DB_NAME,
        user: str = OVERFLOW_DB_USER,
        password: str = OVERFLOW_DB_PASSWORD
    ):
        self.conn_params = {
            'host': host,
            'port': port,
            'dbname': dbname,
            'user': user,
            'password': password
        }
        self._lock = threading.Lock()
        self._conn = None

    def _get_conn(self):
        """Get or create database connection"""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(**self.conn_params)
            self._conn.autocommit = True
        return self._conn

    def _execute(self, query: str, params: tuple = None, fetch: bool = False):
        """Execute query with auto-reconnect"""
        try:
            conn = self._get_conn()
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(query, params)
                if fetch:
                    return cur.fetchall()
                return cur.rowcount
        except psycopg2.Error as e:
            self._conn = None  # Force reconnect on next call
            raise e

    def enqueue(
        self,
        texts: List[str],
        request_type: str = 'batch',
        priority: int = 2,
        callback_id: Optional[str] = None,
        dimensions: Optional[int] = None
    ) -> int:
        """
        Add a request to the overflow queue.

        Args:
            texts: Text(s) to embed
            request_type: 'single' or 'batch'
            priority: 0-4 (lower = higher priority)
            callback_id: Optional ID for async callback
            dimensions: Target embedding dimensions

        Returns:
            Queue entry ID
        """
        with self._lock:
            result = self._execute("""
                INSERT INTO embedding_queue
                (request_type, texts_json, priority, callback_id, dimensions)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (
                request_type,
                Json(texts),
                priority,
                callback_id,
                dimensions
            ), fetch=True)
            return result[0]['id'] if result else None

    def dequeue(self, limit: int = 10) -> List[QueuedRequest]:
        """
        Get pending requests from the queue, ordered by priority then timestamp.

        Args:
            limit: Maximum number of requests to return

        Returns:
            List of QueuedRequest objects
        """
        with self._lock:
            rows = self._execute("""
                SELECT id, request_type, texts_json, priority,
                       EXTRACT(EPOCH FROM timestamp) as timestamp,
                       callback_id, dimensions
                FROM embedding_queue
                WHERE status = 'pending'
                ORDER BY priority ASC, timestamp ASC
                LIMIT %s
            """, (limit,), fetch=True)

            results = []
            for row in rows:
                results.append(QueuedRequest(
                    id=row['id'],
                    request_type=row['request_type'],
                    texts=row['texts_json'],
                    priority=row['priority'],
                    timestamp=row['timestamp'],
                    callback_id=row['callback_id'],
                    dimensions=row['dimensions']
                ))
            return results

    def mark_processing(self, ids: List[int]):
        """Mark requests as being processed"""
        if not ids:
            return
        with self._lock:
            self._execute("""
                UPDATE embedding_queue
                SET status = 'processing'
                WHERE id = ANY(%s)
            """, (ids,))

    def mark_completed(
        self,
        id: int,
        result: Optional[Any] = None,
        error: Optional[str] = None
    ):
        """Mark a request as completed with optional result/error"""
        status = 'completed' if error is None else 'error'

        with self._lock:
            self._execute("""
                UPDATE embedding_queue
                SET status = %s, result_json = %s, error = %s, processed_at = NOW()
                WHERE id = %s
            """, (status, Json(result) if result else None, error, id))

    def get_pending_count(self) -> int:
        """Get count of pending requests"""
        result = self._execute("""
            SELECT COUNT(*) as count FROM embedding_queue WHERE status = 'pending'
        """, fetch=True)
        return result[0]['count'] if result else 0

    def get_result(self, callback_id: str) -> Optional[Tuple[str, Any]]:
        """
        Get result by callback ID.

        Returns:
            Tuple of (status, result/error) or None if not found
        """
        result = self._execute("""
            SELECT status, result_json, error
            FROM embedding_queue
            WHERE callback_id = %s
        """, (callback_id,), fetch=True)

        if result:
            row = result[0]
            if row['status'] == 'completed':
                return ('completed', row['result_json'])
            elif row['status'] == 'error':
                return ('error', row['error'])
            else:
                return (row['status'], None)
        return None

    def cleanup_old(self, hours: int = 24) -> int:
        """Remove completed/error entries older than specified hours"""
        with self._lock:
            return self._execute("""
                DELETE FROM embedding_queue
                WHERE status IN ('completed', 'error')
                AND processed_at < NOW() - INTERVAL '%s hours'
            """, (hours,))

    def get_stats(self) -> Dict[str, Any]:
        """Get queue statistics"""
        rows = self._execute("""
            SELECT status, COUNT(*) as count, AVG(priority) as avg_priority
            FROM embedding_queue
            GROUP BY status
        """, fetch=True)

        stats = {
            'total': 0,
            'pending': 0,
            'processing': 0,
            'completed': 0,
            'error': 0,
            'avg_priority': {}
        }

        for row in rows:
            status = row['status']
            count = row['count']
            avg_priority = row['avg_priority']
            stats[status] = count
            stats['total'] += count
            if avg_priority is not None:
                stats['avg_priority'][status] = round(float(avg_priority), 2)

        return stats

    def close(self):
        """Close database connection"""
        if self._conn and not self._conn.closed:
            self._conn.close()
            self._conn = None


# Singleton instance
_queue_instance: Optional[OverflowQueue] = None

def get_overflow_queue() -> OverflowQueue:
    """Get the global overflow queue instance"""
    global _queue_instance
    if _queue_instance is None:
        _queue_instance = OverflowQueue()
    return _queue_instance
