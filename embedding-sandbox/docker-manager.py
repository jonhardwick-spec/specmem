#!/usr/bin/env python3
"""
Frankenstein Docker Manager

Manages the Frankenstein embeddings Docker container with:
- Auto-pause when idle (no requests for X seconds)
- Warm-start with overflow queue injection
- CPU monitoring and enforcement
- Health checks
- Project isolation for multi-instance support
"""

import os

SPECMEM_HOME = os.environ.get('SPECMEM_HOME', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPECMEM_RUN_DIR = os.environ.get('SPECMEM_RUN_DIR', os.path.join(SPECMEM_HOME, 'run'))
SPECMEM_SOCKET_DIR = os.environ.get('SPECMEM_SOCKET_DIR', SPECMEM_RUN_DIR)

import subprocess
import time
import sys
import json
import socket
import threading
from datetime import datetime
from typing import Optional
from overflow_queue import get_overflow_queue

# Import project isolation utilities - centralized module for multi-instance support
# All project-scoped paths and names come from this shared module
from project_isolation import (
    get_project_path,
    get_project_hash,
    get_project_container_name,
    get_project_socket_dir,
    get_project_socket_path,
    get_project_overflow_dir,
    get_project_overflow_db,
    ensure_project_dirs
)

# =============================================================================
# CONFIGURATION (project-scoped via project_isolation module)
# =============================================================================
# Container name format: frankenstein-{8char_hash} (e.g., frankenstein-a1b2c3d4)
# Each project gets its own isolated container, socket, and overflow directories.
# Hash is SHA256 of SPECMEM_PROJECT_PATH (fallback: cwd), first 8 chars.

CONTAINER_NAME = get_project_container_name()
SOCKET_PATH = get_project_socket_path()
IDLE_TIMEOUT_SECONDS = 60  # Pause after 60 seconds of no activity
CHECK_INTERVAL_SECONDS = 10
MAX_CPU_PERCENT = 20
OVERFLOW_DB = get_project_overflow_db()

class DockerManager:
    """Manages the Frankenstein Docker container lifecycle"""

    def __init__(self):
        self.last_request_time = time.time()
        self.is_paused = False
        self.container_running = False
        self.queue = get_overflow_queue()  # Uses PostgreSQL, path not needed
        self._lock = threading.Lock()

    def docker_cmd(self, *args) -> tuple:
        """Run a docker command and return (success, output)"""
        try:
            result = subprocess.run(
                ["docker"] + list(args),
                capture_output=True,
                text=True,
                timeout=30
            )
            return result.returncode == 0, result.stdout.strip()
        except Exception as e:
            return False, str(e)

    def is_container_running(self) -> bool:
        """Check if container is running"""
        success, output = self.docker_cmd(
            "inspect", "-f", "{{.State.Running}}", CONTAINER_NAME
        )
        return success and output == "true"

    def is_container_paused(self) -> bool:
        """Check if container is paused"""
        success, output = self.docker_cmd(
            "inspect", "-f", "{{.State.Paused}}", CONTAINER_NAME
        )
        return success and output == "true"

    def start_container(self):
        """Start the Frankenstein container with CPU limits"""
        # Log project isolation info
        project_path = get_project_path()
        project_hash = get_project_hash()
        print(f"Project: {project_path}")
        print(f"Container: {CONTAINER_NAME}")
        print(f"Starting Frankenstein container with {MAX_CPU_PERCENT}% CPU limit...")

        # Remove old container if exists
        self.docker_cmd("rm", "-f", CONTAINER_NAME)

        # Create project-scoped directories using shared utility
        dirs = ensure_project_dirs()
        socket_dir = dirs['socket_dir']
        overflow_dir = dirs['overflow_dir']

        # Start with CPU limit and project-scoped volumes
        success, output = self.docker_cmd(
            "run", "-d",
            "--name", CONTAINER_NAME,
            f"--cpus={MAX_CPU_PERCENT / 100}",  # 0.2 = 20%
            "--memory=2g",
            "-v", f"{socket_dir}:/sockets",
            "-v", f"{overflow_dir}:/overflow",
            "-e", f"SOCKET_PATH=/sockets/frankenstein.sock",
            "-e", f"OVERFLOW_DB=/overflow/queue.db",
            "-e", f"SPECMEM_PROJECT_PATH={project_path}",
            "-e", f"SPECMEM_PROJECT_HASH={project_hash}",
            "-e", "MAX_RPS=3",
            "-e", "BASE_DELAY=200",
            "--label", f"specmem.project={project_hash}",
            "--label", f"specmem.created={int(time.time())}",
            "--label", f"specmem.path={project_path}",
            "frankenstein-embeddings"
        )

        if success:
            print(f"Container started: {output[:12]}")
            self.container_running = True
            self.is_paused = False
            self.last_request_time = time.time()
            return True
        else:
            print(f"Failed to start container: {output}")
            return False

    def pause_container(self):
        """Pause the container to save CPU"""
        if self.is_paused:
            return True

        print(f"⏸️  Pausing container (idle for {IDLE_TIMEOUT_SECONDS}s)...")
        success, output = self.docker_cmd("pause", CONTAINER_NAME)

        if success:
            self.is_paused = True
            print("✅ Container paused - CPU usage: 0%")
            return True
        else:
            print(f"❌ Failed to pause: {output}")
            return False

    def unpause_container(self):
        """Unpause the container (warm start)"""
        if not self.is_paused:
            return True

        print("▶️  Unpausing container (warm start)...")
        success, output = self.docker_cmd("unpause", CONTAINER_NAME)

        if success:
            self.is_paused = False
            self.last_request_time = time.time()
            print("✅ Container unpaused")
            # Process overflow queue
            self.process_overflow_queue()
            return True
        else:
            print(f"❌ Failed to unpause: {output}")
            return False

    def process_overflow_queue(self):
        """Process queued requests after warm start"""
        pending = self.queue.get_pending_count()
        if pending == 0:
            return

        print(f"📦 Processing {pending} queued requests...")

        # Get pending requests
        requests = self.queue.dequeue(limit=100)
        if not requests:
            return

        # Mark as processing
        ids = [r.id for r in requests]
        self.queue.mark_processing(ids)

        # Send to container via socket
        for req in requests:
            try:
                # Connect to socket and send request
                sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                sock.connect(SOCKET_PATH)

                message = json.dumps({
                    'action': 'embed_batch' if req.request_type == 'batch' else 'embed',
                    'texts': req.texts,
                    'priority': req.priority,
                    'dimensions': req.dimensions
                })
                sock.sendall(message.encode() + b'\n')

                # Read response
                response = b''
                while True:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    response += chunk
                    if b'\n' in chunk:
                        break

                sock.close()

                result = json.loads(response.decode())
                self.queue.mark_completed(req.id, result=result)

            except Exception as e:
                self.queue.mark_completed(req.id, error=str(e))

        print(f"✅ Processed {len(requests)} queued requests")

    def record_request(self):
        """Record that a request was received"""
        with self._lock:
            self.last_request_time = time.time()
            if self.is_paused:
                self.unpause_container()

    def queue_request(self, texts: list, priority: int = 2, dimensions: int = None) -> int:
        """Queue a request when container is paused"""
        return self.queue.enqueue(
            texts=texts,
            request_type='batch' if len(texts) > 1 else 'single',
            priority=priority,
            dimensions=dimensions
        )

    def run_idle_monitor(self):
        """Monitor for idle and pause when appropriate"""
        print(f"👀 Starting idle monitor (timeout: {IDLE_TIMEOUT_SECONDS}s)")

        while True:
            time.sleep(CHECK_INTERVAL_SECONDS)

            if not self.container_running:
                continue

            if self.is_paused:
                continue

            with self._lock:
                idle_time = time.time() - self.last_request_time

            if idle_time > IDLE_TIMEOUT_SECONDS:
                self.pause_container()

    def get_status(self) -> dict:
        """Get current status"""
        with self._lock:
            idle_time = time.time() - self.last_request_time

        return {
            'container_running': self.container_running,
            'is_paused': self.is_paused,
            'idle_seconds': round(idle_time, 1),
            'max_cpu_percent': MAX_CPU_PERCENT,
            'queue_pending': self.queue.get_pending_count(),
            'queue_stats': self.queue.get_stats(),
            # Project isolation info
            'project_path': get_project_path(),
            'project_hash': get_project_hash(),
            'container_name': CONTAINER_NAME,
            'socket_path': SOCKET_PATH,
            'overflow_db': OVERFLOW_DB
        }


def main():
    """Main entry point"""
    manager = DockerManager()

    # Check if container image exists
    success, _ = manager.docker_cmd("image", "inspect", "frankenstein-embeddings")
    if not success:
        print("❌ Docker image 'frankenstein-embeddings' not found!")
        print("   Build it first: docker build -f Dockerfile.frankenstein -t frankenstein-embeddings .")
        sys.exit(1)

    # Start container
    if not manager.start_container():
        sys.exit(1)

    # Start idle monitor in background
    monitor_thread = threading.Thread(target=manager.run_idle_monitor, daemon=True)
    monitor_thread.start()

    # Keep running
    print(f"Frankenstein Docker Manager running")
    print(f"   Project: {get_project_path()}")
    print(f"   Container: {CONTAINER_NAME}")
    print(f"   Hash: {get_project_hash()}")
    print(f"   CPU cap: {MAX_CPU_PERCENT}%")
    print(f"   Idle timeout: {IDLE_TIMEOUT_SECONDS}s")
    print(f"   Socket: {SOCKET_PATH}")
    print(f"   Overflow: {OVERFLOW_DB}")

    try:
        while True:
            time.sleep(30)
            status = manager.get_status()
            print(f"📊 Status: {'PAUSED' if status['is_paused'] else 'RUNNING'} | "
                  f"Idle: {status['idle_seconds']}s | "
                  f"Queue: {status['queue_pending']}")
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
        manager.docker_cmd("stop", CONTAINER_NAME)


if __name__ == "__main__":
    main()
