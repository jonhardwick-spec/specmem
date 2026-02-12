"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectDirName = getProjectDirName;
exports.getProjectHash = getProjectHash;
exports.getProjectInstanceDir = getProjectInstanceDir;
exports.getProjectSocketDir = getProjectSocketDir;
exports.getProjectSocketPath = getProjectSocketPath;
exports.getSandboxedEmbeddingClient = getSandboxedEmbeddingClient;
exports.getNativeDimension = getNativeDimension;
exports.getTargetDimension = getTargetDimension;
exports.setTargetDimension = setTargetDimension;
const net_1 = require("net");
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const path_1 = require("path");
const os_1 = require("os");
// Embedding timeout - 5 minutes to allow QOMS queue processing during cold starts
// QOMS manages resource scheduling, so we need generous timeout for queue waits
const TIMEOUT_MS = 300000;
/**
 * Get project hash for instance isolation (COLLISION-FREE!)
 * Uses SHA256 hash of FULL project path to ensure different paths get different instances.
 * This prevents collisions between /specmem and ~/specmem.
 * Format: First 16 chars of hash (e.g., "a1b2c3d4e5f6a7b8")
 */
function getProjectDirName() {
    // Prefer pre-computed hash from bootstrap.cjs
    if (process.env.SPECMEM_PROJECT_DIR_NAME) {
        return process.env.SPECMEM_PROJECT_DIR_NAME;
    }
    // Compute hash from FULL project path
    const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
    const { resolve } = require('path');
    const normalizedPath = resolve(projectPath).toLowerCase().replace(/\\/g, '/');
    return (0, crypto_1.createHash)('sha256').update(normalizedPath).digest('hex').slice(0, 16);
}
/**
 * Generate 12-char hash of project path for legacy compatibility.
 * @deprecated Use getProjectDirName() for new code
 */
function getProjectHash() {
    // Prefer pre-computed hash from bootstrap.cjs
    if (process.env.SPECMEM_PROJECT_HASH) {
        return process.env.SPECMEM_PROJECT_HASH.slice(0, 12);
    }
    // Compute from project path - use resolve() for consistent paths
    const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
    const { resolve } = require('path');
    return (0, crypto_1.createHash)('sha256').update(resolve(projectPath)).digest('hex').slice(0, 12);
}
/**
 * Get the project-scoped instance directory.
 * Pattern: ~/.specmem/instances/{project_dir_name}/
 * Uses readable directory name instead of hash for easier debugging.
 */
function getProjectInstanceDir() {
    const dirName = getProjectDirName();
    return (0, path_1.join)((0, os_1.homedir)(), '.specmem', 'instances', dirName);
}
/**
 * Get the project-scoped socket directory.
 * Pattern: {PROJECT}/specmem/sockets/
 *
 * NOTE: Changed from ~/.specmem/instances/{dir}/sockets/ to project-local
 * for complete project isolation.
 */
function getProjectSocketDir() {
    const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
    return (0, path_1.join)(projectPath, 'specmem', 'sockets');
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
function getProjectSocketPath() {
    // Allow explicit override via env var
    if (process.env.SPECMEM_EMBEDDING_SOCKET) {
        console.log(`[Embedding] Using explicit SPECMEM_EMBEDDING_SOCKET: ${process.env.SPECMEM_EMBEDDING_SOCKET}`);
        return process.env.SPECMEM_EMBEDDING_SOCKET;
    }
    // MACHINE-SHARED: Single socket per user, shared across all projects
    // Pattern: /tmp/specmem-embed-{uid}.sock
    // Embeddings are stateless - one server can serve all projects efficiently
    const userId = process.getuid ? process.getuid() : 'default';
    const sharedSocketPath = (0, path_1.join)((0, os_1.tmpdir)(), `specmem-embed-${userId}.sock`);
    // Check if socket exists
    if ((0, fs_1.existsSync)(sharedSocketPath)) {
        console.log(`[Embedding] Found shared socket at: ${sharedSocketPath}`);
        return sharedSocketPath;
    }
    // Return shared socket path (server will create it)
    console.log(`[Embedding] Socket not found. Expected at: ${sharedSocketPath}`);
    console.log(`[Embedding] Start embedding server (shared across all projects)`);
    return sharedSocketPath;
}
/**
 * Get the default socket path - now project-scoped.
 * Uses a getter function to ensure dynamic resolution.
 */
const getDefaultSocketPath = () => {
    return process.env.SPECMEM_EMBEDDING_SOCKET || getProjectSocketPath();
};
// Cached dimensions - queried from server/database
let cachedNativeDim = null;
let cachedTargetDim = null;
class SandboxedEmbeddingClientImpl {
    constructor(socketPath) {
        this.available = false;
        this.socketPath = socketPath || getDefaultSocketPath();
        // Log project instance identification
        const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
        console.log(`[Embedding] Project: ${projectPath}`);
        console.log(`[Embedding] Instance: ${getProjectDirName()}`);
        console.log(`[Embedding] Socket: ${this.socketPath}`);
        this.checkAvailability();
    }
    checkAvailability() {
        this.available = (0, fs_1.existsSync)(this.socketPath);
        if (this.available) {
            console.log(`[Embedding] Sandboxed embedding service available at ${this.socketPath}`);
            // Query dimensions from server on connect
            this.queryDimensionsFromServer().catch(() => {
                console.warn('[Embedding] Could not query dimensions from server');
            });
        }
        else {
            console.warn(`[Embedding] Sandboxed service not available, will use fallback`);
        }
    }
    /**
     * Query dimensions from the embedding server
     */
    async queryDimensionsFromServer() {
        if (!this.isAvailable())
            return;
        return new Promise((resolve) => {
            const socket = (0, net_1.createConnection)(this.socketPath);
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
                        console.log(`[Embedding] Dimensions: native=${cachedNativeDim}, target=${cachedTargetDim}`);
                    }
                    catch (err) {
                        console.warn('[Embedding] Failed to parse dimension response');
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
    isAvailable() {
        // Re-check each time in case container started/stopped
        this.available = (0, fs_1.existsSync)(this.socketPath);
        return this.available;
    }
    async getDimensions() {
        // Refresh from server if needed
        if (cachedTargetDim === null && this.isAvailable()) {
            await this.queryDimensionsFromServer();
        }
        // Return target dim if known, otherwise use fallback
        return cachedTargetDim ?? cachedNativeDim ?? 384;
    }
    getNativeDimensions() {
        return cachedNativeDim;
    }
    getTargetDimensions() {
        return cachedTargetDim;
    }
    async setTargetDimension(dim) {
        if (!this.isAvailable()) {
            cachedTargetDim = dim;
            return;
        }
        return new Promise((resolve, reject) => {
            const socket = (0, net_1.createConnection)(this.socketPath);
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
                            console.log(`[Embedding] Target dimension set to ${cachedTargetDim}`);
                            resolve();
                        }
                        else {
                            reject(new Error(response.error || 'Failed to set dimension'));
                        }
                    }
                    catch (err) {
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
    async generateEmbedding(text) {
        if (!this.isAvailable()) {
            return this.fallbackEmbedding(text);
        }
        return new Promise((resolve) => {
            const socket = (0, net_1.createConnection)(this.socketPath);
            let buffer = '';
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    console.warn('[Embedding] Timeout, using fallback');
                    resolve(this.fallbackEmbedding(text));
                }
            }, TIMEOUT_MS);
            socket.on('connect', () => {
                // Send embedding request
                const request = JSON.stringify({ type: 'embed', text }) + '\n';
                socket.write(request);
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                const newlineIndex = buffer.indexOf('\n');
                if (newlineIndex !== -1) {
                    clearTimeout(timeout);
                    if (resolved)
                        return;
                    resolved = true;
                    try {
                        const response = JSON.parse(buffer.slice(0, newlineIndex));
                        if (response.error) {
                            console.error(`[Embedding] Container error: ${response.error}`);
                            resolve(this.fallbackEmbedding(text));
                        }
                        else if (response.embedding) {
                            resolve(response.embedding);
                        }
                        else {
                            resolve(this.fallbackEmbedding(text));
                        }
                    }
                    catch (err) {
                        console.error(`[Embedding] Parse error:`, err);
                        resolve(this.fallbackEmbedding(text));
                    }
                    socket.end();
                }
            });
            socket.on('error', (err) => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    console.error(`[Embedding] Socket error: ${err.message}`);
                    resolve(this.fallbackEmbedding(text));
                }
            });
        });
    }
    /**
     * Fallback hash-based embedding when sandboxed service unavailable
     * Uses dynamic dimension from cache or defaults to 384
     */
    fallbackEmbedding(text) {
        // Use cached target dimension, or native dimension, or default 384
        const targetDim = cachedTargetDim ?? cachedNativeDim ?? 384;
        const normalizedText = text.toLowerCase().trim();
        const hash = this.hashString(normalizedText);
        const embedding = new Array(targetDim);
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
                embedding[i] = embedding[i] / magnitude;
            }
        }
        return embedding;
    }
    hashString(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) + hash) ^ char;
        }
        return Math.abs(hash);
    }
}
// Singleton instance
let clientInstance = null;
function getSandboxedEmbeddingClient() {
    if (!clientInstance) {
        clientInstance = new SandboxedEmbeddingClientImpl();
    }
    return clientInstance;
}
// Export dimension accessors (no hardcoded constants!)
function getNativeDimension() {
    return cachedNativeDim;
}
function getTargetDimension() {
    return cachedTargetDim;
}
function setTargetDimension(dim) {
    cachedTargetDim = dim;
}
