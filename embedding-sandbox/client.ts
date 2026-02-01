/**
 * SANDBOXED EMBEDDING CLIENT - DYNAMIC DIMENSIONS
 *
 * Communicates with the air-gapped embedding Docker container
 * via Unix socket. The container has NO NETWORK ACCESS.
 *
 * This client:
 *   - Sends text to the sandboxed container
 *   - Receives embedding vectors at DATABASE dimension
 *   - Falls back to hash-based embeddings if container unavailable
 *   - Dynamically queries DB for target dimension
 *
 * NO HARDCODED DIMENSIONS - database is truth!
 */

import { createConnection } from 'net';
import { existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import { spawn, ChildProcess } from 'child_process';

// Auto-start configuration
// frankenstein-embeddings.py has ALL 4 optimizations + ACK verification
// We NEVER use a model that hasn't been optimized with all 4 optimizations
const EMBEDDING_SCRIPT = '/usr/lib/node_modules/specmem-hardwicksoftware/embedding-sandbox/frankenstein-embeddings.py';
const AUTO_START_TIMEOUT_MS = 15000; // 15 seconds to wait for server to start (fail-fast)
const AUTO_START_CHECK_INTERVAL_MS = 500; // Check every 500ms

// Debug logging - SILENT BY DEFAULT to not break ProgressUI
// Set SPECMEM_EMBEDDING_DEBUG=1 to enable verbose logging
const DEBUG = process.env.SPECMEM_EMBEDDING_DEBUG === '1';
const debugLog = DEBUG ? console.log.bind(console) : () => {};
const debugWarn = DEBUG ? console.warn.bind(console) : () => {};
const debugError = DEBUG ? console.error.bind(console) : () => {};

/**
 * Get the Python executable path for spawning Python processes (Task #22 fix)
 *
 * Priority order:
 * 1. SPECMEM_PYTHON_PATH env var (explicit override)
 * 2. PYTHON_PATH env var (common convention)
 * 3. Virtual environment python (if VIRTUAL_ENV is set)
 * 4. Fallback to 'python3'
 */
function getPythonPath(): string {
  // Priority 1: Explicit SpecMem override
  if (process.env['SPECMEM_PYTHON_PATH']) {
    return process.env['SPECMEM_PYTHON_PATH'];
  }

  // Priority 2: Common PYTHON_PATH convention
  if (process.env['PYTHON_PATH']) {
    return process.env['PYTHON_PATH'];
  }

  // Priority 3: Check for activated virtualenv
  const virtualEnv = process.env['VIRTUAL_ENV'];
  if (virtualEnv) {
    // venv python is at VIRTUAL_ENV/bin/python on Unix, VIRTUAL_ENV/Scripts/python.exe on Windows
    const isWindows = process.platform === 'win32';
    const venvPython = isWindows
      ? virtualEnv + '/Scripts/python.exe'
      : virtualEnv + '/bin/python';
    return venvPython;
  }

  // Priority 4: Fallback to system python3
  return 'python3';
}

// Track auto-started processes per project
const autoStartedProcesses: Map<string, ChildProcess> = new Map();

// Embedding timeout - configurable via env, default 30 seconds
// Faster fail-fast behavior with retry logic handles transient failures better than long waits
const TIMEOUT_MS = parseInt(process.env.SPECMEM_EMBEDDING_TIMEOUT || '30000');
const MAX_RETRIES = parseInt(process.env.SPECMEM_EMBEDDING_RETRIES || '3');
const RETRY_BACKOFF_MS = 1000;

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get project hash for instance isolation (COLLISION-FREE!)
 * Uses SHA256 hash of FULL project path to ensure different paths get different instances.
 * This prevents collisions between /specmem and ~/specmem.
 * Format: First 16 chars of hash (e.g., "a1b2c3d4e5f6a7b8")
 */
export function getProjectDirName(): string {
  // Prefer pre-computed hash from bootstrap.cjs
  if (process.env.SPECMEM_PROJECT_DIR_NAME) {
    return process.env.SPECMEM_PROJECT_DIR_NAME;
  }
  // Compute hash from FULL project path
  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
  const { resolve } = require('path');
  const normalizedPath = resolve(projectPath).toLowerCase().replace(/\\/g, '/');
  return createHash('sha256').update(normalizedPath).digest('hex').slice(0, 16);
}

/**
 * Generate 12-char hash of project path for legacy compatibility.
 * @deprecated Use getProjectDirName() for new code
 */
export function getProjectHash(): string {
  // Prefer pre-computed hash from bootstrap.cjs
  if (process.env.SPECMEM_PROJECT_HASH) {
    return process.env.SPECMEM_PROJECT_HASH.slice(0, 12);
  }
  // Compute from project path - use resolve() for consistent paths
  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
  const { resolve } = require('path');
  return createHash('sha256').update(resolve(projectPath)).digest('hex').slice(0, 12);
}

/**
 * Get the project-scoped instance directory.
 * Pattern: ~/.specmem/instances/{project_dir_name}/
 * Uses readable directory name instead of hash for easier debugging.
 */
export function getProjectInstanceDir(): string {
  const dirName = getProjectDirName();
  return join(homedir(), '.specmem', 'instances', dirName);
}

/**
 * Get the project-scoped socket directory.
 * Pattern: {PROJECT}/specmem/sockets/
 *
 * NOTE: Changed from ~/.specmem/instances/{dir}/sockets/ to project-local
 * for complete project isolation.
 */
export function getProjectSocketDir(): string {
  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
  return join(projectPath, 'specmem', 'sockets');
}

/**
 * Get the machine-unique shared socket path for embeddings.
 * Falls back to env var SPECMEM_EMBEDDING_SOCKET for override capability.
 *
 * SOCKET PATH RESOLUTION - MACHINE-SHARED BUT USER-ISOLATED:
 * 1. SPECMEM_EMBEDDING_SOCKET env var (explicit override - HIGHEST PRIORITY)
 * 2. Machine-unique shared socket: /tmp/specmem-embed-{uid}.sock
 *
 * IMPORTANT: Embedding server is stateless and can be safely shared across projects.
 * This is more memory-efficient than per-project embedding servers.
 * Socket is still isolated per user (UID) to prevent cross-user conflicts.
 */
export function getProjectSocketPath(): string {
  // Allow explicit override via env var
  if (process.env.SPECMEM_EMBEDDING_SOCKET) {
    debugLog(`[Embedding] Using explicit SPECMEM_EMBEDDING_SOCKET: ${process.env.SPECMEM_EMBEDDING_SOCKET}`);
    return process.env.SPECMEM_EMBEDDING_SOCKET;
  }

  // MACHINE-SHARED: Single socket per user, shared across all projects
  // Pattern: /tmp/specmem-embed-{uid}.sock
  // Embeddings are stateless - one server can serve all projects efficiently
  const userId = process.getuid ? process.getuid() : 'default';
  const sharedSocketPath = join(tmpdir(), `specmem-embed-${userId}.sock`);

  // Check if socket exists
  if (existsSync(sharedSocketPath)) {
    debugLog(`[Embedding] Found shared socket at: ${sharedSocketPath}`);
    return sharedSocketPath;
  }

  // Return shared socket path (server will create it)
  debugLog(`[Embedding] Socket not found. Expected at: ${sharedSocketPath}`);
  debugLog(`[Embedding] Start embedding server (shared across all projects)`);
  return sharedSocketPath;
}

/**
 * Get the default socket path - now project-scoped.
 * Uses a getter function to ensure dynamic resolution.
 */
const getDefaultSocketPath = (): string => {
  return process.env.SPECMEM_EMBEDDING_SOCKET || getProjectSocketPath();
};

/**
 * AUTO-START EMBEDDING SERVER
 * Spawns frankenstein-embeddings.py for the current project if socket doesn't exist.
 * Returns true if server was started successfully, false otherwise.
 */
async function autoStartEmbeddingServer(socketPath: string): Promise<boolean> {
  const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();

  // Check if already auto-started for this project
  if (autoStartedProcesses.has(projectPath)) {
    const proc = autoStartedProcesses.get(projectPath)!;
    if (proc.exitCode === null) {
      debugLog(`[Embedding] Auto-start already in progress for ${projectPath}`);
      // Wait for socket to appear
      return waitForSocket(socketPath);
    }
    // Previous process died, remove from map
    autoStartedProcesses.delete(projectPath);
  }

  // Check if socket already exists
  if (existsSync(socketPath)) {
    return true;
  }

  debugLog(`[Embedding] AUTO-STARTING embedding server for project: ${projectPath}`);

  // Ensure socket directory exists
  const socketDir = dirname(socketPath);
  if (!existsSync(socketDir)) {
    try {
      mkdirSync(socketDir, { recursive: true });
    } catch (err) {
      debugError(`[Embedding] Failed to create socket directory: ${err}`);
    }
  }

  // Check if embedding script exists
  if (!existsSync(EMBEDDING_SCRIPT)) {
    debugError(`[Embedding] Embedding script not found: ${EMBEDDING_SCRIPT}`);
    return false;
  }

  try {
    // Spawn the embedding server
    const env = {
      ...process.env,
      SPECMEM_PROJECT_PATH: projectPath,
      SPECMEM_EMBEDDING_MAX_WORKERS: process.env.SPECMEM_EMBEDDING_MAX_WORKERS || '10',
    };

    // Task #22 fix: Use getPythonPath() instead of hardcoded 'python3'
    const pythonPath = getPythonPath();
    const proc = spawn(pythonPath, [EMBEDDING_SCRIPT], {
      env,
      cwd: projectPath,
      detached: true, // Allow process to run independently
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Unref so it doesn't keep the parent alive
    proc.unref();

    // Track the process
    autoStartedProcesses.set(projectPath, proc);

    // Log output for debugging
    proc.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && process.env.SPECMEM_DEBUG) {
        debugError(`[Embedding Server] ${msg}`);
      }
    });

    proc.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        // Only log important messages
        if (msg.includes('Socket') || msg.includes('READY') || msg.includes('Error') || msg.includes('FRANKENSTEIN')) {
          debugError(`[Embedding Server] ${msg}`);
        }
      }
    });

    proc.on('error', (err) => {
      debugError(`[Embedding] Failed to start embedding server: ${err}`);
      autoStartedProcesses.delete(projectPath);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        debugError(`[Embedding] Embedding server exited with code ${code}`);
      }
      autoStartedProcesses.delete(projectPath);
    });

    debugLog(`[Embedding] Embedding server spawned (PID: ${proc.pid}), waiting for socket...`);

    // Wait for socket to appear
    return waitForSocket(socketPath);
  } catch (err) {
    debugError(`[Embedding] Failed to spawn embedding server: ${err}`);
    return false;
  }
}

/**
 * Wait for socket file to appear
 */
async function waitForSocket(socketPath: string): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < AUTO_START_TIMEOUT_MS) {
    if (existsSync(socketPath)) {
      debugLog(`[Embedding] Socket ready at ${socketPath}`);
      // Give it a moment to be fully ready
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, AUTO_START_CHECK_INTERVAL_MS));
  }

  debugError(`[Embedding] Timeout waiting for socket at ${socketPath}`);
  return false;
}

// Cached dimensions - queried from server/database
let cachedNativeDim: number | null = null;
let cachedTargetDim: number | null = null;

export interface BatchEmbeddingResult {
  embeddings: number[][];
  count: number;
  elapsed_ms: number;
  rate: number;  // embeddings per second
}

export interface SandboxedEmbeddingClient {
  generateEmbedding(text: string): Promise<number[]>;
  generateBatchEmbeddings(texts: string[]): Promise<BatchEmbeddingResult>;  // FAST batch processing!
  isAvailable(): boolean;  // Quick sync check (file exists + cached status)
  isAvailableAsync(): Promise<boolean>;  // Full health check (pings server)
  getDimensions(): Promise<number>;  // Now async - queries server/DB
  getNativeDimensions(): number | null;
  getTargetDimensions(): number | null;
  setTargetDimension(dim: number): Promise<void>;
}

class SandboxedEmbeddingClientImpl implements SandboxedEmbeddingClient {
  private socketPath: string;
  private available: boolean = false;

  constructor(socketPath?: string) {
    this.socketPath = socketPath || getDefaultSocketPath();

    // Log project instance identification
    const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
    debugLog(`[Embedding] Project: ${projectPath}`);
    debugLog(`[Embedding] Instance: ${getProjectDirName()}`);
    debugLog(`[Embedding] Socket: ${this.socketPath}`);

    this.checkAvailability();
  }

  private checkAvailability(): void {
    this.available = existsSync(this.socketPath);
    if (this.available) {
      debugLog(`[Embedding] Sandboxed embedding service available at ${this.socketPath}`);
      // Query dimensions from server on connect
      this.queryDimensionsFromServer().catch(() => {
        debugWarn('[Embedding] Could not query dimensions from server');
      });
    } else {
      debugWarn(`[Embedding] Sandboxed service not available, will auto-start on first use`);
    }
  }

  /**
   * Ensure embedding server is running - auto-starts if needed
   */
  private async ensureServerRunning(): Promise<boolean> {
    // Check if socket exists
    if (existsSync(this.socketPath)) {
      this.available = true;
      return true;
    }

    // Try to auto-start
    debugLog(`[Embedding] Socket not found, attempting auto-start...`);
    const started = await autoStartEmbeddingServer(this.socketPath);

    if (started) {
      this.available = true;
      // Query dimensions after start
      await this.queryDimensionsFromServer().catch(() => {
        debugWarn('[Embedding] Could not query dimensions after auto-start');
      });
      return true;
    }

    this.available = false;
    return false;
  }

  /**
   * Query dimensions from the embedding server
   */
  private async queryDimensionsFromServer(): Promise<void> {
    if (!this.isAvailable()) return;

    return new Promise((resolve) => {
      const socket = createConnection(this.socketPath);
      let buffer = '';

      const timeout = setTimeout(() => {
        socket.destroy();
        resolve();
      }, 5000);

      socket.on('connect', () => {
        socket.write(JSON.stringify({ type: 'get_dimension' }) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          clearTimeout(timeout);
          try {
            const response = JSON.parse(buffer.slice(0, newlineIndex));
            if (response.native_dimensions) {
              cachedNativeDim = response.native_dimensions;
            }
            if (response.target_dimensions) {
              cachedTargetDim = response.target_dimensions;
            }
            debugLog(`[Embedding] Dimensions: native=${cachedNativeDim}, target=${cachedTargetDim}`);
          } catch (err) {
            debugWarn('[Embedding] Failed to parse dimension response');
          }
          socket.end();
          resolve();
        }
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Check if embedding server is available AND responsive
   * Not just file existence - actually pings the server!
   */
  isAvailable(): boolean {
    // Quick check: if socket file doesn't exist, definitely not available
    if (!existsSync(this.socketPath)) {
      this.available = false;
      return false;
    }
    // Socket file exists - return cached status for sync check
    // Use isAvailableAsync() for actual health verification
    return this.available;
  }

  /**
   * Async health check - actually pings the server to verify it's responsive
   * Call this before critical operations to ensure server is alive
   */
  async isAvailableAsync(): Promise<boolean> {
    // Quick check: if socket file doesn't exist, definitely not available
    if (!existsSync(this.socketPath)) {
      this.available = false;
      return false;
    }

    // Actually ping the server with a health check
    return new Promise((resolve) => {
      const socket = createConnection(this.socketPath);
      let buffer = '';

      const timeout = setTimeout(() => {
        socket.destroy();
        debugWarn('[Embedding] Health check timeout - server unresponsive');
        this.available = false;
        this.triggerWarmStart();
        resolve(false);
      }, 3000); // 3 second timeout for health check

      socket.on('connect', () => {
        socket.write(JSON.stringify({ type: 'health' }) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          clearTimeout(timeout);
          try {
            const response = JSON.parse(buffer.slice(0, newlineIndex));
            if (response.status === 'healthy') {
              this.available = true;
              resolve(true);
            } else {
              this.available = false;
              this.triggerWarmStart();
              resolve(false);
            }
          } catch {
            this.available = false;
            this.triggerWarmStart();
            resolve(false);
          }
          socket.end();
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        debugWarn(`[Embedding] Health check error: ${err.message}`);
        this.available = false;
        this.triggerWarmStart();
        resolve(false);
      });
    });
  }

  /**
   * Trigger warm-start script to revive/unpause the embedding container
   */
  private triggerWarmStart(): void {
    // Try multiple paths to find warm-start.sh
    const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
    const possiblePaths = [
      // Project-local (development)
      join(projectPath, 'embedding-sandbox', 'warm-start.sh'),
      // Global npm install
      '/usr/lib/node_modules/specmem-hardwicksoftware/embedding-sandbox/warm-start.sh',
      // Local npm install (node_modules in project)
      join(projectPath, 'node_modules', 'specmem-hardwicksoftware', 'embedding-sandbox', 'warm-start.sh'),
      // Home directory install
      join(homedir(), '.specmem', 'embedding-sandbox', 'warm-start.sh'),
    ];

    const scriptPath = possiblePaths.find(p => existsSync(p));

    if (scriptPath) {
      debugLog(`[Embedding] Triggering warm-start from ${scriptPath}...`);
      spawn('bash', [scriptPath], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          SPECMEM_PROJECT_PATH: projectPath,
        },
      }).unref();
    } else {
      debugWarn('[Embedding] warm-start.sh not found at any expected location, cannot auto-recover');
      debugWarn('[Embedding] Searched:', possiblePaths.join(', '));
    }
  }

  async getDimensions(): Promise<number> {
    // Refresh from server if needed
    if (cachedTargetDim === null && this.isAvailable()) {
      await this.queryDimensionsFromServer();
    }
    // Return target dim if known, otherwise use fallback
    return cachedTargetDim ?? cachedNativeDim ?? 384;
  }

  getNativeDimensions(): number | null {
    return cachedNativeDim;
  }

  getTargetDimensions(): number | null {
    return cachedTargetDim;
  }

  async setTargetDimension(dim: number): Promise<void> {
    if (!this.isAvailable()) {
      cachedTargetDim = dim;
      return;
    }

    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let buffer = '';

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Timeout setting dimension'));
      }, 5000);

      socket.on('connect', () => {
        socket.write(JSON.stringify({ type: 'set_dimension', dimension: dim }) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          clearTimeout(timeout);
          try {
            const response = JSON.parse(buffer.slice(0, newlineIndex));
            if (response.status === 'ok') {
              cachedTargetDim = response.dimension;
              debugLog(`[Embedding] Target dimension set to ${cachedTargetDim}`);
              resolve();
            } else {
              reject(new Error(response.error || 'Failed to set dimension'));
            }
          } catch (err) {
            reject(err);
          }
          socket.end();
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Try to ensure server is running (auto-start if needed)
    const serverRunning = await this.ensureServerRunning();
    if (!serverRunning) {
      debugWarn('[Embedding] Server not available, using fallback embedding');
      return this.fallbackEmbedding(text);
    }

    // Retry loop for transient failures
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.attemptEmbedding(text);
        return result;
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES;
        const errMsg = err instanceof Error ? err.message : String(err);

        if (isLastAttempt) {
          debugError('[Embedding] All retries exhausted, using fallback. Last error: ' + errMsg);
          this.triggerWarmStart();
          return this.fallbackEmbedding(text);
        }

        debugWarn('[Embedding] Attempt ' + attempt + '/' + MAX_RETRIES + ' failed: ' + errMsg + '. Retrying in ' + (RETRY_BACKOFF_MS * attempt) + 'ms...');
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }

    return this.fallbackEmbedding(text);
  }

  /**
   * Single attempt to generate embedding - throws on failure for retry handling
   */
  private attemptEmbedding(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let buffer = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          this.available = false;
          reject(new Error('Timeout after ' + TIMEOUT_MS + 'ms'));
        }
      }, TIMEOUT_MS);

      socket.on('connect', () => {
        const request = JSON.stringify({ type: 'embed', text }) + '\n';
        socket.write(request);
      });

      socket.on('data', (data) => {
        buffer += data.toString();

        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          clearTimeout(timeout);
          if (resolved) return;
          resolved = true;

          try {
            const response = JSON.parse(buffer.slice(0, newlineIndex));

            if (response.error) {
              reject(new Error('Server error: ' + response.error));
            } else if (response.embedding) {
              resolve(response.embedding);
            } else {
              reject(new Error('Invalid response - no embedding'));
            }
          } catch (err) {
            reject(new Error('Parse error: ' + (err instanceof Error ? err.message : String(err))));
          }

          socket.end();
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          this.available = false;
          reject(new Error('Socket error: ' + err.message));
        }
      });
    });
  }

  /**
   * Generate embeddings for multiple texts in a single batch.
   * MUCH faster than calling generateEmbedding() for each text individually.
   * Sends all texts to server which processes them in one batch operation.
   * Includes retry logic for transient failures.
   */
  async generateBatchEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
    if (!texts.length) {
      return { embeddings: [], count: 0, elapsed_ms: 0, rate: 0 };
    }

    const overallStart = Date.now();

    // Try to ensure server is running (auto-start if needed)
    const serverRunning = await this.ensureServerRunning();
    if (!serverRunning) {
      debugWarn('[Embedding] Server not available, using fallback batch embedding');
      const embeddings = texts.map(t => this.fallbackEmbedding(t));
      const elapsed = Date.now() - overallStart;
      return {
        embeddings,
        count: texts.length,
        elapsed_ms: elapsed,
        rate: texts.length / (elapsed / 1000)
      };
    }

    // Retry loop for transient failures
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.attemptBatchEmbedding(texts);
        return result;
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES;
        const errMsg = err instanceof Error ? err.message : String(err);

        if (isLastAttempt) {
          debugError('[Embedding] Batch: All retries exhausted, using fallback. Last error: ' + errMsg);
          this.triggerWarmStart();
          const embeddings = texts.map(t => this.fallbackEmbedding(t));
          const elapsed = Date.now() - overallStart;
          return {
            embeddings,
            count: texts.length,
            elapsed_ms: elapsed,
            rate: texts.length / (elapsed / 1000)
          };
        }

        debugWarn('[Embedding] Batch attempt ' + attempt + '/' + MAX_RETRIES + ' failed: ' + errMsg + '. Retrying in ' + (RETRY_BACKOFF_MS * attempt) + 'ms...');
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }

    const embeddings = texts.map(t => this.fallbackEmbedding(t));
    const elapsed = Date.now() - overallStart;
    return {
      embeddings,
      count: texts.length,
      elapsed_ms: elapsed,
      rate: texts.length / (elapsed / 1000)
    };
  }

  /**
   * Single attempt to generate batch embeddings - throws on failure for retry handling
   */
  private attemptBatchEmbedding(texts: string[]): Promise<BatchEmbeddingResult> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let buffer = '';
      let resolved = false;
      const startTime = Date.now();

      // Timeout scales with batch size but capped reasonably
      const batchTimeout = Math.min(Math.max(TIMEOUT_MS, texts.length * 500), TIMEOUT_MS * 3);

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          this.available = false;
          reject(new Error('Batch timeout after ' + batchTimeout + 'ms'));
        }
      }, batchTimeout);

      socket.on('connect', () => {
        const request = JSON.stringify({ texts }) + '\n';
        socket.write(request);
      });

      socket.on('data', (data) => {
        buffer += data.toString();

        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex !== -1) {
          clearTimeout(timeout);
          if (resolved) return;
          resolved = true;

          try {
            const response = JSON.parse(buffer.slice(0, newlineIndex));

            if (response.error) {
              reject(new Error('Server error: ' + response.error));
            } else if (response.embeddings) {
              debugLog('[Embedding] Batch: ' + response.count + ' texts in ' + response.elapsed_ms + 'ms (' + response.rate + '/s)');
              resolve({
                embeddings: response.embeddings,
                count: response.count,
                elapsed_ms: response.elapsed_ms,
                rate: response.rate
              });
            } else {
              reject(new Error('Invalid response - no embeddings'));
            }
          } catch (err) {
            reject(new Error('Parse error: ' + (err instanceof Error ? err.message : String(err))));
          }

          socket.end();
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          this.available = false;
          reject(new Error('Socket error: ' + err.message));
        }
      });
    });
  }

  /**
   * Fallback hash-based embedding when sandboxed service unavailable
   * Uses dynamic dimension from cache or defaults to 384
   */
  private fallbackEmbedding(text: string): number[] {
    // Use cached target dimension, or native dimension, or default 384
    const targetDim = cachedTargetDim ?? cachedNativeDim ?? 384;

    const normalizedText = text.toLowerCase().trim();
    const hash = this.hashString(normalizedText);
    const embedding = new Array<number>(targetDim);

    for (let i = 0; i < targetDim; i++) {
      const seed1 = hash + i * 31;
      const seed2 = this.hashString(normalizedText.slice(0, Math.min(i + 10, normalizedText.length)));
      const combined = seed1 ^ seed2;
      embedding[i] = Math.sin(combined) * Math.cos(combined * 0.7);
    }

    // Add n-gram influence
    const ngramSize = 3;
    for (let i = 0; i <= normalizedText.length - ngramSize; i++) {
      const ngram = normalizedText.slice(i, i + ngramSize);
      const ngramHash = this.hashString(ngram);
      const position = ngramHash % targetDim;
      embedding[position] = (embedding[position] ?? 0) + 0.1;
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] = embedding[i]! / magnitude;
      }
    }

    return embedding;
  }

  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) + hash) ^ char;
    }
    return Math.abs(hash);
  }
}

// Singleton instance
let clientInstance: SandboxedEmbeddingClient | null = null;

export function getSandboxedEmbeddingClient(): SandboxedEmbeddingClient {
  if (!clientInstance) {
    clientInstance = new SandboxedEmbeddingClientImpl();
  }
  return clientInstance;
}

// Export dimension accessors (no hardcoded constants!)
export function getNativeDimension(): number | null {
  return cachedNativeDim;
}

export function getTargetDimension(): number | null {
  return cachedTargetDim;
}

export function setTargetDimension(dim: number): void {
  cachedTargetDim = dim;
}
