#!/usr/bin/env python3
"""
QQMS v2 - Quantum-Quality Millisecond System with FIFO + ACK

Enhanced queue management for low-resource environments:
  - Strict FIFO within priority levels (no starvation)
  - ACK mechanism: items only removed after explicit ACK
  - Retry with exponential backoff on failure
  - Dead Letter Queue (DLQ) for permanently failed operations
  - Overflow queue integration (PostgreSQL-backed)
  - Priority aging: low priority items eventually get promoted

For the embedding server, this means:
  - When CPU > 85%: Queue to overflow, don't block
  - When CPU recovers: Drain overflow queue FIFO
  - On failure: Retry with backoff, then DLQ

@author hardwicksoftwareservices
@website https://justcalljon.pro
"""

import os
import sys
import time
import json
import uuid
import threading
import hashlib
from dataclasses import dataclass, field
from collections import deque
from queue import PriorityQueue
from enum import IntEnum
from typing import Dict, List, Optional, Any, Callable, Tuple
from abc import ABC, abstractmethod

# Try to import psycopg2 for PostgreSQL overflow
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor, Json
    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False
    print("⚠️ psycopg2 not available - overflow queue disabled", file=sys.stderr)


# ============================================================================
# Priority Levels
# ============================================================================

class Priority(IntEnum):
    """Priority levels for requests - lower = higher priority"""
    CRITICAL = 0    # Must run immediately (health checks)
    HIGH = 1        # User-facing operations (search)
    MEDIUM = 2      # Background operations (indexing)
    LOW = 3         # Batch processing, non-urgent
    TRIVIAL = 4     # Deferred processing


# ============================================================================
# Configuration
# ============================================================================

@dataclass
class QQMSv2Config:
    """
    QQMS v2 Configuration

    Controls FIFO + ACK queue behavior and overflow handling.
    """
    # Resource limits
    cpu_queue_threshold: float = 70.0      # Start queueing at 70% CPU
    cpu_reject_threshold: float = 90.0     # Reject new requests at 90%
    max_ram_percent: float = 80.0          # Max RAM before queueing

    # FIFO + ACK settings
    max_retries: int = 3                   # Max retry attempts before DLQ
    base_retry_delay_ms: float = 1000.0    # Base delay for exponential backoff
    max_retry_delay_ms: float = 30000.0    # Cap retry delay at 30s
    lease_timeout_ms: float = 60000.0      # 60s lease - requeue if not completed
    age_promotion_ms: float = 30000.0      # Promote priority after 30s waiting

    # Queue limits
    max_queue_size: int = 1000             # Max items in memory queue
    queue_high_water_mark: int = 100       # Warn when queue exceeds this

    # DLQ settings
    dlq_max_size: int = 500                # Max DLQ size
    dlq_retention_ms: float = 3600000.0    # Keep DLQ items for 1 hour

    # Overflow (PostgreSQL) settings
    enable_overflow: bool = True           # Enable PostgreSQL overflow
    overflow_drain_batch_size: int = 10    # Drain this many items at a time
    overflow_drain_interval_ms: float = 1000.0  # Check overflow every 1s

    # Throttling settings (for non-queued requests)
    base_delay_ms: float = 50.0
    max_requests_per_second: float = 20.0
    burst_limit: int = 10

    # Priority delay multipliers
    priority_delay_multiplier: Dict[int, float] = field(default_factory=lambda: {
        Priority.CRITICAL: 0.1,   # 5ms delay
        Priority.HIGH: 0.5,       # 25ms delay
        Priority.MEDIUM: 1.0,     # 50ms delay
        Priority.LOW: 2.0,        # 100ms delay
        Priority.TRIVIAL: 4.0     # 200ms delay
    })


# ============================================================================
# Queue Item
# ============================================================================

@dataclass
class QueueItem:
    """Item in the FIFO queue with ACK support"""
    id: str
    priority: Priority
    original_priority: Priority  # For tracking priority aging
    data: Any                    # The actual request data
    callback: Optional[Callable] # Callback when complete
    enqueued_at: float
    started_at: Optional[float] = None
    status: str = 'pending'      # pending, processing, completed, failed, dlq
    retry_count: int = 0
    last_error: Optional[str] = None
    next_retry_at: Optional[float] = None
    lease_expires_at: Optional[float] = None

    def __lt__(self, other):
        """For priority queue ordering - lower priority value = higher priority"""
        if self.priority != other.priority:
            return self.priority < other.priority
        return self.enqueued_at < other.enqueued_at


@dataclass
class DLQItem:
    """Dead Letter Queue item"""
    id: str
    priority: Priority
    data: Any
    enqueued_at: float
    failed_at: float
    retry_count: int
    last_error: str


# ============================================================================
# CPU Monitor
# ============================================================================

class CPUMonitor:
    """Monitors CPU usage for throttling decisions"""

    def __init__(self, sample_interval_ms: float = 100.0):
        self.sample_interval_ms = sample_interval_ms
        self.last_check_time: float = 0.0
        self.last_cpu_times: Optional[Tuple[float, float]] = None
        self.current_usage: float = 0.0
        self.usage_history: deque = deque(maxlen=10)
        self._lock = threading.Lock()

    def _read_cpu_times(self) -> Optional[Tuple[float, float]]:
        """Read CPU times from /proc/stat"""
        try:
            with open('/proc/stat', 'r') as f:
                first_line = f.readline()
                if not first_line.startswith('cpu '):
                    return None

                parts = first_line.split()
                user = float(parts[1])
                nice = float(parts[2])
                system = float(parts[3])
                idle = float(parts[4])
                iowait = float(parts[5]) if len(parts) > 5 else 0.0

                total = user + nice + system + idle + iowait
                busy = user + nice + system

                return (busy, total)
        except Exception:
            return None

    def get_cpu_usage(self) -> float:
        """Get current CPU usage percentage (0-100)"""
        now = time.time()

        with self._lock:
            if now - self.last_check_time < (self.sample_interval_ms / 1000.0):
                return self.current_usage

            current_times = self._read_cpu_times()
            if current_times is None:
                return self.current_usage

            if self.last_cpu_times is not None:
                busy_delta = current_times[0] - self.last_cpu_times[0]
                total_delta = current_times[1] - self.last_cpu_times[1]

                if total_delta > 0:
                    self.current_usage = (busy_delta / total_delta) * 100.0
                    self.usage_history.append(self.current_usage)

            self.last_cpu_times = current_times
            self.last_check_time = now

            return self.current_usage

    def get_average_usage(self) -> float:
        """Get average CPU usage over recent samples"""
        if not self.usage_history:
            return self.get_cpu_usage()
        return sum(self.usage_history) / len(self.usage_history)

    def is_overloaded(self, threshold: float = 85.0) -> bool:
        """Check if CPU is overloaded"""
        return self.get_cpu_usage() > threshold


# ============================================================================
# Overflow Queue (PostgreSQL)
# ============================================================================

class OverflowQueue:
    """
    PostgreSQL-backed overflow queue for when memory queue is full
    or system is under heavy load.

    Uses SKIP LOCKED for safe concurrent access.
    """

    def __init__(self, db_config: Dict[str, str]):
        self.db_config = db_config
        self._conn = None
        self._lock = threading.Lock()
        self._initialized = False

        # Get project ID for isolation
        project_path = os.environ.get('SPECMEM_PROJECT_PATH', os.getcwd())
        self.project_id = hashlib.sha256(project_path.encode()).hexdigest()[:12]

    def _get_conn(self):
        """Get or create database connection"""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(**self.db_config)
            self._conn.autocommit = True
        return self._conn

    def initialize(self):
        """Create overflow queue table if needed"""
        if self._initialized:
            return

        with self._lock:
            try:
                conn = self._get_conn()
                with conn.cursor() as cur:
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS qqms_overflow_queue (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL,
                            priority INTEGER NOT NULL,
                            original_priority INTEGER NOT NULL,
                            data_json JSONB NOT NULL,
                            enqueued_at TIMESTAMP DEFAULT NOW(),
                            status TEXT DEFAULT 'pending',
                            retry_count INTEGER DEFAULT 0,
                            last_error TEXT,
                            next_retry_at TIMESTAMP,
                            CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
                        )
                    """)

                    # Index for efficient FIFO processing
                    cur.execute("""
                        CREATE INDEX IF NOT EXISTS idx_qqms_overflow_pending
                        ON qqms_overflow_queue (project_id, status, priority, enqueued_at)
                        WHERE status = 'pending'
                    """)

                self._initialized = True
                print(f"✅ QQMS overflow queue initialized (project: {self.project_id})", file=sys.stderr)
            except Exception as e:
                print(f"⚠️ Failed to initialize overflow queue: {e}", file=sys.stderr)

    def enqueue(self, item: QueueItem) -> bool:
        """Add item to overflow queue"""
        self.initialize()

        with self._lock:
            try:
                conn = self._get_conn()
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO qqms_overflow_queue
                        (id, project_id, priority, original_priority, data_json, status, retry_count)
                        VALUES (%s, %s, %s, %s, %s, 'pending', %s)
                    """, (
                        item.id,
                        self.project_id,
                        int(item.priority),
                        int(item.original_priority),
                        Json(item.data),
                        item.retry_count
                    ))
                return True
            except Exception as e:
                print(f"⚠️ Failed to enqueue to overflow: {e}", file=sys.stderr)
                return False

    def dequeue(self, limit: int = 10) -> List[QueueItem]:
        """
        Get pending items from overflow queue (FIFO within priority).
        Uses SKIP LOCKED for safe concurrent access.
        """
        self.initialize()

        with self._lock:
            try:
                conn = self._get_conn()
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    # Get and lock pending items
                    cur.execute("""
                        UPDATE qqms_overflow_queue
                        SET status = 'processing'
                        WHERE id IN (
                            SELECT id FROM qqms_overflow_queue
                            WHERE project_id = %s
                            AND status = 'pending'
                            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
                            ORDER BY priority ASC, enqueued_at ASC
                            LIMIT %s
                            FOR UPDATE SKIP LOCKED
                        )
                        RETURNING id, priority, original_priority, data_json,
                                  EXTRACT(EPOCH FROM enqueued_at) as enqueued_at,
                                  retry_count, last_error
                    """, (self.project_id, limit))

                    rows = cur.fetchall()

                    items = []
                    for row in rows:
                        items.append(QueueItem(
                            id=row['id'],
                            priority=Priority(row['priority']),
                            original_priority=Priority(row['original_priority']),
                            data=row['data_json'],
                            callback=None,  # Can't persist callbacks
                            enqueued_at=row['enqueued_at'],
                            status='processing',
                            retry_count=row['retry_count'],
                            last_error=row['last_error']
                        ))

                    return items
            except Exception as e:
                print(f"⚠️ Failed to dequeue from overflow: {e}", file=sys.stderr)
                return []

    def ack(self, item_id: str) -> bool:
        """Acknowledge successful completion - remove from queue"""
        with self._lock:
            try:
                conn = self._get_conn()
                with conn.cursor() as cur:
                    cur.execute("""
                        DELETE FROM qqms_overflow_queue
                        WHERE id = %s AND project_id = %s
                    """, (item_id, self.project_id))
                return True
            except Exception as e:
                print(f"⚠️ Failed to ACK overflow item: {e}", file=sys.stderr)
                return False

    def nack(self, item_id: str, error: str, retry_delay_ms: float) -> bool:
        """Negative acknowledge - schedule retry"""
        with self._lock:
            try:
                conn = self._get_conn()
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE qqms_overflow_queue
                        SET status = 'pending',
                            retry_count = retry_count + 1,
                            last_error = %s,
                            next_retry_at = NOW() + INTERVAL '%s milliseconds'
                        WHERE id = %s AND project_id = %s
                    """, (error, retry_delay_ms, item_id, self.project_id))
                return True
            except Exception as e:
                print(f"⚠️ Failed to NACK overflow item: {e}", file=sys.stderr)
                return False

    def move_to_dlq(self, item_id: str) -> bool:
        """Move failed item to DLQ (just marks as failed for now)"""
        with self._lock:
            try:
                conn = self._get_conn()
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE qqms_overflow_queue
                        SET status = 'failed'
                        WHERE id = %s AND project_id = %s
                    """, (item_id, self.project_id))
                return True
            except Exception as e:
                print(f"⚠️ Failed to move to DLQ: {e}", file=sys.stderr)
                return False

    def get_pending_count(self) -> int:
        """Get count of pending items"""
        with self._lock:
            try:
                conn = self._get_conn()
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT COUNT(*) FROM qqms_overflow_queue
                        WHERE project_id = %s AND status = 'pending'
                    """, (self.project_id,))
                    return cur.fetchone()[0]
            except:
                return 0

    def cleanup_old(self, hours: int = 24) -> int:
        """Remove old completed/failed entries"""
        with self._lock:
            try:
                conn = self._get_conn()
                with conn.cursor() as cur:
                    cur.execute("""
                        DELETE FROM qqms_overflow_queue
                        WHERE project_id = %s
                        AND status IN ('completed', 'failed')
                        AND enqueued_at < NOW() - INTERVAL '%s hours'
                    """, (self.project_id, hours))
                    return cur.rowcount
            except:
                return 0


# ============================================================================
# QQMS v2 - Main Queue Manager
# ============================================================================

class QQMSv2:
    """
    QQMS v2 - Quantum-Quality Millisecond System

    Features:
    - Strict FIFO within priority levels
    - ACK/NACK with retry and exponential backoff
    - Dead Letter Queue for failed items
    - PostgreSQL overflow for durability
    - Priority aging to prevent starvation
    - CPU-aware throttling and queueing
    """

    def __init__(
        self,
        config: Optional[QQMSv2Config] = None,
        db_config: Optional[Dict[str, str]] = None
    ):
        self.config = config or QQMSv2Config()
        self.cpu_monitor = CPUMonitor()

        # Separate FIFO queues per priority level
        self.priority_queues: Dict[Priority, deque] = {
            p: deque() for p in Priority
        }

        # Items currently being processed
        self.processing: Dict[str, QueueItem] = {}

        # Dead Letter Queue
        self.dlq: List[DLQItem] = []

        # Overflow queue (PostgreSQL)
        self.overflow: Optional[OverflowQueue] = None
        if HAS_POSTGRES and self.config.enable_overflow and db_config:
            self.overflow = OverflowQueue(db_config)

        # Token bucket for rate limiting
        self.tokens: float = float(self.config.burst_limit)
        self.last_token_time: float = time.time()

        # Stats
        self.total_processed: int = 0
        self.total_retries: int = 0
        self.total_wait_time_ms: float = 0.0
        self.throttle_events: int = 0

        # Locks
        self._queue_lock = threading.Lock()
        self._token_lock = threading.Lock()

        # Background drain thread
        self._drain_thread: Optional[threading.Thread] = None
        self._shutdown = False

        print(f"🚀 QQMS v2 initialized:", file=sys.stderr)
        print(f"   Max retries: {self.config.max_retries}", file=sys.stderr)
        print(f"   Queue threshold: {self.config.cpu_queue_threshold}% CPU", file=sys.stderr)
        print(f"   Overflow: {'enabled' if self.overflow else 'disabled'}", file=sys.stderr)

    def start_drain_thread(self):
        """Start background thread to drain overflow queue"""
        if self._drain_thread is not None:
            return

        self._drain_thread = threading.Thread(target=self._drain_loop, daemon=True)
        self._drain_thread.start()
        print("🔄 QQMS v2 drain thread started", file=sys.stderr)

    def stop(self):
        """Stop the drain thread"""
        self._shutdown = True
        if self._drain_thread:
            self._drain_thread.join(timeout=5.0)

    def _drain_loop(self):
        """Background loop to drain overflow queue when CPU is available"""
        while not self._shutdown:
            try:
                cpu = self.cpu_monitor.get_cpu_usage()

                # Only drain when CPU is below queue threshold
                if cpu < self.config.cpu_queue_threshold and self.overflow:
                    pending = self.overflow.get_pending_count()
                    if pending > 0:
                        items = self.overflow.dequeue(self.config.overflow_drain_batch_size)
                        for item in items:
                            # Move to memory queue for processing
                            queue = self.priority_queues[item.priority]
                            queue.append(item)

                # Also check for priority aging in memory queues
                self._check_priority_aging()

                # Check lease timeouts
                self._check_lease_timeouts()

            except Exception as e:
                print(f"⚠️ QQMS drain error: {e}", file=sys.stderr)

            time.sleep(self.config.overflow_drain_interval_ms / 1000.0)

    def _check_priority_aging(self):
        """Promote items that have waited too long"""
        now = time.time()

        with self._queue_lock:
            for priority in list(Priority)[1:]:  # Skip CRITICAL
                queue = self.priority_queues[priority]
                items_to_promote = []

                for item in queue:
                    if (item.status == 'pending' and
                        now - item.enqueued_at > self.config.age_promotion_ms / 1000.0 and
                        item.priority > Priority.CRITICAL):
                        items_to_promote.append(item)

                for item in items_to_promote:
                    # Remove from current queue
                    queue.remove(item)
                    # Promote priority
                    new_priority = Priority(item.priority - 1)
                    item.priority = new_priority
                    # Add to higher priority queue
                    self.priority_queues[new_priority].append(item)

    def _check_lease_timeouts(self):
        """Requeue items that have exceeded their lease"""
        now = time.time()

        with self._queue_lock:
            expired = []
            for item_id, item in self.processing.items():
                if (item.lease_expires_at and
                    now > item.lease_expires_at):
                    expired.append(item_id)

            for item_id in expired:
                item = self.processing.pop(item_id)
                self._nack_item(item, "Lease timeout - operation took too long")

    def _get_retry_delay(self, retry_count: int) -> float:
        """Calculate exponential backoff delay"""
        delay = self.config.base_retry_delay_ms * (2 ** retry_count)
        return min(delay, self.config.max_retry_delay_ms)

    def _refill_tokens(self):
        """Refill tokens based on elapsed time"""
        now = time.time()
        elapsed = now - self.last_token_time
        new_tokens = elapsed * self.config.max_requests_per_second
        self.tokens = min(float(self.config.burst_limit), self.tokens + new_tokens)
        self.last_token_time = now

    def _get_cpu_multiplier(self) -> float:
        """Get delay multiplier based on CPU usage"""
        cpu = self.cpu_monitor.get_cpu_usage()

        if cpu > 85.0:
            return 10.0  # Emergency throttling
        elif cpu > 70.0:
            return 4.0   # High throttling
        elif cpu > 50.0:
            return 2.0   # Medium throttling
        elif cpu > 30.0:
            return 1.5   # Light throttling
        else:
            return 1.0   # No throttling

    def enqueue(
        self,
        data: Any,
        priority: Priority = Priority.MEDIUM,
        callback: Optional[Callable] = None
    ) -> str:
        """
        Enqueue an item for processing.

        Args:
            data: The request data
            priority: Request priority
            callback: Optional callback when complete

        Returns:
            Item ID for tracking
        """
        item_id = f"qqms_{uuid.uuid4().hex[:12]}_{int(time.time() * 1000)}"

        item = QueueItem(
            id=item_id,
            priority=priority,
            original_priority=priority,
            data=data,
            callback=callback,
            enqueued_at=time.time(),
            status='pending',
            retry_count=0
        )

        cpu = self.cpu_monitor.get_cpu_usage()

        # Check if system is overloaded
        if cpu > self.config.cpu_reject_threshold:
            # System critically overloaded - use overflow if available
            if self.overflow:
                self.overflow.enqueue(item)
                return item_id
            else:
                raise RuntimeError(f"QQMS: System overloaded ({cpu:.1f}% CPU) and no overflow queue")

        # Check if we should queue to overflow
        if cpu > self.config.cpu_queue_threshold:
            if self.overflow:
                self.overflow.enqueue(item)
                return item_id

        # Add to memory queue
        with self._queue_lock:
            queue = self.priority_queues[priority]

            # Check queue size limits
            total_queued = sum(len(q) for q in self.priority_queues.values())
            if total_queued >= self.config.max_queue_size:
                # Queue full - use overflow
                if self.overflow:
                    self.overflow.enqueue(item)
                    return item_id
                else:
                    raise RuntimeError(f"QQMS: Queue full ({total_queued} items) and no overflow")

            queue.append(item)

            if total_queued > self.config.queue_high_water_mark:
                print(f"⚠️ QQMS: Queue high water mark ({total_queued} items)", file=sys.stderr)

        return item_id

    def dequeue(self, wait: bool = True, timeout_ms: float = 5000.0) -> Optional[QueueItem]:
        """
        Get next item to process (FIFO within priority).

        Args:
            wait: Whether to wait if no items available
            timeout_ms: Max wait time

        Returns:
            QueueItem or None if no items
        """
        start_time = time.time()

        while True:
            with self._queue_lock:
                now = time.time()

                # Process in priority order (CRITICAL first)
                for priority in Priority:
                    queue = self.priority_queues[priority]

                    # Find first pending item past retry delay
                    for item in queue:
                        if item.status == 'pending':
                            if (item.next_retry_at and
                                now < item.next_retry_at):
                                continue  # Not ready yet

                            # Mark as processing
                            item.status = 'processing'
                            item.started_at = now
                            item.lease_expires_at = now + (self.config.lease_timeout_ms / 1000.0)
                            self.processing[item.id] = item

                            return item

            if not wait:
                return None

            # Wait and retry
            if (time.time() - start_time) * 1000 > timeout_ms:
                return None

            time.sleep(0.01)  # 10ms

    def ack(self, item_id: str) -> bool:
        """
        Acknowledge successful completion.
        Removes item from queue.
        """
        with self._queue_lock:
            item = self.processing.pop(item_id, None)
            if not item:
                # Maybe in overflow queue
                if self.overflow:
                    return self.overflow.ack(item_id)
                return False

            # Remove from priority queue
            queue = self.priority_queues[item.priority]
            if item in queue:
                queue.remove(item)

            item.status = 'completed'

            # Update stats
            self.total_processed += 1
            self.total_wait_time_ms += (time.time() - item.enqueued_at) * 1000

            # Call callback if provided
            if item.callback:
                try:
                    item.callback(None)  # Success
                except:
                    pass

            return True

    def nack(self, item_id: str, error: str) -> str:
        """
        Negative acknowledge - failure, will retry.

        Returns: 'retry', 'dlq', or 'not_found'
        """
        with self._queue_lock:
            item = self.processing.pop(item_id, None)
            if not item:
                # Maybe in overflow queue
                if self.overflow:
                    # Check retry count from overflow
                    # For simplicity, just NACK with default delay
                    self.overflow.nack(item_id, error, self.config.base_retry_delay_ms)
                    return 'retry'
                return 'not_found'

            return self._nack_item(item, error)

    def _nack_item(self, item: QueueItem, error: str) -> str:
        """Internal NACK logic"""
        item.retry_count += 1
        item.last_error = error
        self.total_retries += 1

        # Check max retries
        if item.retry_count >= self.config.max_retries:
            # Move to DLQ
            item.status = 'dlq'

            # Remove from priority queue
            queue = self.priority_queues[item.priority]
            if item in queue:
                queue.remove(item)

            # Add to DLQ
            dlq_item = DLQItem(
                id=item.id,
                priority=item.original_priority,
                data=item.data,
                enqueued_at=item.enqueued_at,
                failed_at=time.time(),
                retry_count=item.retry_count,
                last_error=error
            )
            self.dlq.append(dlq_item)

            # Trim DLQ if needed
            while len(self.dlq) > self.config.dlq_max_size:
                self.dlq.pop(0)

            # Call callback with error
            if item.callback:
                try:
                    item.callback(Exception(f"Failed after {item.retry_count} retries: {error}"))
                except:
                    pass

            return 'dlq'

        # Schedule retry with exponential backoff
        retry_delay = self._get_retry_delay(item.retry_count)
        item.next_retry_at = time.time() + (retry_delay / 1000.0)
        item.status = 'pending'
        item.started_at = None
        item.lease_expires_at = None

        return 'retry'

    def acquire_throttle(self, priority: Priority = Priority.MEDIUM) -> float:
        """
        Acquire permission to process a request (for non-queued operations).
        Returns the delay in seconds that was applied.
        """
        with self._token_lock:
            self._refill_tokens()

            delay_ms = 0.0

            # Calculate priority-based delay
            priority_multiplier = self.config.priority_delay_multiplier.get(
                int(priority), 1.0
            )
            base_delay = self.config.base_delay_ms * priority_multiplier

            # Apply CPU multiplier
            cpu_multiplier = self._get_cpu_multiplier()
            if cpu_multiplier > 1.0:
                self.throttle_events += 1

            delay_ms = base_delay * cpu_multiplier

            # Token bucket rate limiting
            if self.tokens < 1.0:
                wait_time = (1.0 - self.tokens) / self.config.max_requests_per_second
                delay_ms += wait_time * 1000.0
                self.tokens = 0.0
            else:
                self.tokens -= 1.0

            # Apply delay
            if delay_ms > 0:
                time.sleep(delay_ms / 1000.0)

            return delay_ms / 1000.0

    def get_stats(self) -> Dict[str, Any]:
        """Get comprehensive queue statistics"""
        with self._queue_lock:
            queue_lengths = {p.name: len(self.priority_queues[p]) for p in Priority}
            total_queued = sum(queue_lengths.values())

            pending_retries = sum(
                1 for q in self.priority_queues.values()
                for item in q
                if item.retry_count > 0 and item.status == 'pending'
            )

        overflow_pending = self.overflow.get_pending_count() if self.overflow else 0

        return {
            'queue_lengths': queue_lengths,
            'total_queued': total_queued,
            'processing': len(self.processing),
            'pending_retries': pending_retries,
            'total_retries': self.total_retries,
            'total_processed': self.total_processed,
            'dlq_size': len(self.dlq),
            'overflow_pending': overflow_pending,
            'cpu_usage': round(self.cpu_monitor.get_cpu_usage(), 1),
            'throttle_events': self.throttle_events,
            'avg_wait_time_ms': (
                self.total_wait_time_ms / max(1, self.total_processed)
            ),
            'tokens_available': round(self.tokens, 2)
        }

    def get_dlq(self) -> List[DLQItem]:
        """Get Dead Letter Queue items"""
        # Clean up old items
        now = time.time()
        retention_sec = self.config.dlq_retention_ms / 1000.0
        self.dlq = [
            item for item in self.dlq
            if now - item.failed_at < retention_sec
        ]
        return list(self.dlq)

    def clear_dlq(self) -> int:
        """Clear Dead Letter Queue"""
        count = len(self.dlq)
        self.dlq.clear()
        return count


# ============================================================================
# Convenience Function
# ============================================================================

def create_qqms(db_config: Optional[Dict[str, str]] = None) -> QQMSv2:
    """
    Create a QQMS v2 instance with sensible defaults.

    Args:
        db_config: PostgreSQL config for overflow queue

    Returns:
        Configured QQMSv2 instance
    """
    config = QQMSv2Config()
    qqms = QQMSv2(config=config, db_config=db_config)
    qqms.start_drain_thread()
    return qqms


if __name__ == "__main__":
    # Test the QQMS v2 system
    print("Testing QQMS v2...")

    qqms = QQMSv2()

    # Enqueue some test items
    for i in range(5):
        item_id = qqms.enqueue(
            data={'test': i},
            priority=Priority.MEDIUM
        )
        print(f"Enqueued: {item_id}")

    # Process items
    while True:
        item = qqms.dequeue(wait=False)
        if not item:
            break

        print(f"Processing: {item.id} (priority: {item.priority.name})")

        # Simulate work
        time.sleep(0.1)

        # ACK
        qqms.ack(item.id)
        print(f"ACK: {item.id}")

    print("\nStats:", json.dumps(qqms.get_stats(), indent=2))
