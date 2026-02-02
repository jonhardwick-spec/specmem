#!/usr/bin/env python3
"""
Project Isolation Utilities for SpecMem Multi-Instance Support

Provides project-scoped naming for Docker containers, sockets, and directories
to allow multiple SpecMem instances to run simultaneously without conflicts.

Uses SPECMEM_PROJECT_PATH env var (set by bootstrap.cjs) to generate unique
12-character hashes for each project.
"""

import os
import hashlib
from typing import Optional

# Default paths - use ~/.specmem/instances/{hash}/ structure for isolation
# This matches the pattern used throughout SpecMem for multi-instance support
DEFAULT_INSTANCE_BASE = os.path.expanduser("~/.specmem/instances")
DEFAULT_SOCKET_BASE = os.path.expanduser("~/.specmem/instances")  # Will add {hash}/sockets
DEFAULT_OVERFLOW_BASE = os.path.expanduser("~/.specmem/instances")  # Will add {hash}/overflow
DEFAULT_CONTAINER_PREFIX = "frankenstein"


def get_project_path() -> str:
    """
    Get the project path from environment or fallback to cwd.

    Priority:
    1. SPECMEM_PROJECT_PATH env var (set by bootstrap.cjs)
    2. Current working directory

    Returns:
        str: Absolute path to the project
    """
    project_path = os.environ.get('SPECMEM_PROJECT_PATH')
    if project_path:
        return os.path.abspath(project_path)
    return os.getcwd()


def get_project_dir_name(project_path: Optional[str] = None) -> str:
    """
    Get the project directory name (basename) from the project path.

    This matches the TypeScript implementation in instanceManager.ts.
    Uses the directory name directly for human-readable container names.

    Args:
        project_path: Optional explicit project path. If not provided,
                     uses get_project_path() to determine it.

    Returns:
        str: Directory name sanitized for Docker container naming
             (lowercase, alphanumeric + hyphens only)

    Examples:
        >>> get_project_dir_name("/home/user/myproject")
        'myproject'
        >>> get_project_dir_name("/specmem")
        'specmem'
    """
    if project_path is None:
        project_path = get_project_path()

    # Get the directory name (basename)
    dir_name = os.path.basename(os.path.normpath(os.path.abspath(project_path)))

    # Sanitize for Docker container naming: lowercase, alphanumeric + hyphens
    # Replace underscores and spaces with hyphens, remove other special chars
    sanitized = dir_name.lower()
    sanitized = sanitized.replace('_', '-').replace(' ', '-')
    # Keep only alphanumeric and hyphens
    sanitized = ''.join(c for c in sanitized if c.isalnum() or c == '-')
    # Remove leading/trailing hyphens and collapse multiple hyphens
    while '--' in sanitized:
        sanitized = sanitized.replace('--', '-')
    sanitized = sanitized.strip('-')

    # Fallback to hash if name is empty or too short
    if len(sanitized) < 2:
        return get_project_hash(project_path)

    return sanitized


def get_project_hash(project_path: Optional[str] = None) -> str:
    """
    Generate a 12-character hash from the project path.

    DEPRECATED: Prefer get_project_dir_name() for human-readable names.
    This is kept for backwards compatibility and edge cases.

    Uses SHA256 for consistent, collision-resistant hashing.

    Args:
        project_path: Optional explicit project path. If not provided,
                     uses get_project_path() to determine it.

    Returns:
        str: 12-character lowercase hex hash (e.g., "a1b2c3d4e5f6")

    Examples:
        >>> get_project_hash("/home/user/myproject")
        'a1b2c3d4e5f6'
        >>> get_project_hash("/specmem")
        'e5f6g7h8i9j0'
    """
    if project_path is None:
        project_path = get_project_path()

    # Normalize path for consistent hashing
    normalized = os.path.normpath(os.path.abspath(project_path))

    # SHA256 hash and take first 12 characters
    hash_obj = hashlib.sha256(normalized.encode('utf-8'))
    return hash_obj.hexdigest()[:12]


def get_project_container_name(project_path: Optional[str] = None,
                                prefix: str = DEFAULT_CONTAINER_PREFIX,
                                use_hash: bool = False) -> str:
    """
    Get the Docker container name scoped to this project.

    Format: {prefix}-{project_dir_name} (human-readable)
    Or:     {prefix}-{project_hash} (if use_hash=True)

    Args:
        project_path: Optional explicit project path
        prefix: Container name prefix (default: "frankenstein")
        use_hash: If True, use hash instead of dir name (legacy behavior)

    Returns:
        str: Container name like "frankenstein-myproject" or "frankenstein-a1b2c3d4e5f6"

    Examples:
        >>> get_project_container_name("/home/user/myproject")
        'frankenstein-myproject'
        >>> get_project_container_name("/specmem", prefix="embeddings")
        'embeddings-specmem'
        >>> get_project_container_name("/specmem", use_hash=True)
        'frankenstein-e5f6g7h8i9j0'
    """
    if use_hash:
        identifier = get_project_hash(project_path)
    else:
        identifier = get_project_dir_name(project_path)
    return f"{prefix}-{identifier}"


def get_project_socket_dir(project_path: Optional[str] = None,
                           base_dir: Optional[str] = None) -> str:
    """
    Get the socket directory path scoped to this project.

    Format: ~/.specmem/instances/{project_hash}/sockets

    Args:
        project_path: Optional explicit project path
        base_dir: Base directory (default: ~/.specmem/instances)

    Returns:
        str: Socket directory path like "~/.specmem/instances/a1b2c3d4/sockets"
    """
    if base_dir is None:
        base_dir = DEFAULT_INSTANCE_BASE
    project_hash = get_project_hash(project_path)
    return os.path.join(base_dir, project_hash, "sockets")


def get_project_socket_path(socket_name: str = "frankenstein.sock",
                            project_path: Optional[str] = None,
                            base_dir: Optional[str] = None) -> str:
    """
    Get the full socket file path scoped to this project.

    Args:
        socket_name: Name of the socket file
        project_path: Optional explicit project path
        base_dir: Base directory (default: ~/.specmem/instances)

    Returns:
        str: Full socket path like "~/.specmem/instances/a1b2c3d4/sockets/frankenstein.sock"
    """
    socket_dir = get_project_socket_dir(project_path, base_dir)
    return os.path.join(socket_dir, socket_name)


def get_project_overflow_dir(project_path: Optional[str] = None,
                             base_dir: Optional[str] = None) -> str:
    """
    Get the overflow queue directory path scoped to this project.

    Format: ~/.specmem/instances/{project_hash}/overflow

    Args:
        project_path: Optional explicit project path
        base_dir: Base directory (default: ~/.specmem/instances)

    Returns:
        str: Overflow directory path like "~/.specmem/instances/a1b2c3d4/overflow"
    """
    if base_dir is None:
        base_dir = DEFAULT_INSTANCE_BASE
    project_hash = get_project_hash(project_path)
    return os.path.join(base_dir, project_hash, "overflow")


def get_project_overflow_db(db_name: str = "queue.db",
                            project_path: Optional[str] = None,
                            base_dir: Optional[str] = None) -> str:
    """
    Get the full overflow database path scoped to this project.

    Args:
        db_name: Name of the database file
        project_path: Optional explicit project path
        base_dir: Base directory (default: ~/.specmem/instances)

    Returns:
        str: Full database path like "~/.specmem/instances/a1b2c3d4/overflow/queue.db"
    """
    overflow_dir = get_project_overflow_dir(project_path, base_dir)
    return os.path.join(overflow_dir, db_name)


def ensure_project_dirs(project_path: Optional[str] = None) -> dict:
    """
    Create all project-scoped directories if they don't exist.

    Args:
        project_path: Optional explicit project path

    Returns:
        dict: Created directory paths
    """
    socket_dir = get_project_socket_dir(project_path)
    overflow_dir = get_project_overflow_dir(project_path)

    os.makedirs(socket_dir, exist_ok=True)
    os.makedirs(overflow_dir, exist_ok=True)

    return {
        'socket_dir': socket_dir,
        'overflow_dir': overflow_dir,
        'project_dir_name': get_project_dir_name(project_path),
        'project_hash': get_project_hash(project_path),  # kept for backwards compat
        'project_path': get_project_path() if project_path is None else project_path
    }


def get_all_project_config(project_path: Optional[str] = None) -> dict:
    """
    Get all project-scoped configuration values at once.

    Args:
        project_path: Optional explicit project path

    Returns:
        dict: All project-scoped configuration
    """
    return {
        'project_path': get_project_path() if project_path is None else project_path,
        'project_dir_name': get_project_dir_name(project_path),
        'project_hash': get_project_hash(project_path),  # kept for backwards compat
        'container_name': get_project_container_name(project_path),
        'socket_dir': get_project_socket_dir(project_path),
        'socket_path': get_project_socket_path(project_path=project_path),
        'overflow_dir': get_project_overflow_dir(project_path),
        'overflow_db': get_project_overflow_db(project_path=project_path)
    }


# CLI for testing
if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) > 1:
        path = sys.argv[1]
        print(f"Project: {path}")
    else:
        path = None
        print(f"Project: {get_project_path()} (from env/cwd)")

    config = get_all_project_config(path)
    print(json.dumps(config, indent=2))

    # Show the difference between dir name and hash
    print(f"\nContainer naming:")
    print(f"  Dir name: {get_project_dir_name(path)} (human-readable)")
    print(f"  Hash:     {get_project_hash(path)} (legacy)")
