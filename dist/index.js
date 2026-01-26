#!/usr/bin/env node
/**
 * SpecMem - Speculative Memory MCP Server
 *
 * yo shoutout to doobidoo/mcp-memory-service for the inspo
 * we took their SQLite version and made it POSTGRESQL BEAST MODE
 * - hardwicksoftwareservices
 *
 * A high-performance memory management system with:
 * - Semantic search using pgvector (cosine similarity)
 * - Dream-inspired consolidation (DBSCAN clustering)
 * - Auto-splitting for unlimited content length
 * - Natural language time queries ("yesterday", "last week")
 * - Embedding caching (90% hit rate target)
 * - Image storage (base64 in BYTEA)
 * - Memory relationships (graph traversal)
 * - SKILLS SYSTEM - drag & drop .md files for instant capabilities
 * - CODEBASE INDEXING - knows your entire project
 *
 * Scale Requirements:
 * - Millions of lines of code
 * - Thousands of prompts
 * - Hundreds of images
 * - <100ms semantic search
 */
// ============================================================================
// STARTUP LOGGING - Debug MCP connection issues
// Write to same log file as bootstrap.cjs for unified timeline
// Uses project-isolated path: {PROJECT_DIR}/specmem/run/mcp-startup.log
// ============================================================================
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync, openSync } from 'fs';
import { access, constants } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
// ESM __dirname equivalent - replaces hardcoded paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// DEBUG LOGGING - only enabled when SPECMEM_DEBUG=1
const __debugLog = process.env['SPECMEM_DEBUG'] === '1'
    ? (...args) => console.error('[DEBUG]', ...args) // stderr, not stdout!
    : () => { };
// MULTI-PROJECT ISOLATION: SPECMEM_PROJECT_PATH is set at startup and NEVER changes
// REMOVED: Marker file - caused race condition with simultaneous projects!
function _getStartupProjectPath() {
    return process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
}
// Compute project identifiers early for log isolation
// NO MORE HASHES - use readable project directory name for EVERYTHING
const _projectPath = _getStartupProjectPath();
// Readable project directory name - used for containers, sockets, databases, etc.
const _projectDirName = process.env['SPECMEM_PROJECT_DIR_NAME'] ||
    path.basename(_projectPath)
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'default';
// DEPRECATED: _projectHash now equals _projectDirName for backwards compat
const _projectHash = _projectDirName;
// Use PROJECT DIRECTORY for all specmem data - NOT ~/.specmem, NOT /tmp
// User requirement: "EVERYTHING LOCALIZED WITHIN THE PROJECT"
// Pattern: {PROJECT_DIR}/specmem/
const _projectInstanceDir = path.join(_projectPath, 'specmem');
const _projectTmpDir = path.join(_projectInstanceDir, 'run');
// Ensure project instance directory exists
try {
    if (!existsSync(_projectTmpDir)) {
        mkdirSync(_projectTmpDir, { recursive: true, mode: 0o755 });
    }
}
catch {
    // Ignore - will be created on first write
}
const STARTUP_LOG_PATH = `${_projectTmpDir}/mcp-startup.log`;
function startupLog(msg, error) {
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    let logLine = `${timestamp} [PID:${pid}] [index.ts] ${msg}\n`;
    if (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const errStack = error instanceof Error ? error.stack : undefined;
        logLine += `${timestamp} [PID:${pid}] [index.ts] ERROR: ${errMsg}\n`;
        if (errStack) {
            logLine += `${timestamp} [PID:${pid}] [index.ts] STACK: ${errStack}\n`;
        }
    }
    try {
        appendFileSync(STARTUP_LOG_PATH, logLine);
    }
    catch {
        // Ignore write errors - logging should never break the app
    }
}
startupLog('index.ts ENTRY POINT - ES module loading');
import { SpecMemServer } from './mcp/specMemServer.js';
import { CachingEmbeddingProvider } from './mcp/toolRegistry.js';
import { EmbeddingServerManager, getEmbeddingServerManager } from './mcp/embeddingServerManager.js';
import { config, loadSkillsConfig, loadCodebaseConfig, getEmbeddingSocketPath, getRunDir, getProjectInfo, getProjectPath } from './config.js';
import { logger } from './utils/logger.js';
import { ensureProjectEnv, getSpawnEnv, getPythonPath } from './utils/projectEnv.js';
import { reportRetry, reportError } from './utils/progressReporter.js';
import { ensureSocketDirAtomicSync } from './utils/fileProcessingQueue.js';
import { initializeWatcher, shutdownWatcher, registerCleanupHandlers } from './mcp/watcherIntegration.js';
import { initializeSessionWatcher, shutdownSessionWatcher } from './claude-sessions/sessionIntegration.js';
// Skills & Codebase system imports
import { getSkillScanner, resetSkillScanner } from './skills/skillScanner.js';
import { getSkillResourceProvider } from './skills/skillsResource.js';
import { getCodebaseIndexer, resetCodebaseIndexer } from './codebase/codebaseIndexer.js';
import { getSkillReminder, resetSkillReminder } from './reminders/skillReminder.js';
import { getDatabase } from './database.js';
// yooo we need the big brain db layer for watchers and team features
import { initializeTheBigBrainDb } from './db/index.js';
// fs imports consolidated above (line 32)
import { join } from 'path';
import { createConnection } from 'net';
import { execSync, spawn } from 'child_process';
import { setTargetDimension } from './embeddings/projectionLayer.js';
import { getDimensionAdapter, initializeDimensionAdapter } from './services/DimensionAdapter.js';
import { getEmbeddingQueue } from './services/EmbeddingQueue.js';
import { qoms } from './utils/qoms.js';
// Coordination server import - now uses lazy initialization
import { configureLazyCoordinationServer, disableLazyCoordinationServer, executeLazyShutdownHandlers, getLazyCoordinationServerStatus, resetLazyCoordinationServer, } from './coordination/index.js';
// Startup validation - pre-flight checks to catch issues early
import { quickValidation, fullValidation, formatValidationErrors, EXIT_CODES, } from './startup/index.js';
// Startup indexing - auto-index codebase and extract sessions on MCP startup
import { runStartupIndexing } from './startup/startupIndexing.js';
//  Config Injector - auto-injects hooks and hot-patches running instances
import { injectConfig } from './init/claudeConfigInjector.js';
// Auto-config system - syncs config to ~/.specmem/config.json for hooks
import { syncConfigToUserFile } from './config/autoConfig.js';
// Auto-deploy hooks and commands to 's directories
import { deployTo } from './cli/deploy-to-claude.js';
// Centralized password management
import { getPassword, isUsingDefaultPassword } from './config/password.js';
// Unified embedding timeout configuration
import { getEmbeddingTimeout, getAllEmbeddingTimeouts, hasMasterTimeout } from './config/embeddingTimeouts.js';
// Port allocation for unique per-instance ports
import { allocatePorts, setAllocatedPorts } from './utils/portAllocator.js';
// Instance manager for per-project instance tracking
import { getInstanceManager, cleanupSameProjectInstances, migrateFromOldStructure, } from './utils/instanceManager.js';
// CLI Notifications - centralized notification system for  Code CLI
import { getDashboardUrl } from './mcp/cliNotifications.js';
/**
 * Display SpecMem LOADED banner in  Code CLI
 *
 * Uses the centralized CLINotifier system which:
 * 1. Writes a visual banner to stderr (appears in terminal)
 * 2. Can optionally send MCP logging message (appears in 's logs)
 *
 * The banner includes:
 * - "SpecMem Loaded" status message with emoji
 * - Dashboard URL with emoji indicator
 * - Hooks and commands deployment status
 * - Quick reference for available commands
 */
function displayLoadedBanner(deployResult, dashboardUrl) {
    // Use centralized notification system
    // Note: We can't use the full CLINotifier here because we don't have the MCP server instance
    // The MCP-level notifications are handled by specMemServer.ts announceToOnStartup()
    // This function focuses on the stderr banner display
    const c = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        yellow: '\x1b[33m',
        green: '\x1b[32m',
        cyan: '\x1b[36m',
        magenta: '\x1b[35m',
        dim: '\x1b[2m',
    };
    const hooksCount = deployResult.hooksDeployed.length;
    const commandsCount = deployResult.commandsDeployed.length;
    // Format status with proper padding for alignment
    const hooksStatus = hooksCount > 0
        ? `${c.green}${hooksCount} registered${c.reset}`
        : `${c.dim}already up-to-date${c.reset}`;
    const commandsStatus = commandsCount > 0
        ? `${c.green}${commandsCount} registered${c.reset}`
        : `${c.dim}already up-to-date${c.reset}`;
    // Dashboard URL with emoji - use appropriate host based on mode
    const dashboardDisplay = dashboardUrl
        ? `${c.magenta}${dashboardUrl}${c.reset}`
        : `${c.dim}disabled${c.reset}`;
    const banner = `
${c.yellow}+==================================================================+${c.reset}
${c.yellow}|${c.reset}  ${c.bright}${c.green}SpecMem Loaded${c.reset}                                                ${c.yellow}|${c.reset}
${c.yellow}+==================================================================+${c.reset}
${c.yellow}|${c.reset}  ${c.cyan}Hooks:${c.reset}     ${hooksStatus}                                     ${c.yellow}|${c.reset}
${c.yellow}|${c.reset}  ${c.cyan}Commands:${c.reset}  ${commandsStatus}                                     ${c.yellow}|${c.reset}
${c.yellow}|${c.reset}  ${c.cyan}Dashboard:${c.reset} ${dashboardDisplay}                       ${c.yellow}|${c.reset}
${c.yellow}+==================================================================+${c.reset}
${c.yellow}|${c.reset}  ${c.dim}Type /specmem for commands | /specmem-find to search memories${c.reset}   ${c.yellow}|${c.reset}
${c.yellow}+==================================================================+${c.reset}
`;
    // Write to stderr so it appears in  Code CLI terminal
    // (stdout is reserved for MCP JSON-RPC protocol)
    process.stderr.write(banner);
}
// Dashboard server import
import { getDashboardServer, resetDashboardServer } from './dashboard/index.js';
// Memory management import
import { getMemoryManager, resetMemoryManager } from './utils/memoryManager.js';
import { createEmbeddingOverflowHandler } from './db/embeddingOverflow.js';
// re-export for external use
export { SpecMemServer } from './mcp/specMemServer.js';
export { ToolRegistry, createToolRegistry, CachingEmbeddingProvider } from './mcp/toolRegistry.js';
export { MCPProtocolHandler, parseTimeExpression, splitContent } from './mcp/mcpProtocolHandler.js';
export { DatabaseManager, getDatabase, resetDatabase } from './database.js';
// export all the goofy tools
export { RememberThisShit, FindWhatISaid, WhatDidIMean, YeahNahDeleteThat, SmushMemoriesTogether, LinkTheVibes, ShowMeTheStats, FindCodePointers } from './tools/goofy/index.js';
// export the command system - doobidoo style slash commands
export { CommandHandler, createCommandHandler, MemoryCommands, CodebaseCommands, ContextCommands, PromptCommands, getCommandsResource, getCommandHelpResource } from './commands/index.js';
// export skills system
export { SkillScanner, getSkillScanner, resetSkillScanner } from './skills/skillScanner.js';
export { SkillResourceProvider, getSkillResourceProvider } from './skills/skillsResource.js';
// export codebase indexer
export { CodebaseIndexer, getCodebaseIndexer, resetCodebaseIndexer } from './codebase/codebaseIndexer.js';
// export skill reminder
export { SkillReminder, getSkillReminder, resetSkillReminder } from './reminders/skillReminder.js';
// export dashboard
export { DashboardWebServer, getDashboardServer, resetDashboardServer } from './dashboard/index.js';
// export memory manager with instance tracking
export { MemoryManager, LRUCache, getMemoryManager, resetMemoryManager, getInstanceRegistry } from './utils/memoryManager.js';
// export embedding overflow handler
export { EmbeddingOverflowHandler, createEmbeddingOverflowHandler } from './db/embeddingOverflow.js';
// export instance manager for per-project tracking
export { InstanceManager, getInstanceManager, resetInstanceManager, hasInstanceManager, listInstances, killInstance, killAllInstances, cleanupSameProjectInstances, hashProjectPath, migrateFromOldStructure, } from './utils/instanceManager.js';
// export startup validation for external use
export { runStartupValidation, quickValidation, fullValidation, formatValidationErrors, validateOrExit, EXIT_CODES, } from './startup/index.js';
/**
 * Local Embedding Provider with Sandboxed ML Support
 *
 * FULLY DYNAMIC - all dimensions come from database!
 *
 * Priority:
 * 1. Air-gapped sandbox (real ML embeddings) - if running
 * 2. Hash-based fallback (deterministic pseudo-embeddings)
 *
 * The sandboxed embedding service:
 * - Runs in Docker with --network none (air-gapped)
 * - Uses all-MiniLM-L6-v2 model (or any model - dimension auto-detected!)
 * - Communicates via Unix socket only
 * - Cannot phone home or access the internet
 *
 * Fallback hash-based embeddings:
 * - Deterministic (same text = same embedding)
 * - Normalized to unit vectors (for cosine similarity)
 * - Dimension fetched from database (pgvector table metadata)
 *
 * DATABASE IS THE SINGLE SOURCE OF TRUTH FOR DIMENSIONS!
 */
class LocalEmbeddingProvider {
    targetDimension = null; // Target dimension - fetched from DB dynamically!
    detectedDimension = null; // Auto-detected from Frankenstein
    sandboxSocketPath;
    sandboxAvailable = false;
    lastSandboxCheck = 0;
    sandboxCheckInterval = 5000; // Re-check every 5 seconds
    autoStartAttempted = false;
    // FIX: Version counter to prevent thundering herd restart attempts
    // Only first request to detect failure triggers restart
    sandboxFailureVersion = 0;
    restartInProgress = false;
    dimensionFetched = false;
    // CRITICAL: Container name must be PROJECT-ISOLATED to prevent multi-instance conflicts!
    // Without this, two  sessions on different projects fight over the same container
    // Uses readable dir name for easier debugging (matches start-sandbox.sh)
    static CONTAINER_NAME = `specmem-embedding-${_projectDirName}`;
    static IMAGE_NAME = 'specmem-embedding:latest';
    // Adaptive timeout tracking - timeout adjusts based on actual response times
    // CONFIGURABLE via environment variables to prevent AbortError timeouts
    responseTimes = []; // Rolling window of last N response times
    static RESPONSE_TIME_WINDOW = 20; // Track last 20 responses
    // WARM SOCKET - keeps ONE socket ready for fast embeddings
    // Unlike broken persistent socket, this has simple health checks and immediate fallback
    warmSocket = null;
    warmSocketReady = false;
    warmSocketPath = null;
    warmSocketLastUsed = 0;
    static WARM_SOCKET_IDLE_TIMEOUT_MS = 30000; // Close idle sockets after 30s
    static WARM_SOCKET_HEALTH_CHECK_MS = 5000; // Health check every 5s
    warmSocketHealthInterval = null;
    // FIX: Mutex lock to prevent warm socket race condition
    // Ensures only one request uses warm socket at a time
    warmSocketLock = Promise.resolve();
    // LEGACY - kept for backwards compat but not used by new warm socket approach
    persistentSocket = null;
    socketConnected = false;
    socketReconnecting = false;
    pendingRequests = new Map();
    // FIX Issue #1: Track active sockets to prevent FD leaks over 24h+ sessions
    // Each entry: { socket, createdAt, label }
    activeSockets = new Set();
    _socketCleanupInterval = null;
    // FIX Issue #6: Track pending request ages for stale cleanup
    _pendingCleanupInterval = null;
    // Timeout values - now centralized in config/embeddingTimeouts.ts
    // Set SPECMEM_EMBEDDING_TIMEOUT (in seconds) to control ALL timeouts at once
    // See config/embeddingTimeouts.ts for full documentation
    static MIN_TIMEOUT_MS = getEmbeddingTimeout('min');
    static MAX_TIMEOUT_MS = getEmbeddingTimeout('max');
    static INITIAL_TIMEOUT_MS = getEmbeddingTimeout('initial');
    static TIMEOUT_MULTIPLIER = 3; // timeout = avg + 3x stddev
    // Retry configuration for transient failures
    static SOCKET_MAX_RETRIES = parseInt(process.env['SPECMEM_EMBEDDING_MAX_RETRIES'] || '3', 10);
    static SOCKET_INITIAL_RETRY_DELAY_MS = 1000; // Start with 1 second delay
    static SOCKET_MAX_RETRY_DELAY_MS = 10000; // Cap at 10 seconds
    // PostgreSQL-backed embedding queue for overflow when socket is unavailable
    embeddingQueue;
    constructor(initialTargetDimension) {
        // If dimension provided, use it; otherwise will query DB on first use
        this.targetDimension = initialTargetDimension ?? null;
        this.dimensionFetched = initialTargetDimension !== undefined;
        // Initialize embedding queue for overflow handling when socket is unavailable
        this.embeddingQueue = getEmbeddingQueue(getDatabase().getPool());
        // Use centralized config for socket path
        this.sandboxSocketPath = getEmbeddingSocketPath();
        // Log timeout configuration for debugging using centralized config
        const timeoutConfig = getAllEmbeddingTimeouts();
        logger.info({
            socketPath: this.sandboxSocketPath,
            masterTimeout: hasMasterTimeout() ? `${timeoutConfig.master}ms` : 'not set',
            minTimeoutMs: LocalEmbeddingProvider.MIN_TIMEOUT_MS,
            maxTimeoutMs: LocalEmbeddingProvider.MAX_TIMEOUT_MS,
            initialTimeoutMs: LocalEmbeddingProvider.INITIAL_TIMEOUT_MS,
            maxRetries: LocalEmbeddingProvider.SOCKET_MAX_RETRIES,
            targetDimension: this.targetDimension,
            configSource: hasMasterTimeout() ? 'SPECMEM_EMBEDDING_TIMEOUT (master)' : 'individual env vars'
        }, 'LocalEmbeddingProvider: initialized with timeout configuration');
        // Sync check in constructor only - one time startup check is acceptable
        this.checkSandboxAvailabilitySync();
        // If sandbox not available, try to auto-start the container
        if (!this.sandboxAvailable && !this.autoStartAttempted) {
            this.tryAutoStartContainer();
        }
        // Initialize persistent socket connection
        this.initPersistentSocket();
        // FIX Issue #1: Start periodic socket FD cleanup
        this._startSocketCleanup();
        // FIX Issue #6: Start periodic stale pendingRequests cleanup
        this._startPendingRequestsCleanup();
    }
    /**
     * FIX Issue #1: Track a socket in the active set for FD leak prevention.
     * Every socket created via createConnection() MUST be registered here.
     */
    _trackSocket(socket, label) {
        const entry = { socket, createdAt: Date.now(), label };
        this.activeSockets.add(entry);
        // Auto-remove from tracking when socket is fully closed/destroyed
        const removeFromTracking = () => {
            this.activeSockets.delete(entry);
        };
        socket.once('close', removeFromTracking);
        // If socket is already destroyed, remove immediately
        if (socket.destroyed) {
            this.activeSockets.delete(entry);
        }
        return entry;
    }
    /**
     * FIX Issue #1: Periodic cleanup of leaked socket FDs.
     * Destroys sockets that have been open longer than SPECMEM_SOCKET_MAX_AGE_MS.
     * Runs every SPECMEM_SOCKET_CLEANUP_INTERVAL_MS (default 5min).
     */
    _startSocketCleanup() {
        if (this._socketCleanupInterval) {
            clearInterval(this._socketCleanupInterval);
        }
        const cleanupIntervalMs = parseInt(process.env['SPECMEM_SOCKET_CLEANUP_INTERVAL_MS'] || '300000', 10);
        const maxAgeMs = parseInt(process.env['SPECMEM_SOCKET_MAX_AGE_MS'] || '60000', 10);
        this._socketCleanupInterval = setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            for (const entry of this.activeSockets) {
                const age = now - entry.createdAt;
                if (age > maxAgeMs) {
                    try {
                        if (!entry.socket.destroyed) {
                            entry.socket.destroy();
                            cleaned++;
                            logger.debug({
                                label: entry.label,
                                ageMs: age,
                                maxAgeMs
                            }, 'LocalEmbeddingProvider: cleaned up stale socket (FD leak prevention)');
                        }
                    }
                    catch (e) {
                        // Ignore destroy errors during cleanup
                    }
                    this.activeSockets.delete(entry);
                }
            }
            if (cleaned > 0) {
                logger.info({
                    cleaned,
                    remaining: this.activeSockets.size,
                    maxAgeMs,
                    cleanupIntervalMs
                }, 'LocalEmbeddingProvider: periodic socket FD cleanup completed');
            }
        }, cleanupIntervalMs);
        // Don't let cleanup interval prevent process exit
        if (this._socketCleanupInterval.unref) {
            this._socketCleanupInterval.unref();
        }
        logger.debug({
            cleanupIntervalMs,
            maxAgeMs
        }, 'LocalEmbeddingProvider: socket FD cleanup started');
    }
    /**
     * FIX Issue #6: Periodic cleanup of stale pendingRequests entries.
     * Rejects and removes requests older than SPECMEM_PENDING_REQUEST_MAX_AGE_MS.
     * Runs every SPECMEM_PENDING_CLEANUP_INTERVAL_MS (default 60s).
     */
    _startPendingRequestsCleanup() {
        if (this._pendingCleanupInterval) {
            clearInterval(this._pendingCleanupInterval);
        }
        const cleanupIntervalMs = parseInt(process.env['SPECMEM_PENDING_CLEANUP_INTERVAL_MS'] || '60000', 10);
        const maxAgeMs = parseInt(process.env['SPECMEM_PENDING_REQUEST_MAX_AGE_MS'] || '120000', 10);
        this._pendingCleanupInterval = setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            for (const [requestId, pending] of this.pendingRequests) {
                const age = now - (pending.createdAt || 0);
                if (age > maxAgeMs) {
                    clearTimeout(pending.timeout);
                    this.pendingRequests.delete(requestId);
                    cleaned++;
                    try {
                        pending.reject(new Error(
                            `Stale pending request cleaned up after ${Math.round(age / 1000)}s ` +
                            `(max age: ${Math.round(maxAgeMs / 1000)}s). ` +
                            `Request ID: ${requestId}. ` +
                            `Increase SPECMEM_PENDING_REQUEST_MAX_AGE_MS if embeddings are legitimately slow.`
                        ));
                    }
                    catch (e) {
                        // Ignore rejection errors (promise may already be settled)
                    }
                }
            }
            if (cleaned > 0) {
                logger.warn({
                    cleaned,
                    remaining: this.pendingRequests.size,
                    maxAgeMs,
                    cleanupIntervalMs
                }, 'LocalEmbeddingProvider: cleaned up stale pending requests (memory leak prevention)');
            }
        }, cleanupIntervalMs);
        // Don't let cleanup interval prevent process exit
        if (this._pendingCleanupInterval.unref) {
            this._pendingCleanupInterval.unref();
        }
        logger.debug({
            cleanupIntervalMs,
            maxAgeMs
        }, 'LocalEmbeddingProvider: pending requests cleanup started');
    }
    /**
     * Initialize the persistent socket connection
     * This keeps the socket OPEN and reuses it for all embedding requests
     */
    initPersistentSocket() {
        const methodStart = Date.now();
        // CRITICAL: Re-detect socket path on EVERY reconnect attempt
        // The socket might not exist at MCP startup but appear later
        const freshSocketPath = getEmbeddingSocketPath();
        if (freshSocketPath !== this.sandboxSocketPath) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_PATH_CHANGED', {
                oldPath: this.sandboxSocketPath,
                newPath: freshSocketPath
            });
            // PATH CHANGED: Destroy old socket and reset state to force new connection
            if (this.persistentSocket) {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_DESTROYING_OLD', {
                    reason: 'path changed, need new socket'
                });
                try {
                    this.persistentSocket.destroy();
                }
                catch (e) {
                    // Ignore destroy errors
                }
                this.persistentSocket = null;
                this.socketConnected = false;
                this.socketReconnecting = false;
            }
            this.sandboxSocketPath = freshSocketPath;
        }
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_START', {
            alreadyHasPersistentSocket: !!this.persistentSocket,
            socketReconnecting: this.socketReconnecting,
            socketPath: this.sandboxSocketPath
        });
        // FORCE NEW CONNECTION: If socket exists but not connected, destroy and retry
        if (this.persistentSocket && !this.socketConnected) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_FORCE_RECONNECT', {
                reason: 'socket exists but not connected'
            });
            try {
                this.persistentSocket.destroy();
            }
            catch (e) {
                // Ignore
            }
            this.persistentSocket = null;
            this.socketReconnecting = false;
        }
        if (this.persistentSocket || this.socketReconnecting) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_SKIPPED', {
                reason: this.persistentSocket ? 'already has socket' : 'already reconnecting',
                elapsedMs: Date.now() - methodStart
            });
            return;
        }
        this.socketReconnecting = true;
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_CREATING_CONNECTION', {
            socketPath: this.sandboxSocketPath
        });
        logger.debug({ socketPath: this.sandboxSocketPath }, 'LocalEmbeddingProvider: initializing persistent socket');
        try {
            this.persistentSocket = createConnection(this.sandboxSocketPath);
            // FIX Issue #1: Track persistent socket for FD leak prevention
            this._trackSocket(this.persistentSocket, 'persistent');
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_CONNECTION_CREATED', {
                elapsedMs: Date.now() - methodStart
            });
            this.persistentSocket.on('connect', () => {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_ON_CONNECT', {
                    timeSinceInitMs: Date.now() - methodStart,
                    socketPath: this.sandboxSocketPath
                });
                this.socketConnected = true;
                this.socketReconnecting = false;
                logger.info('LocalEmbeddingProvider: persistent socket connected');
            });
            let buffer = '';
            this.persistentSocket.on('data', (data) => {
                const dataLength = data.length;
                buffer += data.toString();
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_ON_DATA', {
                    dataLength,
                    bufferLength: buffer.length,
                    hasNewline: buffer.includes('\n')
                });
                // IDLE-BASED TIMEOUT: Reset ALL pending timeouts on any data received
                // This means server is alive and working - keep waiting
                const timeoutMs = this.getAdaptiveTimeout();
                for (const [reqId, pending] of this.pendingRequests) {
                    clearTimeout(pending.timeout);
                    pending.timeout = setTimeout(() => {
                        if (this.pendingRequests.has(reqId)) {
                            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_IDLE_TIMEOUT', {
                                requestId: reqId,
                                timeoutMs
                            });
                            this.pendingRequests.delete(reqId);
                            pending.reject(new Error(`Embedding idle timeout after ${Math.round(timeoutMs / 1000)}s of no activity. ` +
                                `Socket: ${this.sandboxSocketPath}. ` +
                                `If model is slow, increase SPECMEM_EMBEDDING_TIMEOUT.`));
                        }
                    }, timeoutMs);
                }
                // Process all complete JSON messages in buffer
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const message = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    try {
                        const response = JSON.parse(message);
                        const requestId = response.requestId;
                        // Handle heartbeat/processing status - just reset timeout and continue
                        if (response.status === 'processing') {
                            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_HEARTBEAT', {
                                requestId,
                                textLength: response.text_length
                            });
                            continue; // Keep waiting for actual embedding
                        }
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_MESSAGE_PARSED', {
                            requestId,
                            hasEmbedding: !!response.embedding,
                            hasError: !!response.error,
                            pendingRequestsCount: this.pendingRequests.size
                        });
                        if (requestId && this.pendingRequests.has(requestId)) {
                            const pending = this.pendingRequests.get(requestId);
                            clearTimeout(pending.timeout);
                            this.pendingRequests.delete(requestId);
                            if (response.error) {
                                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_RESOLVING_ERROR', {
                                    requestId,
                                    error: response.error
                                });
                                pending.reject(new Error(response.error));
                            }
                            else if (response.embedding) {
                                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_RESOLVING_SUCCESS', {
                                    requestId,
                                    embeddingDim: response.embedding.length
                                });
                                pending.resolve(response.embedding);
                            }
                            else {
                                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_RESOLVING_INVALID', {
                                    requestId,
                                    responseKeys: Object.keys(response)
                                });
                                pending.reject(new Error('Invalid response from sandbox'));
                            }
                        }
                        else {
                            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_ORPHAN_RESPONSE', {
                                requestId,
                                pendingRequestIds: Array.from(this.pendingRequests.keys())
                            });
                        }
                    }
                    catch (err) {
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_PARSE_ERROR', {
                            error: err instanceof Error ? err.message : String(err),
                            messageLength: message.length,
                            messagePreview: message.substring(0, 100)
                        });
                        logger.debug({ err, message }, 'LocalEmbeddingProvider: failed to parse socket message');
                    }
                }
            });
            this.persistentSocket.on('error', (err) => {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_ON_ERROR', {
                    error: err.message,
                    code: err.code,
                    pendingRequestsCount: this.pendingRequests.size,
                    socketPath: this.sandboxSocketPath
                });
                logger.warn({ err }, 'LocalEmbeddingProvider: persistent socket error');
                this.socketConnected = false;
                this.persistentSocket = null;
                // Reject all pending requests
                for (const [requestId, pending] of this.pendingRequests) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_REJECTING_PENDING', {
                        requestId,
                        error: err.message
                    });
                    clearTimeout(pending.timeout);
                    pending.reject(new Error(`Socket error: ${err.message}`));
                }
                this.pendingRequests.clear();
                // Try to reconnect after delay
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_SCHEDULING_RECONNECT', {
                    delayMs: 1000
                });
                this.socketReconnecting = false;
                setTimeout(() => this.initPersistentSocket(), 1000);
            });
            this.persistentSocket.on('close', () => {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_ON_CLOSE', {
                    pendingRequestsCount: this.pendingRequests.size,
                    socketPath: this.sandboxSocketPath
                });
                logger.debug('LocalEmbeddingProvider: persistent socket closed');
                this.socketConnected = false;
                this.persistentSocket = null;
                this.socketReconnecting = false;
                // Reject all pending requests
                for (const [requestId, pending] of this.pendingRequests) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_CLOSE_REJECTING', {
                        requestId
                    });
                    clearTimeout(pending.timeout);
                    pending.reject(new Error('Socket closed'));
                }
                this.pendingRequests.clear();
            });
        }
        catch (err) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'INIT_PERSISTENT_SOCKET_CATCH_ERROR', {
                error: err instanceof Error ? err.message : String(err),
                elapsedMs: Date.now() - methodStart,
                socketPath: this.sandboxSocketPath
            });
            logger.debug({ err }, 'LocalEmbeddingProvider: failed to create persistent socket');
            this.socketReconnecting = false;
        }
    }
    /**
     * PUBLIC: Force reset the persistent socket connection
     * Call this after restarting the embedding server to pick up new socket
     */
    resetSocket() {
        logger.info('[LocalEmbeddingProvider] Resetting socket connection...');
        // CRITICAL: Close warm socket too - it caches connections that become stale after server restart
        this.closeWarmSocket();
        // Destroy existing socket if any
        if (this.persistentSocket) {
            try {
                this.persistentSocket.destroy();
            }
            catch (e) {
                // Ignore destroy errors
            }
            this.persistentSocket = null;
        }
        // Reset state
        this.socketConnected = false;
        this.socketReconnecting = false;
        // Clear pending requests
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Socket reset by user'));
        }
        this.pendingRequests.clear();
        // FIX Issue #1: Destroy all tracked active sockets on reset
        for (const entry of this.activeSockets) {
            try {
                if (!entry.socket.destroyed) {
                    entry.socket.destroy();
                }
            }
            catch (e) {
                // Ignore cleanup errors
            }
        }
        this.activeSockets.clear();
        // Re-detect socket path and reinitialize
        this.sandboxSocketPath = getEmbeddingSocketPath();
        this.initPersistentSocket();
        logger.info({ socketPath: this.sandboxSocketPath }, '[LocalEmbeddingProvider] Socket reset complete');
    }
    /**
     * Ensure persistent socket is connected, reconnect if needed
     *
     * CRITICAL: Previous 5-second timeout was TOO SHORT - caused fallback to
     * slow per-request socket creation (120s timeout, 3 retries = 360s+ total).
     * Now uses 30s default (configurable via SPECMEM_SOCKET_CONNECT_TIMEOUT_MS).
     *
     * FIX: Increased from 5000ms to 30000ms to give socket time to connect
     * instead of immediately falling back to the slow path.
     */
    async ensurePersistentSocket() {
        const methodStart = Date.now();
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'ENSURE_PERSISTENT_SOCKET_START', {
            socketConnected: this.socketConnected,
            hasPersistentSocket: !!this.persistentSocket,
            socketReconnecting: this.socketReconnecting,
            socketPath: this.sandboxSocketPath
        });
        if (this.socketConnected && this.persistentSocket) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'ENSURE_PERSISTENT_SOCKET_ALREADY_CONNECTED', {
                elapsedMs: Date.now() - methodStart
            });
            return true;
        }
        // AUTO-FIX STALE STATE: If socketReconnecting is stuck true but no socket exists,
        // reset the state and force a fresh connection attempt
        if (this.socketReconnecting && !this.persistentSocket) {
            const staleTime = 5000; // 5 seconds is too long to be "reconnecting" without a socket
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'ENSURE_PERSISTENT_SOCKET_STALE_STATE_DETECTED', {
                reason: 'socketReconnecting=true but no socket exists - forcing reset'
            });
            this.socketReconnecting = false;
            this.socketConnected = false;
        }
        if (!this.socketReconnecting) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'ENSURE_PERSISTENT_SOCKET_CALLING_INIT', {
                reason: 'not reconnecting, initiating socket'
            });
            this.initPersistentSocket();
        }
        else {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'ENSURE_PERSISTENT_SOCKET_ALREADY_RECONNECTING', {
                reason: 'socketReconnecting=true, skipping init'
            });
        }
        // Wait for connection with timeout - DYNAMIC via env var
        // Balance: not too short (causes fallback) but not too long (makes MCP unresponsive)
        // 10s is a good middle ground - enough for most connections, fast enough to fail gracefully
        const maxWait = parseInt(process.env['SPECMEM_SOCKET_CONNECT_TIMEOUT_MS'] || '10000', 10);
        const startTime = Date.now();
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'ENSURE_PERSISTENT_SOCKET_WAIT_LOOP_START', {
            maxWaitMs: maxWait,
            pollIntervalMs: 100
        });
        let pollCount = 0;
        while (Date.now() - startTime < maxWait) {
            pollCount++;
            if (this.socketConnected && this.persistentSocket) {
                const waitTimeMs = Date.now() - startTime;
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'ENSURE_PERSISTENT_SOCKET_CONNECTED_IN_LOOP', {
                    waitTimeMs,
                    pollCount,
                    totalMethodElapsedMs: Date.now() - methodStart
                });
                logger.debug({ waitTimeMs: Date.now() - startTime }, 'Persistent socket connected');
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'ENSURE_PERSISTENT_SOCKET_TIMEOUT', {
            maxWait,
            socketPath: this.sandboxSocketPath,
            pollCount,
            totalMethodElapsedMs: Date.now() - methodStart,
            finalSocketConnected: this.socketConnected,
            finalHasPersistentSocket: !!this.persistentSocket
        });
        logger.warn({ maxWait, socketPath: this.sandboxSocketPath }, 'Persistent socket connection timeout - falling back to per-request socket');
        return false;
    }
    /**
     * Fetch target dimension from database if not already known
     * Database is the single source of truth for dimensions!
     */
    async ensureTargetDimension() {
        if (this.targetDimension !== null) {
            return this.targetDimension;
        }
        // Query database for dimension
        try {
            const db = getDatabase();
            const result = await db.query(`
        SELECT atttypmod FROM pg_attribute
        WHERE attrelid = 'memories'::regclass AND attname = 'embedding'
      `);
            if (result.rows.length > 0) {
                this.targetDimension = result.rows[0].atttypmod;
                this.dimensionFetched = true;
                logger.info({ targetDimension: this.targetDimension }, 'LocalEmbeddingProvider: fetched target dimension from database');
                return this.targetDimension;
            }
        }
        catch (err) {
            logger.debug({ error: err }, 'LocalEmbeddingProvider: could not fetch dimension from DB (may not be initialized)');
        }
        // If DB query fails, detect from first embedding and use that
        // This handles the cold-start case where DB schema isn't ready yet
        logger.warn('LocalEmbeddingProvider: could not get dimension from DB, will use embedding dimension');
        return 0; // Signal to use embedding dimension as-is
    }
    /**
     * Auto-detect embedding dimension from Frankenstein
     * Called once on first use, cached thereafter
     */
    async getEmbeddingDimension() {
        if (this.detectedDimension) {
            return this.detectedDimension;
        }
        // Try to get a test embedding from Frankenstein
        if (await this.isSandboxAvailableAsync()) {
            try {
                const testEmbedding = await this.generateSandboxedEmbedding('test dimension detection');
                this.detectedDimension = testEmbedding.length;
                logger.info({ dimension: this.detectedDimension }, 'Auto-detected embedding dimension from Frankenstein');
                return this.detectedDimension;
            }
            catch (err) {
                logger.warn({ error: err }, 'Failed to detect dimension from Frankenstein, using target dimension');
            }
        }
        // Fallback to target dimension if detection fails
        this.detectedDimension = this.targetDimension;
        return this.detectedDimension;
    }
    /**
     * Try to auto-start the embedding Docker container
     * This runs asynchronously and updates sandboxAvailable when ready
     */
    tryAutoStartContainer() {
        this.autoStartAttempted = true;
        // Run auto-start in background to not block constructor
        this.autoStartContainer().catch(err => {
            logger.warn({ error: err }, 'failed to auto-start embedding container');
        });
    }
    /**
     * Fix permissions on all parent directories of a path
     * Ensures each parent has at least 755 (world-readable/executable)
     * This is critical for Docker to access the socket directory
     */
    fixParentDirectoryPermissions(targetPath) {
        const { chmodSync } = require('fs');
        const pathModule = require('path');
        // Get all parent directories from target up to root
        const parents = [];
        let current = pathModule.dirname(targetPath);
        // Collect all parents (stop at /tmp or / to avoid modifying system dirs)
        while (current && current !== '/' && current !== '/tmp' && !parents.includes(current)) {
            parents.push(current);
            current = pathModule.dirname(current);
        }
        // Fix permissions from root towards target (top-down)
        parents.reverse();
        for (const dir of parents) {
            try {
                if (existsSync(dir)) {
                    const stats = statSync(dir);
                    const currentMode = stats.mode & 0o777;
                    // Check if directory has at least 755 (rwxr-xr-x)
                    // This means: owner has rwx, group and others have rx
                    const minMode = 0o755;
                    if ((currentMode & minMode) !== minMode) {
                        // Add the missing permissions (don't remove existing ones)
                        const newMode = currentMode | minMode;
                        chmodSync(dir, newMode);
                        logger.info({
                            dir,
                            oldMode: currentMode.toString(8),
                            newMode: newMode.toString(8)
                        }, 'fixed parent directory permissions');
                    }
                }
            }
            catch (err) {
                // Log but don't fail - we may not have permission to modify some dirs
                logger.debug({ error: err, dir }, 'could not fix permissions on parent directory');
            }
        }
    }
    /**
     * Auto-start the embedding Docker container if not running
     *
     * CRITICAL: The SOCKET_PATH env var MUST be within the mounted volume!
     * Container mount: -v ${socketDir}:${socketDir}
     * Socket path: ${socketDir}/embeddings.sock
     *
     * If these don't match, the container will fail with EACCES trying to
     * create a socket in a non-existent directory.
     */
    async autoStartContainer() {
        // Step 1: Ensure socket directory exists (use centralized config)
        const socketDir = getRunDir();
        // CRITICAL: Fix permissions on ALL parent directories BEFORE creating socket dir
        // This ensures Docker can traverse the path to access the socket
        this.fixParentDirectoryPermissions(socketDir);
        // Task #17 FIX: Use atomic mkdir to prevent race condition when multiple
        // MCP servers try to create the socket directory simultaneously
        try {
            const created = ensureSocketDirAtomicSync(socketDir);
            if (created) {
                logger.info({ dir: socketDir }, 'created socket directory atomically');
            }
        }
        catch (err) {
            logger.error({ error: err, dir: socketDir }, 'failed to create socket directory');
            return;
        }
        // Ensure socket directory has 777 permissions for Docker access
        try {
            const { chmodSync } = require('fs');
            chmodSync(socketDir, 0o777);
            logger.info({ dir: socketDir, mode: '777' }, 'set socket directory permissions');
        }
        catch (err) {
            logger.warn({ error: err, dir: socketDir }, 'could not set socket directory to 777');
        }
        // CRITICAL FIX: Container socket path MUST be inside the mounted volume
        // NOT this.sandboxSocketPath which might point elsewhere
        const containerSocketPath = `${socketDir}/embeddings.sock`;
        // Step 1.5: Cleanup any stale socket files before starting container
        // A stale socket can prevent the container from binding properly
        await this.cleanupStaleSocket(containerSocketPath);
        // Step 2: ALWAYS prefer native Python over Docker
        // Docker containers crash-loop when native Python owns the socket
        // Native Python is faster, more reliable, and doesn't have permission issues
        const pythonAvailable = await this.isPythonEmbeddingAvailable();
        if (pythonAvailable) {
            logger.info('Native Python embedding available - using Python (preferred over Docker)');
            await this.autoStartPythonEmbedding();
            return;
        }
        // Step 2b: Check if Docker is available - only use Docker if Python isn't available
        if (!this.isDockerAvailable()) {
            logger.info('Docker not available - falling back to Python embedding server');
            await this.autoStartPythonEmbedding();
            return;
        }
        // Step 3: Check if container is already running
        if (this.isContainerRunning()) {
            logger.debug({ container: LocalEmbeddingProvider.CONTAINER_NAME }, 'embedding container already running');
            // Update socket path to match what the running container uses
            this.sandboxSocketPath = containerSocketPath;
            // Wait a bit for socket to appear if container just started
            await this.waitForSocket(10000);
            return;
        }
        // Step 4: Check if image exists
        if (!this.isImageAvailable()) {
            logger.warn({ image: LocalEmbeddingProvider.IMAGE_NAME }, 'embedding image not found - cannot auto-start');
            return;
        }
        // Step 5: Remove any stopped container with the same name
        this.removeStoppedContainer();
        // Step 6: Start the container with security flags
        logger.info({
            container: LocalEmbeddingProvider.CONTAINER_NAME,
            socketDir,
            containerSocketPath
        }, 'auto-starting embedding container...');
        try {
            execSync(`docker run -d ` +
                `--name ${LocalEmbeddingProvider.CONTAINER_NAME} ` +
                `--restart=on-failure:5 ` + // Auto-restart up to 5 times on crash/OOM
                `--network none ` +
                `--read-only ` +
                `--cap-drop ALL ` +
                `--security-opt no-new-privileges:true ` +
                `--memory=2g ` +
                `--cpus=2 ` +
                `-v ${socketDir}:${socketDir} ` +
                `-v specmem-model-cache:/app/models ` +
                `-e SOCKET_PATH=${containerSocketPath} ` + // MUST match the mounted volume!
                `-e TARGET_DIMENSION=384 ` + // Fixed dimension for air-gapped container
                `-e SKIP_DB_DIMENSION_QUERY=true ` + // Container is air-gapped, can't query DB
                `-l specmem.project=${_projectDirName} ` + // Label for cleanup
                `${LocalEmbeddingProvider.IMAGE_NAME}`, { stdio: 'pipe', timeout: parseInt(process.env['SPECMEM_DOCKER_EXEC_TIMEOUT_MS'] || '30000', 10) });
            // Update our socket path to match what we told the container
            this.sandboxSocketPath = containerSocketPath;
            logger.info({
                container: LocalEmbeddingProvider.CONTAINER_NAME,
                socketPath: containerSocketPath
            }, 'embedding container started');
            // Wait for socket to become available - configurable via SPECMEM_SOCKET_WAIT_TIMEOUT_MS
            const socketWaitTimeout = parseInt(process.env['SPECMEM_SOCKET_WAIT_TIMEOUT_MS'] || '30000', 10);
            await this.waitForSocket(socketWaitTimeout);
        }
        catch (err) {
            // Task #16 FIX: Proper error handling for Docker spawn failures
            // Extract detailed error info for debugging
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorCode = err?.code || 'UNKNOWN';
            const errorSignal = err?.signal;
            const errorStatus = err?.status;
            // Log detailed error with all available context
            logger.error({
                error: errorMessage,
                code: errorCode,
                signal: errorSignal,
                status: errorStatus,
                container: LocalEmbeddingProvider.CONTAINER_NAME,
                socketDir,
                containerSocketPath,
                image: LocalEmbeddingProvider.IMAGE_NAME
            }, 'Docker container spawn failed - falling back to Python embedding server');
            // Common failure modes with helpful messages:
            // - ETIMEDOUT: Docker command took too long (increase SPECMEM_DOCKER_EXEC_TIMEOUT_MS)
            // - exit code 125: Docker daemon error (permissions, daemon not running)
            // - exit code 126: Container command cannot be invoked
            // - exit code 127: Container command not found
            // - exit code 137: OOM killed (increase --memory limit)
            if (errorStatus === 125) {
                logger.warn('Docker daemon error - check if Docker is running and user has permissions');
            }
            else if (errorCode === 'ETIMEDOUT') {
                logger.warn({ timeout: process.env['SPECMEM_DOCKER_EXEC_TIMEOUT_MS'] || '30000' }, 'Docker command timed out - increase SPECMEM_DOCKER_EXEC_TIMEOUT_MS if needed');
            }
            else if (errorStatus === 137) {
                logger.warn('Container was OOM killed - may need more memory');
            }
            // CRITICAL: Fall back to Python embedding server instead of silent failure
            logger.info('Attempting Python embedding server fallback after Docker failure...');
            try {
                await this.autoStartPythonEmbedding();
            }
            catch (fallbackErr) {
                logger.error({
                    error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
                }, 'Python embedding fallback also failed - embedding service unavailable');
            }
        }
    }
    /**
     * Check if native Python embedding server can be started
     * Always prefer Python over Docker - it's faster and doesn't have permission issues
     */
    async isPythonEmbeddingAvailable() {
        try {
            // Check if frankenstein-embeddings.py exists in the expected location
            const projectPath = getProjectPath();
            const embeddingScript = join(projectPath, 'embedding-sandbox', 'frankenstein-embeddings.py');
            if (existsSync(embeddingScript)) {
                logger.debug({ embeddingScript }, 'Python embedding script found');
                return true;
            }
            // Also check relative to this file (for npm installed packages)
            const altScript = join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), 'embedding-sandbox', 'frankenstein-embeddings.py');
            if (existsSync(altScript)) {
                logger.debug({ altScript }, 'Python embedding script found (alt location)');
                return true;
            }
            return false;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if Docker daemon is available
     */
    isDockerAvailable() {
        try {
            execSync('docker info', { stdio: 'pipe', timeout: 5000 });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if the embedding container is currently running
     */
    isContainerRunning() {
        try {
            const result = execSync(`docker ps --filter "name=^${LocalEmbeddingProvider.CONTAINER_NAME}$" --format "{{.Names}}"`, { stdio: 'pipe', timeout: 5000 });
            return result.toString().trim() === LocalEmbeddingProvider.CONTAINER_NAME;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if the embedding image is available locally
     */
    isImageAvailable() {
        try {
            execSync(`docker image inspect ${LocalEmbeddingProvider.IMAGE_NAME}`, { stdio: 'pipe', timeout: 5000 });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Remove any stopped container with our name
     */
    removeStoppedContainer() {
        try {
            execSync(`docker rm ${LocalEmbeddingProvider.CONTAINER_NAME}`, { stdio: 'pipe', timeout: 5000 });
            logger.debug({ container: LocalEmbeddingProvider.CONTAINER_NAME }, 'removed stopped container');
        }
        catch {
            // Container doesn't exist, which is fine
        }
    }
    /**
     * Cleanup stale socket file on startup
     *
     * A stale socket can occur when:
     * - Container crashed without cleanup
     * - Host rebooted while container was running
     * - Manual docker kill without socket cleanup
     *
     * This tries to connect to the socket. If connection fails, the socket is stale
     * and should be removed before starting a new container.
     */
    async cleanupStaleSocket(socketPath) {
        if (!existsSync(socketPath)) {
            logger.debug({ socketPath }, 'LocalEmbeddingProvider: no socket file to cleanup');
            return;
        }
        logger.info({ socketPath }, 'LocalEmbeddingProvider: checking if socket is stale...');
        // Try to connect to the socket to see if it's alive
        return new Promise((resolve) => {
            const testSocket = createConnection(socketPath);
            const timeout = setTimeout(() => {
                testSocket.destroy();
                // Connection timed out - socket is stale
                this.removeStaleSocketFile(socketPath);
                resolve();
            }, 2000); // 2 second timeout for connection test
            testSocket.on('connect', () => {
                // Socket is alive - don't remove it
                clearTimeout(timeout);
                testSocket.destroy();
                logger.info({ socketPath }, 'LocalEmbeddingProvider: socket is alive, not removing');
                resolve();
            });
            testSocket.on('error', (err) => {
                // Connection failed - socket is stale
                clearTimeout(timeout);
                testSocket.destroy();
                logger.info({ socketPath, error: err.message }, 'LocalEmbeddingProvider: socket connection failed, removing stale socket');
                this.removeStaleSocketFile(socketPath);
                resolve();
            });
        });
    }
    /**
     * Remove a stale socket file from the filesystem
     */
    removeStaleSocketFile(socketPath) {
        try {
            unlinkSync(socketPath);
            logger.info({ socketPath }, 'LocalEmbeddingProvider: removed stale socket file');
        }
        catch (err) {
            logger.warn({ socketPath, error: err }, 'LocalEmbeddingProvider: failed to remove stale socket file');
        }
    }
    // Track Python embedding server process with overload protection
    pythonEmbeddingPid = null;
    pythonAutoStartAttempted = false;
    lastPythonStartAttempt = 0;
    pythonRestartCount = 0;
    pythonRestartWindowStart = 0;
    pythonConsecutiveFailures = 0;
    static PYTHON_RESTART_COOLDOWN_MS = 5000; // 5 seconds base cooldown
    static PYTHON_MAX_RESTARTS_PER_MINUTE = 4; // Max 4 restarts per minute
    static PYTHON_MAX_CONSECUTIVE_FAILURES = 3; // Give up after 3 consecutive failures
    static PYTHON_FAILURE_BACKOFF_MS = 60000; // 1 minute backoff after max failures
    /**
     * Auto-start the embedding server as a Python script (not Docker)
     *
     * CRITICAL: This enables transparent restart when embedding server dies!
     * User runs command → socket dead → auto-restart → command succeeds
     *
     * OVERLOAD PROTECTION:
     * - Max 4 restarts per minute
     * - After 3 consecutive failures, 1 minute backoff
     * - Exponential backoff on repeated failures
     *
     * Triggered when:
     * - Session starts and Docker not available
     * - Socket connection fails mid-session
     * - Server process gets OOM killed
     * - Server idle-shutdown and user needs embedding
     *
     * @returns true if started or already running, false if failed
     */
    async autoStartPythonEmbedding() {
        const now = Date.now();
        // OVERLOAD PROTECTION: Check consecutive failures
        if (this.pythonConsecutiveFailures >= LocalEmbeddingProvider.PYTHON_MAX_CONSECUTIVE_FAILURES) {
            const timeSinceLastAttempt = now - this.lastPythonStartAttempt;
            const backoffTime = LocalEmbeddingProvider.PYTHON_FAILURE_BACKOFF_MS *
                Math.pow(2, Math.min(this.pythonConsecutiveFailures - LocalEmbeddingProvider.PYTHON_MAX_CONSECUTIVE_FAILURES, 3));
            if (timeSinceLastAttempt < backoffTime) {
                const waitTime = Math.round((backoffTime - timeSinceLastAttempt) / 1000);
                logger.warn({
                    consecutiveFailures: this.pythonConsecutiveFailures,
                    backoffSeconds: Math.round(backoffTime / 1000),
                    waitSeconds: waitTime
                }, `Embedding server restart in backoff mode (${this.pythonConsecutiveFailures} failures). ` +
                    `Wait ${waitTime}s or check logs at {PROJECT}/specmem/sockets/embedding-autostart.log`);
                return false;
            }
            // Backoff expired, reset failure count and try again
            logger.info('Backoff expired, retrying embedding server...');
            this.pythonConsecutiveFailures = 0;
        }
        // RATE LIMIT: Check restarts per minute
        if (now - this.pythonRestartWindowStart > 60000) {
            // Reset window
            this.pythonRestartWindowStart = now;
            this.pythonRestartCount = 0;
        }
        if (this.pythonRestartCount >= LocalEmbeddingProvider.PYTHON_MAX_RESTARTS_PER_MINUTE) {
            logger.warn({
                restartCount: this.pythonRestartCount,
                maxPerMinute: LocalEmbeddingProvider.PYTHON_MAX_RESTARTS_PER_MINUTE
            }, 'Embedding server restart rate limit hit. Will retry in ~1 minute.');
            return false;
        }
        // COOLDOWN: Short delay between attempts
        if (now - this.lastPythonStartAttempt < LocalEmbeddingProvider.PYTHON_RESTART_COOLDOWN_MS) {
            const waitMs = LocalEmbeddingProvider.PYTHON_RESTART_COOLDOWN_MS - (now - this.lastPythonStartAttempt);
            await new Promise(r => setTimeout(r, waitMs));
        }
        this.lastPythonStartAttempt = Date.now();
        this.pythonRestartCount++;
        // Get project path
        const projectPath = getProjectPath();
        const socketDir = join(projectPath, 'specmem', 'sockets');
        const socketPath = join(socketDir, 'embeddings.sock');
        const lockPath = join(socketDir, 'embedding.lock');
        // Ensure socket directory exists
        // Task #17 FIX: Use atomic mkdir to prevent race condition when multiple
        // MCP servers try to create the socket directory simultaneously
        try {
            ensureSocketDirAtomicSync(socketDir);
        }
        catch (err) {
            logger.warn({ error: err, socketDir }, 'Failed to create socket directory for Python embedding');
        }
        // Check if socket exists and is responsive
        if (existsSync(socketPath)) {
            try {
                const isAlive = await this.testSocketConnection(socketPath);
                if (isAlive) {
                    logger.debug('Python embedding server already running');
                    this.sandboxAvailable = true;
                    this.sandboxSocketPath = socketPath;
                    return true;
                }
                // Socket exists but not responsive - clean it up
                await this.cleanupStaleSocket(socketPath);
            }
            catch (e) {
                logger.debug({ error: e }, 'Socket test failed, will restart');
            }
        }
        // ═══════════════════════════════════════════════════════════════════════════
        // LOCK FILE: Prevent race condition when multiple MCP instances start
        // ═══════════════════════════════════════════════════════════════════════════
        const acquireLock = () => {
            try {
                // Check if lock exists
                if (existsSync(lockPath)) {
                    const lockContent = readFileSync(lockPath, 'utf8').trim();
                    const [lockPid, lockTime] = lockContent.split(':').map(Number);
                    // Check if lock is stale (PID not running or lock too old - 5 min max)
                    const lockAge = Date.now() - lockTime;
                    const isStale = lockAge > 300000; // 5 minutes
                    let pidRunning = false;
                    try {
                        process.kill(lockPid, 0); // Signal 0 = check if process exists
                        pidRunning = true;
                    }
                    catch {
                        pidRunning = false;
                    }
                    if (!pidRunning || isStale) {
                        // Lock is stale - remove it
                        logger.info({ lockPid, lockAge, pidRunning, isStale }, 'Removing stale embedding lock');
                        unlinkSync(lockPath);
                    }
                    else {
                        // Lock is valid - another process is spawning
                        logger.debug({ lockPid, lockAge }, 'Embedding lock held by another process');
                        return { acquired: false, existingPid: lockPid };
                    }
                }
                // Try to acquire lock atomically
                writeFileSync(lockPath, `${process.pid}:${Date.now()}`, { flag: 'wx' });
                logger.debug({ pid: process.pid }, 'Acquired embedding lock');
                return { acquired: true };
            }
            catch (e) {
                // Lock file creation failed (likely another process beat us)
                if (e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST') {
                    logger.debug('Embedding lock already exists (race)');
                    return { acquired: false };
                }
                logger.warn({ error: e }, 'Failed to acquire embedding lock');
                return { acquired: false };
            }
        };
        const releaseLock = () => {
            try {
                if (existsSync(lockPath)) {
                    const lockContent = readFileSync(lockPath, 'utf8').trim();
                    const [lockPid] = lockContent.split(':').map(Number);
                    // Only release if we own it
                    if (lockPid === process.pid) {
                        unlinkSync(lockPath);
                        logger.debug({ pid: process.pid }, 'Released embedding lock');
                    }
                }
            }
            catch { /* ignore release errors */ }
        };
        // Try to acquire lock
        const lockResult = acquireLock();
        if (!lockResult.acquired) {
            // Another process is spawning - wait for socket to appear
            logger.info({ existingPid: lockResult.existingPid }, 'Another process spawning embedding, waiting...');
            this.sandboxSocketPath = socketPath;
            await this.waitForSocket(20000); // Wait up to 20s for other process
            if (this.sandboxAvailable) {
                return true;
            }
            // Still not available - try again next time
            return false;
        }
        // We have the lock - verify socket one more time (other process may have finished)
        if (existsSync(socketPath)) {
            try {
                const isAlive = await this.testSocketConnection(socketPath);
                if (isAlive) {
                    logger.debug('Socket became available while acquiring lock');
                    this.sandboxAvailable = true;
                    this.sandboxSocketPath = socketPath;
                    releaseLock();
                    return true;
                }
            }
            catch { /* proceed to spawn */ }
        }
        // ═══════════════════════════════════════════════════════════════════════════
        // ORPHAN KILL: Kill any existing Frankenstein process BEFORE spawning new one
        // This prevents multiple processes fighting over the same socket
        // ═══════════════════════════════════════════════════════════════════════════
        const pidFile = join(socketDir, 'embedding.pid');
        try {
            if (existsSync(pidFile)) {
                const pidContent = readFileSync(pidFile, 'utf8').trim();
                const oldPid = parseInt(pidContent.split(':')[0], 10);
                if (oldPid && !isNaN(oldPid)) {
                    try {
                        process.kill(oldPid, 0); // Check if alive
                        logger.info({ pid: oldPid }, '[LocalEmbeddingProvider] Killing existing embedding process before respawn');
                        process.kill(oldPid, 'SIGTERM');
                        // Give it 2s to die gracefully
                        const killWaitMs = parseInt(process.env['SPECMEM_ORPHAN_KILL_WAIT_MS'] || '2000', 10);
                        await new Promise(r => setTimeout(r, killWaitMs));
                        try {
                            process.kill(oldPid, 0); // Still alive?
                            process.kill(oldPid, 'SIGKILL');
                            logger.warn({ pid: oldPid }, '[LocalEmbeddingProvider] Force killed stubborn embedding process');
                        } catch { /* dead - good */ }
                    } catch { /* not running - fine */ }
                }
            }
        } catch (pidErr) {
            logger.debug({ error: pidErr }, '[LocalEmbeddingProvider] PID file cleanup failed (non-fatal)');
        }
        // Also remove stale socket file to prevent bind failures
        if (existsSync(socketPath)) {
            try {
                unlinkSync(socketPath);
                logger.debug('[LocalEmbeddingProvider] Removed stale socket before respawn');
            } catch { /* ignore */ }
        }
        // Find the embedding server script
        // Try multiple locations: SPECMEM_PKG env, relative to this file, project specmem dir
        // Docker location via env var (defaults to /opt/specmem if SPECMEM_DOCKER_PATH set)
        const dockerPath = process.env.SPECMEM_DOCKER_PATH || (process.env.SPECMEM_IN_DOCKER ? '/opt/specmem' : null);
        const candidatePaths = [
            process.env.SPECMEM_PKG ? join(process.env.SPECMEM_PKG, 'embedding-sandbox', 'frankenstein-embeddings.py') : null,
            join(__dirname, '..', 'embedding-sandbox', 'frankenstein-embeddings.py'),
            join(projectPath, 'specmem', 'embedding-sandbox', 'frankenstein-embeddings.py'),
            dockerPath ? join(dockerPath, 'embedding-sandbox', 'frankenstein-embeddings.py') : null,
            // Global npm install fallback (platform-agnostic)
            join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules', 'specmem-hardwicksoftware', 'embedding-sandbox', 'frankenstein-embeddings.py'),
        ].filter(Boolean);
        let embeddingScript = null;
        for (const candidate of candidatePaths) {
            if (existsSync(candidate)) {
                embeddingScript = candidate;
                break;
            }
        }
        if (!embeddingScript) {
            logger.warn({ candidatePaths }, 'Embedding server script not found - cannot auto-start');
            return false;
        }
        // Start the embedding server in background
        try {
            const logFile = join(socketDir, 'embedding-autostart.log');
            logger.info({
                script: embeddingScript,
                projectPath,
                socketPath,
                logFile
            }, 'Auto-starting Python embedding server...');
            // bruh ALWAYS use getSpawnEnv for project isolation
            // Task #22 fix: Use getPythonPath() instead of hardcoded 'python3'
            const pythonPath = getPythonPath();
            logger.debug({ pythonPath }, 'Using Python executable for embedding server');
            const child = spawn(pythonPath, [embeddingScript], {
                cwd: path.dirname(embeddingScript),
                env: getSpawnEnv(), // includes SPECMEM_PROJECT_PATH and all other project env vars
                detached: true,
                stdio: ['ignore', openSync(logFile, 'a'), openSync(logFile, 'a')]
            });
            child.unref();
            this.pythonEmbeddingPid = child.pid || null;
            // CRITICAL: Persist PID to file for orphan cleanup on next startup
            // Without this, orphaned embedding processes accumulate forever!
            if (this.pythonEmbeddingPid) {
                const pidFile = join(socketDir, 'embedding.pid');
                try {
                    writeFileSync(pidFile, `${this.pythonEmbeddingPid}:${Date.now()}`);
                    logger.debug({ pidFile, pid: this.pythonEmbeddingPid }, 'Embedding PID file written');
                }
                catch (pidErr) {
                    logger.warn({ pidErr, pidFile }, 'Failed to write embedding PID file (orphan cleanup may fail)');
                }
            }
            logger.info({
                pid: this.pythonEmbeddingPid,
                socketPath
            }, 'Python embedding server spawned');
            // Wait for socket to appear
            this.sandboxSocketPath = socketPath;
            await this.waitForSocket(15000); // 15 second timeout for Python startup
            if (this.sandboxAvailable) {
                logger.info({ socketPath, restartCount: this.pythonRestartCount }, 'Python embedding server ready');
                this.pythonConsecutiveFailures = 0; // SUCCESS: reset failure counter
                releaseLock(); // Release lock on success
                return true;
            }
            else {
                logger.warn({ socketPath }, 'Python embedding server started but socket not ready');
                this.pythonConsecutiveFailures++; // FAILURE: increment counter
                releaseLock(); // Release lock on failure
                return false;
            }
        }
        catch (err) {
            logger.error({ error: err, script: embeddingScript }, 'Failed to spawn Python embedding server');
            this.pythonConsecutiveFailures++; // FAILURE: increment counter
            releaseLock(); // Release lock on error
            return false;
        }
    }
    /**
     * Test if a socket is responsive
     * @returns true if socket responds to a test request
     */
    testSocketConnection(socketPath) {
        return new Promise((resolve) => {
            const testSocket = createConnection(socketPath);
            const timeout = setTimeout(() => {
                testSocket.destroy();
                resolve(false);
            }, 2000);
            testSocket.on('connect', () => {
                clearTimeout(timeout);
                // Try sending a minimal request
                testSocket.write('{"text":"test"}\n');
            });
            testSocket.on('data', (data) => {
                clearTimeout(timeout);
                testSocket.destroy();
                // Check if we got a valid embedding response
                const response = data.toString();
                resolve(response.includes('embedding') || response.includes('['));
            });
            testSocket.on('error', () => {
                clearTimeout(timeout);
                testSocket.destroy();
                resolve(false);
            });
            testSocket.on('timeout', () => {
                clearTimeout(timeout);
                testSocket.destroy();
                resolve(false);
            });
        });
    }
    /**
     * Wait for the socket to become available
     */
    async waitForSocket(timeoutMs) {
        const startTime = Date.now();
        const checkInterval = 500;
        while (Date.now() - startTime < timeoutMs) {
            if (existsSync(this.sandboxSocketPath)) {
                this.sandboxAvailable = true;
                this.lastSandboxCheck = Date.now();
                logger.info({ socketPath: this.sandboxSocketPath }, 'embedding socket now available');
                return;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        logger.warn({ socketPath: this.sandboxSocketPath, timeoutMs }, 'timeout waiting for embedding socket');
    }
    // Track restart attempts to avoid infinite restart loops
    restartAttempts = 0;
    lastRestartAttempt = 0;
    static MAX_RESTART_ATTEMPTS = 3;
    static RESTART_COOLDOWN_MS = 60000; // 1 minute between restart attempts
    /**
     * Try to restart the embedding container when it becomes unhealthy
     * Runs in background to not block embedding requests
     */
    tryRestartContainer() {
        const now = Date.now();
        // Check cooldown
        if (now - this.lastRestartAttempt < LocalEmbeddingProvider.RESTART_COOLDOWN_MS) {
            logger.debug('restart cooldown active, skipping');
            return;
        }
        // Check max attempts
        if (this.restartAttempts >= LocalEmbeddingProvider.MAX_RESTART_ATTEMPTS) {
            logger.warn({ attempts: this.restartAttempts }, 'max restart attempts reached - giving up');
            return;
        }
        this.lastRestartAttempt = now;
        this.restartAttempts++;
        // Run restart in background
        this.restartContainer().catch(err => {
            logger.error({ error: err }, 'failed to restart embedding container');
        });
    }
    /**
     * Restart the embedding Docker container
     * Task #16 FIX: Added proper error handling with detailed diagnostics and Python fallback
     */
    async restartContainer() {
        logger.info({ attempt: this.restartAttempts }, 'attempting to restart embedding container');
        // Check if Docker is available - fall back to Python if not
        if (!this.isDockerAvailable()) {
            logger.warn('Docker not available - falling back to Python embedding server');
            try {
                await this.autoStartPythonEmbedding();
            }
            catch (fallbackErr) {
                logger.error({
                    error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
                }, 'Python embedding fallback failed after Docker unavailable');
            }
            return;
        }
        try {
            // First try to just restart the existing container
            // Docker command timeout - configurable via SPECMEM_DOCKER_EXEC_TIMEOUT_MS
            const dockerTimeout = parseInt(process.env['SPECMEM_DOCKER_EXEC_TIMEOUT_MS'] || '30000', 10);
            if (this.isContainerRunning()) {
                logger.info('restarting running container');
                execSync(`docker restart ${LocalEmbeddingProvider.CONTAINER_NAME}`, {
                    stdio: 'pipe',
                    timeout: dockerTimeout
                });
            }
            else {
                // Container stopped - start it
                logger.info('starting stopped container');
                execSync(`docker start ${LocalEmbeddingProvider.CONTAINER_NAME}`, {
                    stdio: 'pipe',
                    timeout: dockerTimeout
                });
            }
            // Wait for socket to become available - configurable via SPECMEM_SOCKET_WAIT_TIMEOUT_MS
            const socketWaitTimeout = parseInt(process.env['SPECMEM_SOCKET_WAIT_TIMEOUT_MS'] || '15000', 10);
            await this.waitForSocket(socketWaitTimeout);
            if (this.sandboxAvailable) {
                logger.info('embedding container successfully restarted');
                // Reset restart attempts on success
                this.restartAttempts = 0;
            }
        }
        catch (err) {
            // Task #16 FIX: Extract detailed error info for debugging
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorCode = err?.code || 'UNKNOWN';
            const errorSignal = err?.signal;
            const errorStatus = err?.status;
            logger.error({
                error: errorMessage,
                code: errorCode,
                signal: errorSignal,
                status: errorStatus,
                container: LocalEmbeddingProvider.CONTAINER_NAME,
                attempt: this.restartAttempts
            }, 'Docker restart command failed');
            // If restart failed, try full recreation
            try {
                logger.info('attempting full container recreation');
                this.removeStoppedContainer();
                await this.autoStartContainer();
            }
            catch (recreateErr) {
                const recreateMsg = recreateErr instanceof Error ? recreateErr.message : String(recreateErr);
                logger.error({ error: recreateMsg }, 'full container recreation also failed - trying Python fallback');
                // CRITICAL: Fall back to Python as last resort
                try {
                    await this.autoStartPythonEmbedding();
                }
                catch (pythonErr) {
                    logger.error({
                        error: pythonErr instanceof Error ? pythonErr.message : String(pythonErr)
                    }, 'All embedding service options exhausted - service unavailable');
                }
            }
        }
    }
    // Sync version - ONLY for constructor initial check (one-time)
    checkSandboxAvailabilitySync() {
        this.sandboxAvailable = existsSync(this.sandboxSocketPath);
        if (this.sandboxAvailable) {
            logger.info({ socketPath: this.sandboxSocketPath }, 'sandboxed embedding service available - using real ML embeddings');
        }
        else {
            logger.debug({ socketPath: this.sandboxSocketPath }, 'sandbox not available - using hash fallback');
        }
        this.lastSandboxCheck = Date.now();
    }
    // Async version - use this for all runtime checks (non-blocking)
    // SELF-HEALING: If socket missing, attempt warm start immediately
    async checkSandboxAvailabilityAsync() {
        try {
            await access(this.sandboxSocketPath, constants.F_OK);
            // Socket file exists - assume it's available (model may be lazy-loading)
            this.sandboxAvailable = true;
        }
        catch {
            // Socket missing - MAKE IT!
            logger.info({ socketPath: this.sandboxSocketPath }, '[SELF-HEAL] Socket missing - starting embedding server');
            this.sandboxAvailable = false;
            // Try to start embedding server
            const started = await this.autoStartPythonEmbedding();
            if (started) {
                this.sandboxAvailable = true;
                logger.info({ socketPath: this.sandboxSocketPath }, '[SELF-HEAL] Embedding server started successfully');
            }
        }
        if (this.sandboxAvailable) {
            logger.debug({ socketPath: this.sandboxSocketPath }, 'sandboxed embedding service available - using real ML embeddings');
        }
        else {
            logger.warn({ socketPath: this.sandboxSocketPath }, 'sandbox not available after self-heal attempt');
        }
        this.lastSandboxCheck = Date.now();
    }
    // Async availability check - use this at runtime (non-blocking)
    async isSandboxAvailableAsync() {
        if (Date.now() - this.lastSandboxCheck > this.sandboxCheckInterval) {
            await this.checkSandboxAvailabilityAsync();
        }
        return this.sandboxAvailable;
    }
    async generateEmbedding(text) {
        const methodStart = Date.now();
        const textPreview = text.length > 50 ? text.substring(0, 50) + '...' : text;
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_START', {
            textLength: text.length,
            textPreview,
            sandboxAvailable: this.sandboxAvailable,
            socketConnected: this.socketConnected
        });
        // Use QOMS to ensure we never exceed 20% CPU/RAM
        return qoms.medium(async () => {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_QOMS_ACQUIRED', {
                elapsedMs: Date.now() - methodStart
            });
            // Ensure we have a target dimension from database
            const dimStart = Date.now();
            const targetDim = await this.ensureTargetDimension();
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_TARGET_DIM_FETCHED', {
                targetDim,
                dimFetchMs: Date.now() - dimStart,
                totalElapsedMs: Date.now() - methodStart
            });
            // CRITICAL: ML model MUST be available - no fallback to hash embeddings!
            // Hash embeddings are in a completely different vector space and break semantic search.
            // SELF-HEALING: checkSandboxAvailabilityAsync now auto-starts server if socket missing/dead
            const MAX_RETRIES = 5;
            const RETRY_DELAY_MS = 1000; // Faster retries since self-healing is aggressive
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_ATTEMPT_START', {
                    attempt,
                    maxRetries: MAX_RETRIES,
                    totalElapsedMs: Date.now() - methodStart
                });
                // SELF-HEAL: This now auto-starts server if socket missing or dead!
                if (!(await this.isSandboxAvailableAsync())) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_SANDBOX_UNAVAILABLE', {
                        attempt,
                        socketPath: this.sandboxSocketPath,
                        totalElapsedMs: Date.now() - methodStart
                    });
                    logger.warn({ attempt, maxRetries: MAX_RETRIES, socketPath: this.sandboxSocketPath }, '[SELF-HEAL] Embedding service unavailable - auto-healing in progress');
                    // Report retry progress
                    reportRetry('embedding', attempt, MAX_RETRIES);
                    // SELF-HEAL: Try multiple restart strategies
                    if (attempt === 1) {
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_RESTART_CONTAINER', {
                            attempt
                        });
                        this.tryRestartContainer();
                    } else if (attempt === 2) {
                        // Second attempt: try Python directly (in case Docker is the problem)
                        logger.info('[SELF-HEAL] Attempt 2: Trying direct Python startup');
                        await this.autoStartPythonEmbedding();
                    }
                    // Wait before retry - faster since self-healing is aggressive
                    const waitMs = RETRY_DELAY_MS * attempt;
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_WAITING_FOR_SANDBOX', {
                        waitMs,
                        attempt
                    });
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    await this.checkSandboxAvailabilityAsync();
                    continue;
                }
                try {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_CALLING_SANDBOXED', {
                        attempt,
                        totalElapsedMs: Date.now() - methodStart
                    });
                    const sandboxStart = Date.now();
                    const embedding = await this.generateSandboxedEmbedding(text);
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_SANDBOXED_COMPLETE', {
                        attempt,
                        embeddingDim: embedding.length,
                        sandboxedMs: Date.now() - sandboxStart,
                        totalElapsedMs: Date.now() - methodStart
                    });
                    // Auto-detect model dimension on first call
                    if (!this.detectedDimension) {
                        this.detectedDimension = embedding.length;
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_DIMENSION_DETECTED', {
                            detectedDimension: this.detectedDimension,
                            targetDim
                        });
                        logger.info({ modelDim: this.detectedDimension, dbDim: targetDim }, 'Auto-detected embedding dimension from AI model');
                    }
                    // DYNAMIC SCALING - match DB dimension, whatever it is!
                    // If targetDim is 0 (DB not ready), return embedding as-is
                    if (targetDim > 0 && embedding.length !== targetDim) {
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_SCALING', {
                            from: embedding.length,
                            to: targetDim
                        });
                        const scaled = this.scaleEmbedding(embedding, targetDim);
                        logger.debug({ from: embedding.length, to: targetDim }, 'Scaled embedding to match DB');
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_SUCCESS', {
                            finalDim: scaled.length,
                            scaled: true,
                            totalElapsedMs: Date.now() - methodStart
                        });
                        return scaled;
                    }
                    // Return as-is if dimensions already match or DB not ready
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_SUCCESS', {
                        finalDim: embedding.length,
                        scaled: false,
                        totalElapsedMs: Date.now() - methodStart
                    });
                    return embedding;
                }
                catch (error) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_SANDBOXED_ERROR', {
                        attempt,
                        error: error instanceof Error ? error.message : String(error),
                        totalElapsedMs: Date.now() - methodStart
                    });
                    logger.warn({ error, attempt }, 'sandbox embedding failed - will retry');
                    // FIX: Use version tracking to prevent thundering herd restarts
                    // Only first request to detect failure triggers restart
                    const failureVersion = ++this.sandboxFailureVersion;
                    this.sandboxAvailable = false;
                    // Report retry progress
                    reportRetry('embedding', attempt, MAX_RETRIES);
                    if (attempt < MAX_RETRIES) {
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_RETRY_WAIT', {
                            attempt,
                            nextAttempt: attempt + 1,
                            waitMs: RETRY_DELAY_MS * attempt,
                            failureVersion
                        });
                        // Only restart if we're the first to detect failure (no other restart in progress)
                        if (!this.restartInProgress && failureVersion === this.sandboxFailureVersion) {
                            this.restartInProgress = true;
                            this.tryRestartContainer();
                            this.restartInProgress = false;
                        }
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
                    }
                }
            }
            // All retries exhausted - FAIL LOUDLY instead of silent hash fallback
            // Hash embeddings are in different vector space and poison the search index!
            const errorMsg = `ML embedding service unavailable after ${MAX_RETRIES} attempts. ` +
                `Socket: ${this.sandboxSocketPath}. ` +
                `REFUSING to use hash fallback - would corrupt semantic search. ` +
                `Start the Frankenstein embedding service!`;
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDING_ALL_RETRIES_EXHAUSTED', {
                maxRetries: MAX_RETRIES,
                socketPath: this.sandboxSocketPath,
                totalElapsedMs: Date.now() - methodStart
            });
            logger.error({ socketPath: this.sandboxSocketPath }, errorMsg);
            reportError('embedding', 'ML embedding service unavailable');
            throw new Error(errorMsg);
        });
    }
    /**
     * BATCH EMBEDDING - generates multiple embeddings in a single socket request!
     * Uses the Python server's batch protocol: {"texts": [...]} -> {"embeddings": [[...], ...]}
     * This is 5-10x faster than individual calls for large batches.
     */
    async generateEmbeddingsBatch(texts) {
        if (texts.length === 0)
            return [];
        if (texts.length === 1) {
            // Single text - use regular method
            const embedding = await this.generateEmbedding(texts[0]);
            return [embedding];
        }
        const methodStart = Date.now();
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDINGS_BATCH_START', {
            batchSize: texts.length,
            totalChars: texts.reduce((sum, t) => sum + t.length, 0)
        });
        // Use QOMS to ensure we never exceed resource limits
        return qoms.medium(async () => {
            // Ensure we have target dimension from database
            const targetDim = await this.ensureTargetDimension();
            // Wait for sandbox to be available
            const MAX_RETRIES = 5;
            const RETRY_DELAY_MS = 2000;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                if (!(await this.isSandboxAvailableAsync())) {
                    logger.warn({ attempt, maxRetries: MAX_RETRIES, socketPath: this.sandboxSocketPath }, 'ML embedding service unavailable for batch - waiting');
                    if (attempt === 1)
                        this.tryRestartContainer();
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
                    await this.checkSandboxAvailabilityAsync();
                    continue;
                }
                try {
                    const embeddings = await this.generateBatchWithDirectSocket(texts);
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'GENERATE_EMBEDDINGS_BATCH_SUCCESS', {
                        batchSize: texts.length,
                        embeddingsDim: embeddings[0]?.length,
                        totalMs: Date.now() - methodStart
                    });
                    // Scale all embeddings to target dimension if needed
                    if (targetDim > 0 && embeddings.length > 0 && embeddings[0].length !== targetDim) {
                        return embeddings.map(emb => this.scaleEmbedding(emb, targetDim));
                    }
                    return embeddings;
                }
                catch (error) {
                    logger.warn({ error, attempt }, 'Batch embedding failed - will retry');
                    // FIX: Use version tracking to prevent thundering herd restarts
                    const failureVersion = ++this.sandboxFailureVersion;
                    this.sandboxAvailable = false;
                    if (attempt < MAX_RETRIES) {
                        // Only restart if we're first to detect failure
                        if (!this.restartInProgress && failureVersion === this.sandboxFailureVersion) {
                            this.restartInProgress = true;
                            this.tryRestartContainer();
                            this.restartInProgress = false;
                        }
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
                    }
                }
            }
            // Fallback: sequential calls if batch fails
            logger.warn({ batchSize: texts.length }, 'Batch embedding failed, falling back to sequential');
            const results = [];
            for (const text of texts) {
                results.push(await this.generateEmbedding(text));
            }
            return results;
        });
    }
    /**
     * Generate batch embeddings using direct socket connection
     * Uses {"texts": [...]} protocol for single round-trip
     */
    generateBatchWithDirectSocket(texts) {
        return new Promise((resolve, reject) => {
            const socketPath = getEmbeddingSocketPath();
            const socket = createConnection(socketPath);
            // FIX Issue #1: Track socket for FD leak prevention
            this._trackSocket(socket, `batch-${texts.length}`);
            let buffer = '';
            let resolved = false;
            const startTime = Date.now();
            // FIX Issue #1: Ensure socket is destroyed on all exit paths
            const ensureSocketCleanup = () => {
                try {
                    if (!socket.destroyed) {
                        socket.destroy();
                    }
                }
                catch (e) {
                    // Ignore cleanup errors
                }
            };
            // Longer timeout for batches - scale with batch size
            const baseTimeout = this.getAdaptiveTimeout();
            const timeoutMs = Math.min(baseTimeout * Math.ceil(texts.length / 10), 300000); // Max 5 min
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'BATCH_SOCKET_CONNECTING', {
                socketPath,
                batchSize: texts.length,
                timeoutMs
            });
            let timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ensureSocketCleanup();
                    reject(new Error(`Batch embedding timeout after ${Math.round(timeoutMs / 1000)}s for ${texts.length} texts`));
                }
            }, timeoutMs);
            socket.on('connect', () => {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'BATCH_SOCKET_CONNECTED', {
                    batchSize: texts.length,
                    connectTimeMs: Date.now() - startTime
                });
                // Use batch protocol: {"texts": [...]}
                const request = JSON.stringify({ texts }) + '\n';
                socket.write(request);
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                // Reset timeout on data received
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        ensureSocketCleanup();
                        reject(new Error(`Batch embedding idle timeout for ${texts.length} texts`));
                    }
                }, timeoutMs);
                // Process all complete JSON messages (newline-delimited)
                // Server sends heartbeat first: {"status":"processing",...}
                // Then actual response: {"embeddings":[...],...}
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    if (resolved)
                        return;
                    const responseJson = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    try {
                        const response = JSON.parse(responseJson);
                        // Skip heartbeat/processing status - keep waiting
                        if (response.status === 'processing') {
                            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'BATCH_SOCKET_HEARTBEAT', {
                                batchSize: texts.length,
                                count: response.count,
                                elapsedMs: Date.now() - startTime
                            });
                            continue; // Keep waiting for actual embeddings
                        }
                        // Got actual response - resolve or reject
                        clearTimeout(timeout);
                        resolved = true;
                        ensureSocketCleanup();
                        const responseTime = Date.now() - startTime;
                        this.recordResponseTime(responseTime / texts.length); // Per-text average
                        if (response.error) {
                            reject(new Error(`Batch embedding error: ${response.error}`));
                        }
                        else if (response.embeddings && Array.isArray(response.embeddings)) {
                            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'BATCH_SOCKET_SUCCESS', {
                                batchSize: texts.length,
                                embeddingsCount: response.embeddings.length,
                                totalMs: responseTime,
                                msPerText: Math.round(responseTime / texts.length)
                            });
                            resolve(response.embeddings);
                        }
                        else {
                            reject(new Error('Invalid batch response from embedding service'));
                        }
                    }
                    catch (err) {
                        clearTimeout(timeout);
                        resolved = true;
                        ensureSocketCleanup();
                        reject(new Error(`Failed to parse batch embedding response: ${err}`));
                    }
                }
            });
            socket.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    ensureSocketCleanup();
                    reject(err);
                }
            });
            socket.on('close', () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('Batch socket closed unexpectedly'));
                }
            });
        });
    }
    /**
     * Scale embedding to target dimension (up or down)
     * Uses interpolation for downscaling, pattern repetition for upscaling
     */
    scaleEmbedding(embedding, targetDim) {
        const srcDim = embedding.length;
        if (srcDim === targetDim)
            return embedding;
        const result = new Array(targetDim);
        if (targetDim < srcDim) {
            // DOWNSCALE: Average neighboring values
            const ratio = srcDim / targetDim;
            for (let i = 0; i < targetDim; i++) {
                const start = Math.floor(i * ratio);
                const end = Math.floor((i + 1) * ratio);
                let sum = 0;
                for (let j = start; j < end; j++) {
                    sum += embedding[j];
                }
                result[i] = sum / (end - start);
            }
        }
        else {
            // UPSCALE: Linear interpolation
            const ratio = (srcDim - 1) / (targetDim - 1);
            for (let i = 0; i < targetDim; i++) {
                const srcIdx = i * ratio;
                const low = Math.floor(srcIdx);
                const high = Math.min(low + 1, srcDim - 1);
                const frac = srcIdx - low;
                result[i] = embedding[low] * (1 - frac) + embedding[high] * frac;
            }
        }
        // Normalize to unit length (important for cosine similarity!)
        const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
        if (norm > 0) {
            for (let i = 0; i < targetDim; i++) {
                result[i] /= norm;
            }
        }
        return result;
    }
    async generateSandboxedEmbedding(text) {
        const methodStart = Date.now();
        // Get fresh socket path
        const freshSocketPath = getEmbeddingSocketPath();
        this.sandboxSocketPath = freshSocketPath;
        // WARM SOCKET APPROACH: Try warm socket first, fall back to direct if fails
        // This gives us fast starts (~50ms) when warm, with reliable fallback (~500ms) when cold
        // FIX: Use lock to prevent race condition where two requests use warm socket,
        // one fails and destroys it while the other is mid-request
        // Try warm socket if available and path matches
        if (this.warmSocketReady && this.warmSocket && this.warmSocketPath === freshSocketPath) {
            // Acquire lock - wait for previous warm socket operation to complete
            let releaseLock = () => { };
            const lockPromise = new Promise(resolve => { releaseLock = resolve; });
            const previousLock = this.warmSocketLock;
            this.warmSocketLock = lockPromise;
            try {
                await previousLock; // Wait for previous operation
                // Re-check conditions after acquiring lock (may have changed)
                if (!this.warmSocketReady || !this.warmSocket || this.warmSocketPath !== freshSocketPath) {
                    releaseLock();
                    // Fall through to direct socket
                }
                else {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_ATTEMPT', {
                        textLength: text.length,
                        socketPath: freshSocketPath,
                        idleMs: Date.now() - this.warmSocketLastUsed
                    });
                    const result = await this.generateWithWarmSocket(text);
                    this.warmSocketLastUsed = Date.now();
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_SUCCESS', {
                        totalMs: Date.now() - methodStart,
                        resultDim: result.length
                    });
                    releaseLock();
                    return result;
                }
            }
            catch (err) {
                // Warm socket failed - close it and fall back to direct
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_FAILED', {
                    error: err instanceof Error ? err.message : String(err),
                    fallingBackToDirect: true
                });
                this.closeWarmSocket();
                releaseLock();
            }
        }
        // Direct connection (cold start or fallback)
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_START', {
            textLength: text.length,
            socketPath: freshSocketPath,
            reason: !this.warmSocketReady ? 'no warm socket' : 'path mismatch or failed'
        });
        try {
            const result = await this.generateWithDirectSocket(text, freshSocketPath);
            // Warm up socket in background for next call
            this.warmUpSocketInBackground(freshSocketPath);
            return result;
        }
        catch (directSocketError) {
            // Step 3: Direct socket failed - TRY ON-DEMAND DOCKER UNPAUSE
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_FAILED', {
                error: directSocketError instanceof Error ? directSocketError.message : String(directSocketError),
                textLength: text.length,
                tryingOnDemandUnpause: true
            });
            // ON-DEMAND UNPAUSE: Docker stays paused until we need it
            const wasUnpaused = await this.unpauseDockerIfNeeded();
            if (wasUnpaused) {
                // Docker was paused and is now unpaused - retry the direct socket
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'RETRY_AFTER_UNPAUSE', {
                    textLength: text.length
                });
                try {
                    const result = await this.generateWithDirectSocket(text, freshSocketPath);
                    // Warm up socket in background for next call
                    this.warmUpSocketInBackground(freshSocketPath);
                    return result;
                }
                catch (retryError) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'RETRY_AFTER_UNPAUSE_FAILED', {
                        error: retryError instanceof Error ? retryError.message : String(retryError)
                    });
                    // Fall through to Python restart
                }
            }
            // Step 4: Try Python auto-start (for non-Docker environments or dead sockets)
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'TRYING_PYTHON_AUTOSTART', {
                textLength: text.length,
                wasUnpaused
            });
            const pythonStarted = await this.autoStartPythonEmbedding();
            if (pythonStarted) {
                // Python server started - retry with new socket
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'RETRY_AFTER_PYTHON_START', {
                    textLength: text.length,
                    newSocketPath: this.sandboxSocketPath
                });
                try {
                    const result = await this.generateWithDirectSocket(text, this.sandboxSocketPath);
                    this.warmUpSocketInBackground(this.sandboxSocketPath);
                    return result;
                }
                catch (retryError) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'RETRY_AFTER_PYTHON_START_FAILED', {
                        error: retryError instanceof Error ? retryError.message : String(retryError)
                    });
                    // Fall through to queue
                }
            }
            // Step 5: Still failed - queue the request for later processing
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'QUEUEING_REQUEST', {
                textLength: text.length,
                wasUnpaused
            });
            // Queue the request and return the promise that will resolve when socket warms up
            if (this.embeddingQueue) {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'QUEUING_TO_POSTGRES', {
                    textLength: text.length
                });
                // Also trigger warm-up in background (which will drain queue when ready)
                this.warmUpSocketInBackground(freshSocketPath);
                return this.embeddingQueue.queueForEmbedding(text);
            }
            else {
                // No queue available - re-throw the original error
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'NO_QUEUE_AVAILABLE', {
                    error: 'EmbeddingQueue not initialized, cannot queue request'
                });
                throw directSocketError;
            }
        }
    }
    /**
     * Generate embedding using the WARM socket (fast path ~50ms)
     * Simple timeout-based approach - no complex state machine
     */
    generateWithWarmSocket(text) {
        return new Promise((resolve, reject) => {
            if (!this.warmSocket || !this.warmSocketReady) {
                reject(new Error('Warm socket not ready'));
                return;
            }
            const startTime = Date.now();
            const timeoutMs = this.getAdaptiveTimeout();
            let buffer = '';
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error(`Warm socket timeout after ${timeoutMs}ms`));
                }
            }, timeoutMs);
            const dataHandler = (data) => {
                buffer += data.toString();
                // Process all complete JSON lines in buffer
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1 && !resolved) {
                    const line = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1); // Keep remainder for next line
                    try {
                        const response = JSON.parse(line);
                        // HEARTBEAT: "processing" status means server is working - reset timeout and keep waiting
                        if (response.status === 'processing') {
                            clearTimeout(timeout);
                            timeout = setTimeout(() => {
                                if (!resolved) {
                                    resolved = true;
                                    reject(new Error(`Warm socket timeout after ${timeoutMs}ms`));
                                }
                            }, timeoutMs);
                            continue; // Keep reading for actual embedding
                        }
                        // Got actual response - resolve
                        clearTimeout(timeout);
                        resolved = true;
                        this.warmSocket?.removeListener('data', dataHandler);
                        const responseTime = Date.now() - startTime;
                        this.recordResponseTime(responseTime);
                        if (response.error) {
                            reject(new Error(`Embedding service error: ${response.error}`));
                        }
                        else if (response.embedding) {
                            resolve(response.embedding);
                        }
                        else {
                            reject(new Error('Invalid response from embedding service'));
                        }
                        return;
                    }
                    catch (err) {
                        clearTimeout(timeout);
                        resolved = true;
                        this.warmSocket?.removeListener('data', dataHandler);
                        reject(new Error(`Failed to parse embedding response: ${err}`));
                        return;
                    }
                }
            };
            this.warmSocket.on('data', dataHandler);
            // Send request
            const request = JSON.stringify({ type: 'embed', text }) + '\n';
            this.warmSocket.write(request);
        });
    }
    /**
     * Close the warm socket cleanly
     */
    closeWarmSocket() {
        if (this.warmSocket) {
            try {
                this.warmSocket.removeAllListeners();
                this.warmSocket.destroy();
            }
            catch (e) {
                // Ignore errors during cleanup
            }
            this.warmSocket = null;
        }
        this.warmSocketReady = false;
        this.warmSocketPath = null;
        if (this.warmSocketHealthInterval) {
            clearInterval(this.warmSocketHealthInterval);
            this.warmSocketHealthInterval = null;
        }
    }
    /**
     * Warm up a socket in the background for faster subsequent calls
     * Non-blocking - doesn't affect current request
     */
    warmUpSocketInBackground(socketPath) {
        // Don't warm up if already warming or path matches
        if (this.warmSocketReady && this.warmSocketPath === socketPath) {
            return;
        }
        // Close existing warm socket if path changed
        if (this.warmSocketPath && this.warmSocketPath !== socketPath) {
            this.closeWarmSocket();
        }
        // Create new warm socket in background
        setImmediate(() => {
            try {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARMING_SOCKET', { socketPath });
                this.warmSocket = createConnection(socketPath);
                // FIX Issue #1: Track warm socket for FD leak prevention
                this._trackSocket(this.warmSocket, 'warm');
                this.warmSocketPath = socketPath;
                this.warmSocket.on('connect', () => {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_CONNECTED', { socketPath });
                    // QUEUE DRAIN: Process pending embeddings BEFORE marking socket ready
                    // This ensures queued requests get resolved before new requests come in
                    this.drainEmbeddingQueue(socketPath).then((drained) => {
                        if (drained > 0) {
                            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'QUEUE_DRAINED', {
                                socketPath,
                                itemsProcessed: drained
                            });
                        }
                        // NOW mark socket ready for new requests
                        this.warmSocketReady = true;
                        this.warmSocketLastUsed = Date.now();
                        // Start health check interval
                        this.startWarmSocketHealthCheck();
                    }).catch((err) => {
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'QUEUE_DRAIN_ERROR', {
                            socketPath,
                            error: err instanceof Error ? err.message : String(err)
                        });
                        // Still mark socket ready even if drain fails - new requests should work
                        this.warmSocketReady = true;
                        this.warmSocketLastUsed = Date.now();
                        this.startWarmSocketHealthCheck();
                    });
                });
                this.warmSocket.on('error', (err) => {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_ERROR', {
                        socketPath,
                        error: err.message
                    });
                    this.closeWarmSocket();
                });
                this.warmSocket.on('close', () => {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_CLOSED', { socketPath });
                    this.warmSocketReady = false;
                });
            }
            catch (err) {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_CREATE_ERROR', {
                    socketPath,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        });
    }
    // On-demand Docker unpause tracking
    lastDockerUnpauseAttempt = 0;
    static DOCKER_UNPAUSE_COOLDOWN_MS = 5000; // Don't spam unpause attempts
    /**
     * Check if the Docker container is paused
     * Uses docker inspect to check container state
     */
    async isDockerPaused() {
        try {
            const containerName = LocalEmbeddingProvider.CONTAINER_NAME;
            const { execSync } = await import('child_process');
            const result = execSync(`docker inspect -f "{{.State.Paused}}" ${containerName} 2>/dev/null`, {
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
            return result === 'true';
        }
        catch (err) {
            // Container doesn't exist or docker not available - not paused (different issue)
            return false;
        }
    }
    /**
     * Unpause the Docker container if it's paused
     * ON-DEMAND activation - Docker stays paused until we need embeddings
     */
    async unpauseDockerIfNeeded() {
        // Cooldown to prevent spamming unpause
        const now = Date.now();
        if (now - this.lastDockerUnpauseAttempt < LocalEmbeddingProvider.DOCKER_UNPAUSE_COOLDOWN_MS) {
            return false;
        }
        this.lastDockerUnpauseAttempt = now;
        try {
            const isPaused = await this.isDockerPaused();
            if (!isPaused) {
                return false; // Already running
            }
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DOCKER_ON_DEMAND_UNPAUSE', {
                containerName: LocalEmbeddingProvider.CONTAINER_NAME,
                reason: 'embedding request received'
            });
            const containerName = LocalEmbeddingProvider.CONTAINER_NAME;
            const { execSync } = await import('child_process');
            execSync(`docker unpause ${containerName}`, { timeout: 10000 });
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DOCKER_UNPAUSED_SUCCESS', {
                containerName
            });
            // Wait briefly for socket to be ready
            await new Promise(resolve => setTimeout(resolve, 500));
            return true;
        }
        catch (err) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DOCKER_UNPAUSE_FAILED', {
                error: err instanceof Error ? err.message : String(err)
            });
            return false;
        }
    }
    /**
     * Drain the embedding queue when socket becomes available
     * Uses generateWithDirectSocket for the actual embedding generation
     *
     * @param socketPath - The socket path to use for embedding generation
     * @returns Number of items drained from queue
     */
    async drainEmbeddingQueue(socketPath) {
        if (!this.embeddingQueue) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DRAIN_SKIP_NO_QUEUE', {
                reason: 'embeddingQueue not initialized'
            });
            return 0;
        }
        try {
            // Check if there are pending items first
            const pendingCount = await this.embeddingQueue.getPendingCount();
            if (pendingCount === 0) {
                return 0;
            }
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DRAINING_QUEUE', {
                socketPath,
                pendingCount
            });
            // Drain the queue using generateWithDirectSocket for actual embedding
            const drained = await this.embeddingQueue.drainQueue((text) => this.generateWithDirectSocket(text, socketPath));
            return drained;
        }
        catch (err) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DRAIN_ERROR', {
                socketPath,
                error: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    }
    /**
     * Start periodic health check for warm socket
     * Closes socket if idle too long or unhealthy
     */
    startWarmSocketHealthCheck() {
        if (this.warmSocketHealthInterval) {
            clearInterval(this.warmSocketHealthInterval);
        }
        this.warmSocketHealthInterval = setInterval(() => {
            // Close if idle too long
            const idleTime = Date.now() - this.warmSocketLastUsed;
            if (idleTime > LocalEmbeddingProvider.WARM_SOCKET_IDLE_TIMEOUT_MS) {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_IDLE_CLOSE', {
                    idleMs: idleTime,
                    maxIdleMs: LocalEmbeddingProvider.WARM_SOCKET_IDLE_TIMEOUT_MS
                });
                this.closeWarmSocket();
                return;
            }
            // Check if socket is still alive
            if (this.warmSocket && !this.warmSocket.destroyed) {
                // Socket looks healthy
            }
            else {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'WARM_SOCKET_UNHEALTHY', {
                    destroyed: this.warmSocket?.destroyed
                });
                this.closeWarmSocket();
            }
        }, LocalEmbeddingProvider.WARM_SOCKET_HEALTH_CHECK_MS);
    }
    /**
     * NUCLEAR FIX: Generate embedding using a DIRECT socket connection
     * Bypasses the broken persistent socket state machine entirely.
     * Creates a fresh connection for each call - no state, no caching, no bugs.
     * Takes socket path as parameter to ensure we ALWAYS use the fresh path.
     */
    async generateWithDirectSocket(text, socketPath) {
        let lastError = null;
        for (let attempt = 1; attempt <= LocalEmbeddingProvider.SOCKET_MAX_RETRIES; attempt++) {
            try {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_ATTEMPT', {
                    attempt,
                    socketPath,
                    maxRetries: LocalEmbeddingProvider.SOCKET_MAX_RETRIES
                });
                return await this.generateWithDirectSocketAttempt(text, socketPath, attempt);
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_ATTEMPT_ERROR', {
                    attempt,
                    error: lastError.message,
                    socketPath
                });
                // Check if error is retryable (timeout or transient socket error)
                const isRetryable = lastError.message.includes('timeout') ||
                    lastError.message.includes('ECONNRESET') ||
                    lastError.message.includes('ECONNREFUSED') ||
                    lastError.message.includes('EPIPE') ||
                    lastError.message.includes('ENOENT');
                if (!isRetryable || attempt >= LocalEmbeddingProvider.SOCKET_MAX_RETRIES) {
                    break;
                }
                // Exponential backoff with jitter
                const baseDelay = LocalEmbeddingProvider.SOCKET_INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
                const delay = Math.min(baseDelay + jitter, LocalEmbeddingProvider.SOCKET_MAX_RETRY_DELAY_MS);
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_BACKOFF', {
                    attempt,
                    delayMs: Math.round(delay),
                    nextAttempt: attempt + 1
                });
                logger.warn({
                    attempt,
                    maxRetries: LocalEmbeddingProvider.SOCKET_MAX_RETRIES,
                    error: lastError.message,
                    retryDelayMs: Math.round(delay),
                    socketPath
                }, 'Direct socket embedding failed, retrying with exponential backoff');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        // All retries exhausted
        throw new Error(`Embedding generation failed after ${LocalEmbeddingProvider.SOCKET_MAX_RETRIES} attempts. ` +
            `Socket: ${socketPath}. ` +
            `Last error: ${lastError?.message || 'unknown'}. ` +
            `Check if Frankenstein embedding service is running.`);
    }
    /**
     * Single attempt to generate embedding via DIRECT socket connection
     * Uses the passed socketPath, not cached state
     */
    generateWithDirectSocketAttempt(text, socketPath, attempt) {
        return new Promise((resolve, reject) => {
            const socket = createConnection(socketPath);
            // FIX Issue #1: Track socket for FD leak prevention
            this._trackSocket(socket, `direct-attempt-${attempt}`);
            let buffer = '';
            let resolved = false;
            const startTime = Date.now();
            const timeoutMs = this.getAdaptiveTimeout();
            // FIX Issue #1: Ensure socket is destroyed on all exit paths
            const ensureSocketCleanup = () => {
                try {
                    if (!socket.destroyed) {
                        socket.destroy();
                    }
                }
                catch (e) {
                    // Ignore cleanup errors
                }
            };
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_CONNECTING', {
                socketPath,
                attempt,
                timeoutMs
            });
            // IDLE-BASED TIMEOUT: Timer resets on any data received from socket
            // This allows long-running embeddings as long as server sends heartbeats
            let timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ensureSocketCleanup(); // FIX Issue #1: Use cleanup helper
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_INITIAL_TIMEOUT', {
                        socketPath,
                        attempt,
                        timeoutMs
                    });
                    reject(new Error(`Embedding idle timeout after ${Math.round(timeoutMs / 1000)}s of no activity ` +
                        `(attempt ${attempt}/${LocalEmbeddingProvider.SOCKET_MAX_RETRIES}). ` +
                        `Socket: ${socketPath}. ` +
                        `If model is slow, increase SPECMEM_EMBEDDING_TIMEOUT.`));
                }
            }, timeoutMs);
            socket.on('connect', () => {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_CONNECTED', {
                    socketPath,
                    attempt,
                    connectTimeMs: Date.now() - startTime
                });
                const request = JSON.stringify({ type: 'embed', text }) + '\n';
                socket.write(request);
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                // IDLE-BASED TIMEOUT: Reset timer on ANY data received
                // This means if the server is actively sending, we keep waiting
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        ensureSocketCleanup(); // FIX Issue #1: Use cleanup helper
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_IDLE_TIMEOUT', {
                            socketPath,
                            attempt,
                            timeoutMs
                        });
                        reject(new Error(`Embedding idle timeout after ${Math.round(timeoutMs / 1000)}s of no activity ` +
                            `(attempt ${attempt}/${LocalEmbeddingProvider.SOCKET_MAX_RETRIES}). ` +
                            `Socket: ${socketPath}. ` +
                            `If model is slow, increase SPECMEM_EMBEDDING_TIMEOUT.`));
                    }
                }, timeoutMs);
                // Process complete JSON messages (newline-delimited)
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    if (resolved)
                        return;
                    const responseJson = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    try {
                        const response = JSON.parse(responseJson);
                        // Handle heartbeat/processing status - just keep waiting
                        if (response.status === 'processing') {
                            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_HEARTBEAT', {
                                socketPath,
                                attempt,
                                textLength: response.text_length,
                                elapsedMs: Date.now() - startTime
                            });
                            continue; // Keep waiting for actual embedding
                        }
                        // Got actual response - resolve or reject
                        clearTimeout(timeout);
                        resolved = true;
                        const responseTime = Date.now() - startTime;
                        this.recordResponseTime(responseTime);
                        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_RESPONSE', {
                            socketPath,
                            attempt,
                            responseTimeMs: responseTime,
                            bufferLength: buffer.length
                        });
                        if (response.error) {
                            reject(new Error(`Embedding service error: ${response.error} (socket: ${socketPath})`));
                        }
                        else if (response.embedding) {
                            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_SUCCESS', {
                                socketPath,
                                attempt,
                                embeddingDim: response.embedding.length,
                                totalTimeMs: Date.now() - startTime
                            });
                            resolve(response.embedding);
                        }
                        else {
                            reject(new Error(`Invalid response from embedding service (socket: ${socketPath})`));
                        }
                        ensureSocketCleanup(); // FIX Issue #1: destroy instead of end
                        return;
                    }
                    catch (err) {
                        clearTimeout(timeout);
                        resolved = true;
                        reject(new Error(`Failed to parse embedding response: ${err instanceof Error ? err.message : err} (socket: ${socketPath})`));
                        ensureSocketCleanup(); // FIX Issue #1: destroy instead of end
                        return;
                    }
                }
            });
            socket.on('error', (err) => {
                clearTimeout(timeout);
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'DIRECT_SOCKET_ERROR', {
                    socketPath,
                    attempt,
                    error: err.message
                });
                if (!resolved) {
                    resolved = true;
                    ensureSocketCleanup(); // FIX Issue #1: Ensure socket destroyed on error
                    reject(new Error(`Socket error: ${err.message} (socket: ${socketPath})`));
                }
            });
        });
    }
    /**
     * Generate embedding using the PERSISTENT socket (fast path)
     * No connection overhead - socket stays open!
     * Includes retry logic with exponential backoff for transient failures.
     */
    async generateWithPersistentSocket(text) {
        const methodStart = Date.now();
        const textPreview = text.length > 30 ? text.substring(0, 30) + '...' : text;
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_START', {
            textLength: text.length,
            textPreview,
            maxRetries: LocalEmbeddingProvider.SOCKET_MAX_RETRIES,
            socketConnected: this.socketConnected,
            hasPersistentSocket: !!this.persistentSocket,
            socketPath: this.sandboxSocketPath
        });
        let lastError = null;
        for (let attempt = 1; attempt <= LocalEmbeddingProvider.SOCKET_MAX_RETRIES; attempt++) {
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_START', {
                attempt,
                maxRetries: LocalEmbeddingProvider.SOCKET_MAX_RETRIES,
                totalElapsedMs: Date.now() - methodStart,
                socketConnected: this.socketConnected
            });
            try {
                const attemptStart = Date.now();
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_CALLING_ATTEMPT', {
                    attempt
                });
                const result = await this.generateWithPersistentSocketAttempt(text, attempt);
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_SUCCESS', {
                    attempt,
                    attemptMs: Date.now() - attemptStart,
                    totalElapsedMs: Date.now() - methodStart,
                    resultDim: result.length
                });
                return result;
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_ERROR', {
                    attempt,
                    error: lastError.message,
                    totalElapsedMs: Date.now() - methodStart
                });
                // Check if error is retryable (timeout or transient socket error)
                const isRetryable = lastError.message.includes('timeout') ||
                    lastError.message.includes('ECONNRESET') ||
                    lastError.message.includes('EPIPE') ||
                    lastError.message.includes('socket');
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_RETRY_CHECK', {
                    attempt,
                    isRetryable,
                    isLastAttempt: attempt >= LocalEmbeddingProvider.SOCKET_MAX_RETRIES,
                    errorMessage: lastError.message
                });
                if (!isRetryable || attempt >= LocalEmbeddingProvider.SOCKET_MAX_RETRIES) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_BREAKING_LOOP', {
                        attempt,
                        reason: !isRetryable ? 'not retryable' : 'max retries reached'
                    });
                    break;
                }
                // Exponential backoff with jitter
                const baseDelay = LocalEmbeddingProvider.SOCKET_INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
                const delay = Math.min(baseDelay + jitter, LocalEmbeddingProvider.SOCKET_MAX_RETRY_DELAY_MS);
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_BACKOFF_WAIT', {
                    attempt,
                    baseDelay,
                    jitter: Math.round(jitter),
                    delay: Math.round(delay)
                });
                logger.warn({
                    attempt,
                    maxRetries: LocalEmbeddingProvider.SOCKET_MAX_RETRIES,
                    error: lastError.message,
                    retryDelayMs: Math.round(delay),
                    socketPath: this.sandboxSocketPath
                }, 'Persistent socket embedding failed, retrying with exponential backoff');
                await new Promise(resolve => setTimeout(resolve, delay));
                // Try to reconnect socket before retry
                if (!this.socketConnected) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_RECONNECTING', {
                        attempt,
                        nextAttempt: attempt + 1
                    });
                    this.initPersistentSocket();
                    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for reconnection
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_RECONNECT_WAIT_DONE', {
                        socketConnected: this.socketConnected,
                        hasPersistentSocket: !!this.persistentSocket
                    });
                }
            }
        }
        // All retries exhausted
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ALL_RETRIES_EXHAUSTED', {
            maxRetries: LocalEmbeddingProvider.SOCKET_MAX_RETRIES,
            lastError: lastError?.message,
            totalElapsedMs: Date.now() - methodStart,
            socketPath: this.sandboxSocketPath
        });
        throw new Error(`Embedding generation failed after ${LocalEmbeddingProvider.SOCKET_MAX_RETRIES} attempts. ` +
            `Socket: ${this.sandboxSocketPath}. ` +
            `Last error: ${lastError?.message || 'unknown'}. ` +
            `Check if Frankenstein embedding service is running.`);
    }
    /**
     * Single attempt to generate embedding via persistent socket
     */
    generateWithPersistentSocketAttempt(text, attempt) {
        const methodStart = Date.now();
        const textPreview = text.length > 30 ? text.substring(0, 30) + '...' : text;
        __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_INIT', {
            attempt,
            textLength: text.length,
            textPreview,
            hasPersistentSocket: !!this.persistentSocket,
            socketConnected: this.socketConnected,
            socketPath: this.sandboxSocketPath
        });
        return new Promise((resolve, reject) => {
            if (!this.persistentSocket || !this.socketConnected) {
                __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_NOT_CONNECTED', {
                    attempt,
                    hasPersistentSocket: !!this.persistentSocket,
                    socketConnected: this.socketConnected,
                    elapsedMs: Date.now() - methodStart
                });
                return reject(new Error(`Persistent socket not connected (socket: ${this.sandboxSocketPath})`));
            }
            const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const startTime = Date.now();
            const timeoutMs = this.getAdaptiveTimeout();
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_SETUP', {
                attempt,
                requestId,
                timeoutMs,
                pendingRequestsCount: this.pendingRequests.size
            });
            const timeout = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_TIMEOUT_FIRED', {
                        attempt,
                        requestId,
                        timeoutMs,
                        totalElapsedMs: Date.now() - methodStart,
                        pendingRequestsCount: this.pendingRequests.size
                    });
                    this.pendingRequests.delete(requestId);
                    reject(new Error(`Embedding generation timeout after ${Math.round(timeoutMs / 1000)}s ` +
                        `(attempt ${attempt}/${LocalEmbeddingProvider.SOCKET_MAX_RETRIES}). ` +
                        `Socket: ${this.sandboxSocketPath}. ` +
                        `Cold starts may need longer timeout - set SPECMEM_EMBEDDING_TIMEOUT=60 for 60 seconds.`));
                }
            }, timeoutMs);
            // Store pending request
            this.pendingRequests.set(requestId, {
                resolve: (embedding) => {
                    const responseTime = Date.now() - startTime;
                    __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_RESPONSE_RECEIVED', {
                        attempt,
                        requestId,
                        responseTimeMs: responseTime,
                        embeddingDim: embedding.length,
                        totalElapsedMs: Date.now() - methodStart
                    });
                    this.recordResponseTime(responseTime);
                    resolve(embedding);
                },
                reject,
                timeout,
                createdAt: Date.now() // FIX Issue #6: Track creation time for stale cleanup
            });
            // Send request with ID so we can match responses
            const request = JSON.stringify({ type: 'embed', text, requestId }) + '\n';
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_WRITING_REQUEST', {
                attempt,
                requestId,
                requestLength: request.length,
                elapsedMs: Date.now() - methodStart
            });
            this.persistentSocket.write(request);
            __debugLog('[EMBEDDING DEBUG]', Date.now(), 'PERSISTENT_SOCKET_ATTEMPT_REQUEST_WRITTEN', {
                attempt,
                requestId,
                waitingForResponseWithTimeoutMs: timeoutMs
            });
        });
    }
    /**
     * Generate embedding with a NEW socket (slow fallback)
     * Used when persistent socket is unavailable.
     * Includes retry logic with exponential backoff for transient failures.
     */
    async generateWithNewSocket(text) {
        let lastError = null;
        for (let attempt = 1; attempt <= LocalEmbeddingProvider.SOCKET_MAX_RETRIES; attempt++) {
            try {
                return await this.generateWithNewSocketAttempt(text, attempt);
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                // Check if error is retryable (timeout or transient socket error)
                const isRetryable = lastError.message.includes('timeout') ||
                    lastError.message.includes('ECONNRESET') ||
                    lastError.message.includes('ECONNREFUSED') ||
                    lastError.message.includes('EPIPE') ||
                    lastError.message.includes('ENOENT');
                if (!isRetryable || attempt >= LocalEmbeddingProvider.SOCKET_MAX_RETRIES) {
                    break;
                }
                // Exponential backoff with jitter
                const baseDelay = LocalEmbeddingProvider.SOCKET_INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
                const delay = Math.min(baseDelay + jitter, LocalEmbeddingProvider.SOCKET_MAX_RETRY_DELAY_MS);
                logger.warn({
                    attempt,
                    maxRetries: LocalEmbeddingProvider.SOCKET_MAX_RETRIES,
                    error: lastError.message,
                    retryDelayMs: Math.round(delay),
                    socketPath: this.sandboxSocketPath
                }, 'New socket embedding failed, retrying with exponential backoff');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        // All retries exhausted
        throw new Error(`Embedding generation failed after ${LocalEmbeddingProvider.SOCKET_MAX_RETRIES} attempts. ` +
            `Socket: ${this.sandboxSocketPath}. ` +
            `Last error: ${lastError?.message || 'unknown'}. ` +
            `Check if Frankenstein embedding service is running.`);
    }
    /**
     * Single attempt to generate embedding via new socket
     * Uses IDLE-BASED timeout - resets on any data received
     */
    generateWithNewSocketAttempt(text, attempt) {
        return new Promise((resolve, reject) => {
            const socket = createConnection(this.sandboxSocketPath);
            // FIX Issue #1: Track socket for FD leak prevention
            this._trackSocket(socket, `new-attempt-${attempt}`);
            let buffer = '';
            let resolved = false;
            const startTime = Date.now();
            const timeoutMs = this.getAdaptiveTimeout();
            // FIX Issue #1: Ensure socket is destroyed on all exit paths
            const ensureSocketCleanup = () => {
                try {
                    if (!socket.destroyed) {
                        socket.destroy();
                    }
                }
                catch (e) {
                    // Ignore cleanup errors
                }
            };
            // IDLE-BASED TIMEOUT: Resets on any data received
            let timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ensureSocketCleanup();
                    reject(new Error(`Embedding idle timeout after ${Math.round(timeoutMs / 1000)}s of no activity ` +
                        `(attempt ${attempt}/${LocalEmbeddingProvider.SOCKET_MAX_RETRIES}). ` +
                        `Socket: ${this.sandboxSocketPath}. ` +
                        `If model is slow, increase SPECMEM_EMBEDDING_TIMEOUT.`));
                }
            }, timeoutMs);
            socket.on('connect', () => {
                const request = JSON.stringify({ type: 'embed', text }) + '\n';
                socket.write(request);
            });
            socket.on('data', (data) => {
                buffer += data.toString();
                // IDLE-BASED TIMEOUT: Reset timer on ANY data received
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        ensureSocketCleanup();
                        reject(new Error(`Embedding idle timeout after ${Math.round(timeoutMs / 1000)}s of no activity ` +
                            `(attempt ${attempt}/${LocalEmbeddingProvider.SOCKET_MAX_RETRIES}). ` +
                            `Socket: ${this.sandboxSocketPath}. ` +
                            `If model is slow, increase SPECMEM_EMBEDDING_TIMEOUT.`));
                    }
                }, timeoutMs);
                // Process complete JSON messages (newline-delimited)
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    if (resolved)
                        return;
                    const responseJson = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    try {
                        const response = JSON.parse(responseJson);
                        // Handle heartbeat/processing status - just keep waiting
                        if (response.status === 'processing') {
                            continue;
                        }
                        // Got actual response - resolve or reject
                        clearTimeout(timeout);
                        resolved = true;
                        const responseTime = Date.now() - startTime;
                        this.recordResponseTime(responseTime);
                        if (response.error) {
                            reject(new Error(`Embedding service error: ${response.error} (socket: ${this.sandboxSocketPath})`));
                        }
                        else if (response.embedding) {
                            resolve(response.embedding);
                        }
                        else {
                            reject(new Error(`Invalid response from embedding service (socket: ${this.sandboxSocketPath})`));
                        }
                        ensureSocketCleanup(); // FIX Issue #1: destroy instead of end
                        return;
                    }
                    catch (err) {
                        clearTimeout(timeout);
                        resolved = true;
                        reject(new Error(`Failed to parse embedding response: ${err instanceof Error ? err.message : err} (socket: ${this.sandboxSocketPath})`));
                        ensureSocketCleanup(); // FIX Issue #1: destroy instead of end
                        return;
                    }
                }
            });
            socket.on('error', (err) => {
                clearTimeout(timeout);
                if (!resolved) {
                    resolved = true;
                    ensureSocketCleanup(); // FIX Issue #1: Ensure socket destroyed on error
                    reject(new Error(`Socket error: ${err.message} (socket: ${this.sandboxSocketPath})`));
                }
            });
        });
    }
    /**
     * Calculate adaptive timeout based on recent response times
     * Uses rolling average + 3x standard deviation for safety margin
     */
    getAdaptiveTimeout() {
        if (this.responseTimes.length < 3) {
            // Not enough data yet, use initial timeout
            return LocalEmbeddingProvider.INITIAL_TIMEOUT_MS;
        }
        // Calculate mean
        const sum = this.responseTimes.reduce((a, b) => a + b, 0);
        const mean = sum / this.responseTimes.length;
        // Calculate standard deviation
        const squaredDiffs = this.responseTimes.map(t => Math.pow(t - mean, 2));
        const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
        const stdDev = Math.sqrt(avgSquaredDiff);
        // Timeout = mean + MULTIPLIER * stdDev (covers 99.7% of cases with 3x)
        const adaptiveTimeout = mean + (LocalEmbeddingProvider.TIMEOUT_MULTIPLIER * stdDev);
        // Clamp to min/max bounds
        const clampedTimeout = Math.max(LocalEmbeddingProvider.MIN_TIMEOUT_MS, Math.min(LocalEmbeddingProvider.MAX_TIMEOUT_MS, adaptiveTimeout));
        logger.debug({
            mean: Math.round(mean),
            stdDev: Math.round(stdDev),
            adaptiveTimeout: Math.round(adaptiveTimeout),
            clampedTimeout: Math.round(clampedTimeout),
            sampleCount: this.responseTimes.length
        }, 'Calculated adaptive embedding timeout');
        return clampedTimeout;
    }
    /**
     * Record a response time for adaptive timeout calculation
     */
    recordResponseTime(responseTimeMs) {
        this.responseTimes.push(responseTimeMs);
        // Keep only the last N response times (rolling window)
        if (this.responseTimes.length > LocalEmbeddingProvider.RESPONSE_TIME_WINDOW) {
            this.responseTimes.shift();
        }
    }
    padEmbedding(embedding, targetDims) {
        // Pad smaller embedding to target dimensions by repeating pattern
        const padded = new Array(targetDims);
        for (let i = 0; i < targetDims; i++) {
            padded[i] = embedding[i % embedding.length];
        }
        // Re-normalize
        const magnitude = Math.sqrt(padded.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
            for (let i = 0; i < padded.length; i++) {
                padded[i] = padded[i] / magnitude;
            }
        }
        return padded;
    }
    generateHashEmbedding(text, overrideDimension) {
        // Normalize text for more consistent embeddings
        const normalizedText = text.toLowerCase().trim();
        // Use override dimension, or fall back to instance target dimension
        // If no dimension is known (DB not ready), we CANNOT generate hash embedding
        // because the dimension must come from the database. Throw to force retry.
        const dimension = overrideDimension ?? this.targetDimension;
        if (dimension === null || dimension === 0) {
            throw new Error('Cannot generate hash embedding: database dimension not yet known. Ensure database is initialized first.');
        }
        // Generate base hash
        const hash = this.hashString(normalizedText);
        const embedding = new Array(dimension);
        // Create embedding using multiple hash seeds for distribution
        for (let i = 0; i < dimension; i++) {
            // Use combination of position and text hash for variety
            const seed1 = hash + i * 31;
            const seed2 = this.hashString(normalizedText.slice(0, Math.min(i + 10, normalizedText.length)));
            const combined = seed1 ^ seed2;
            // Generate value between -1 and 1
            embedding[i] = Math.sin(combined) * Math.cos(combined * 0.7);
        }
        // Add n-gram influence for better semantic grouping
        this.addNgramInfluence(normalizedText, embedding, dimension);
        // Normalize to unit vector for cosine similarity
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
    addNgramInfluence(text, embedding, dimension) {
        // Add 3-gram influence for better semantic grouping
        const ngramSize = 3;
        for (let i = 0; i <= text.length - ngramSize; i++) {
            const ngram = text.slice(i, i + ngramSize);
            const ngramHash = this.hashString(ngram);
            const position = ngramHash % dimension;
            embedding[position] = (embedding[position] ?? 0) + 0.1;
        }
    }
    /**
     * Shutdown the embedding provider - kills Python embedding process if running
     * Called during graceful shutdown to prevent orphaned processes
     *
     * Handles two cases:
     * 1. MCP server started the embedding (pythonEmbeddingPid is set)
     * 2. Session hook started the embedding (read from PID file)
     */
    async shutdown() {
        let pidToKill = this.pythonEmbeddingPid;
        // If we didn't start the embedding server, check the PID file
        // (session start hook may have started it)
        if (!pidToKill) {
            const projectPath = getProjectPath();
            const pidFile = join(projectPath, 'specmem', 'sockets', 'embedding.pid');
            try {
                if (existsSync(pidFile)) {
                    const pidData = readFileSync(pidFile, 'utf8').trim();
                    const [pidStr] = pidData.split(':');
                    const pid = parseInt(pidStr, 10);
                    if (!isNaN(pid) && pid > 0) {
                        pidToKill = pid;
                        logger.info({ pid, pidFile }, 'Found embedding PID from file (started by session hook)');
                    }
                }
            }
            catch (err) {
                logger.debug({ pidFile, error: err }, 'Could not read embedding PID file');
            }
        }
        if (pidToKill) {
            logger.info({ pid: pidToKill }, 'Killing Python embedding server process');
            try {
                process.kill(pidToKill, 'SIGTERM');
                // Give it a moment to exit gracefully
                await new Promise(r => setTimeout(r, 500));
                // If still running, force kill
                try {
                    process.kill(pidToKill, 0); // Check if process exists
                    process.kill(pidToKill, 'SIGKILL');
                    logger.warn({ pid: pidToKill }, 'Had to SIGKILL embedding process');
                }
                catch (e) {
                    // Process already exited - good
                }
            }
            catch (err) {
                // Process may already be dead
                logger.debug({ pid: pidToKill, error: err }, 'Embedding process kill failed (may already be dead)');
            }
            this.pythonEmbeddingPid = null;
            // Clean up PID file
            const projectPath = getProjectPath();
            const pidFile = join(projectPath, 'specmem', 'sockets', 'embedding.pid');
            try {
                if (existsSync(pidFile)) {
                    unlinkSync(pidFile);
                }
            }
            catch (err) {
                // Ignore - file may not exist
            }
        }
    }
}
/**
 * Create the embedding provider
 * Always uses local embeddings - no external API needed
 * DYNAMICALLY detects dimension from database (no hardcoding!)
 *
 * NOTE: Embedding dimensions are AUTO-DETECTED from the database pgvector column.
 * The SPECMEM_EMBEDDING_DIMENSIONS config setting is DEPRECATED and ignored.
 * The database pg_attribute table is the single source of truth for dimensions.
 *
 * Uses the centralized DimensionAdapter for comprehensive dimension detection.
 */
async function createEmbeddingProvider() {
    // FIX: Wait for embedding server to be ready before creating provider
    // This prevents 21+ embedding errors during startup when the server is still loading
    const embeddingSocketPath = getEmbeddingSocketPath();
    const maxWaitMs = parseInt(process.env['SPECMEM_EMBEDDING_WAIT_MS'] || '30000', 10);
    const checkIntervalMs = 1000;
    const startWait = Date.now();
    logger.info({ socketPath: embeddingSocketPath, maxWaitMs }, '[createEmbeddingProvider] Waiting for embedding server to be ready...');
    while (Date.now() - startWait < maxWaitMs) {
        if (existsSync(embeddingSocketPath)) {
            // Socket file exists - try a quick health check
            try {
                const testResult = await new Promise((resolve) => {
                    const testSocket = createConnection(embeddingSocketPath);
                    const timeout = setTimeout(() => {
                        testSocket.destroy();
                        resolve(false);
                    }, 5000);
                    testSocket.on('connect', () => {
                        testSocket.write('{"type":"health"}\n');
                    });
                    testSocket.on('data', () => {
                        clearTimeout(timeout);
                        testSocket.destroy();
                        resolve(true);
                    });
                    testSocket.on('error', () => {
                        clearTimeout(timeout);
                        testSocket.destroy();
                        resolve(false);
                    });
                });
                if (testResult) {
                    logger.info({ elapsed: Date.now() - startWait }, '[createEmbeddingProvider] Embedding server is ready');
                    break;
                }
            }
            catch {
                // Socket test failed - keep waiting
            }
        }
        // Still waiting - log progress every 5 seconds
        if ((Date.now() - startWait) % 5000 < checkIntervalMs) {
            logger.debug({ elapsed: Date.now() - startWait, maxWaitMs }, '[createEmbeddingProvider] Still waiting for embedding server...');
        }
        await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
    // Log if we timed out (non-fatal - provider will handle server startup)
    if (!existsSync(embeddingSocketPath)) {
        logger.warn({ elapsed: Date.now() - startWait, maxWaitMs }, '[createEmbeddingProvider] Embedding server not ready after wait - will use fallback mechanisms');
    }
    // Initialize the DimensionAdapter for centralized dimension management
    // This detects dimensions from ALL tables with vector columns
    let dimensionResult = null;
    let dbDimension = null;
    try {
        const db = getDatabase();
        // Initialize DimensionAdapter - detects ALL vector columns in database
        dimensionResult = await initializeDimensionAdapter(db);
        if (dimensionResult.success && dimensionResult.canonicalDimension !== null) {
            dbDimension = dimensionResult.canonicalDimension;
            // Log comprehensive dimension detection results
            logger.info('='.repeat(60));
            logger.info('DIMENSION DETECTION COMPLETE - Database is Source of Truth');
            logger.info('='.repeat(60));
            logger.info({ canonicalDimension: dbDimension }, 'Canonical dimension (from memories table)');
            logger.info({ tablesWithVectors: dimensionResult.tables.length }, 'Tables with vector columns detected');
            // Log each table's dimension
            for (const table of dimensionResult.tables) {
                const indexInfo = table.hasIndex ? ` (${table.indexType || 'indexed'})` : ' (no index)';
                logger.info({
                    table: table.tableName,
                    column: table.columnName,
                    dimension: table.dimension ?? 'unbounded',
                    indexed: table.hasIndex
                }, `  ${table.tableName}.${table.columnName}: ${table.dimension ?? 'unbounded'}${indexInfo}`);
            }
            // Warn about inconsistencies
            if (dimensionResult.inconsistencies.length > 0) {
                logger.warn({ count: dimensionResult.inconsistencies.length }, 'DIMENSION INCONSISTENCIES DETECTED');
                for (const inc of dimensionResult.inconsistencies) {
                    logger.warn({
                        table: inc.table,
                        column: inc.column,
                        dimension: inc.dimension,
                        expected: inc.expected
                    }, `  ${inc.table}.${inc.column}: has ${inc.dimension}, expected ${inc.expected}`);
                }
            }
            else {
                logger.info('All vector columns have consistent dimensions');
            }
            logger.info('='.repeat(60));
            // Warm the projection layer cache with the database dimension
            setTargetDimension(dbDimension);
        }
        else {
            logger.warn('DimensionAdapter: Could not detect canonical dimension - will use dimension from first embedding');
            // Fallback to direct query for memories table
            try {
                const result = await db.query(`
          SELECT atttypmod FROM pg_attribute
          WHERE attrelid = 'memories'::regclass AND attname = 'embedding'
        `);
                if (result.rows.length > 0 && result.rows[0].atttypmod > 0) {
                    dbDimension = result.rows[0].atttypmod;
                    logger.info({ dbDimension }, 'Fallback: detected dimension from memories table');
                    setTargetDimension(dbDimension);
                }
            }
            catch (fallbackErr) {
                logger.debug({ error: fallbackErr }, 'Fallback dimension query failed (table may not exist yet)');
            }
        }
    }
    catch (err) {
        logger.warn({ error: err }, 'Failed to initialize DimensionAdapter - will use dimension from first embedding');
    }
    // If we got a dimension from DB, use it; otherwise LocalEmbeddingProvider will auto-detect from first embedding
    if (dbDimension) {
        logger.info({ targetDimension: dbDimension }, 'Using local standalone embeddings with DB-detected dimension');
        return new LocalEmbeddingProvider(dbDimension);
    }
    else {
        // No DB dimension yet - let LocalEmbeddingProvider query DB on first embedding
        logger.info('Using local standalone embeddings - dimension will be auto-detected from database on first use');
        return new LocalEmbeddingProvider(); // Constructor will auto-detect from DB
    }
}
// Global state for skill/codebase systems
let skillScanner = null;
let skillResourceProvider = null;
let codebaseIndexer = null;
let skillReminder = null;
// Global state for memory management
let memoryManager = null;
let embeddingOverflowHandler = null;
/**
 * Initialize Skills System
 */
async function initializeSkillsSystem(embeddingProvider) {
    const skillsConfig = loadSkillsConfig();
    if (!skillsConfig.enabled) {
        logger.info('skills system disabled');
        return;
    }
    logger.info({ skillsPath: skillsConfig.skillsPath }, 'initializing skills system...');
    try {
        // create and initialize skill scanner
        skillScanner = getSkillScanner({
            skillsPath: skillsConfig.skillsPath,
            autoReload: skillsConfig.autoReload,
            debounceMs: 500
        });
        const scanResult = await skillScanner.initialize();
        logger.info({
            totalSkills: scanResult.totalCount,
            categories: Array.from(scanResult.categories.keys()),
            autoReload: skillsConfig.autoReload
        }, 'skills scanner initialized');
        // create resource provider
        skillResourceProvider = getSkillResourceProvider(skillScanner);
        // log skill reminder
        logger.info(`\n${'-'.repeat(50)}`);
        logger.info('SKILLS LOADED:');
        for (const category of skillScanner.getCategories()) {
            const skills = skillScanner.getSkillsByCategory(category);
            logger.info(`  ${category}: ${skills.map(s => s.name).join(', ')}`);
        }
        logger.info(`${'-'.repeat(50)}\n`);
    }
    catch (error) {
        logger.error({ error }, 'failed to initialize skills system');
    }
}
/**
 * Initialize Codebase Indexer
 */
async function initializeCodebaseSystem(embeddingProvider) {
    const codebaseConfig = loadCodebaseConfig();
    if (!codebaseConfig.enabled) {
        logger.info('codebase indexer disabled');
        return;
    }
    logger.info({ codebasePath: codebaseConfig.codebasePath }, 'initializing codebase indexer...');
    try {
        // Get database for persisting files
        const db = getDatabase();
        // Wrap embedding provider with caching layer (SHA-256 hash keys for correct relevancy)
        const cachingProvider = new CachingEmbeddingProvider(embeddingProvider);
        codebaseIndexer = getCodebaseIndexer({
            codebasePath: codebaseConfig.codebasePath,
            excludePatterns: codebaseConfig.excludePatterns,
            watchForChanges: codebaseConfig.watchForChanges,
            generateEmbeddings: true
        }, cachingProvider, db);
        const stats = await codebaseIndexer.initialize();
        logger.info({
            totalFiles: stats.totalFiles,
            totalLines: stats.totalLines,
            languages: Object.keys(stats.languageBreakdown).length,
            watching: stats.isWatching
        }, 'codebase indexer initialized');
    }
    catch (error) {
        logger.error({ error }, 'failed to initialize codebase indexer');
    }
}
/**
 * Initialize Skill Reminder System
 */
async function initializeReminderSystem() {
    if (!skillScanner) {
        logger.debug('skill scanner not initialized - skipping reminder system');
        return;
    }
    logger.info('initializing skill reminder system...');
    try {
        skillReminder = getSkillReminder({
            enabled: true,
            includeFullSkillContent: true,
            includeCodebaseOverview: codebaseIndexer !== null,
            refreshIntervalMinutes: 30
        }, skillScanner, codebaseIndexer || undefined);
        await skillReminder.initialize();
        // log startup reminder
        const reminder = skillReminder.getStartupReminder();
        logger.info(reminder);
    }
    catch (error) {
        logger.error({ error }, 'failed to initialize reminder system');
    }
}
/**
 * Initialize Memory Manager with PostgreSQL Overflow
 *
 * Implements 100MB RAM limit with:
 * - 70% warning threshold
 * - 80% critical threshold (triggers PostgreSQL overflow)
 * - 90% emergency threshold (aggressive eviction)
 */
async function initializeMemoryManager() {
    // Support both SPECMEM_MEMORY_LIMIT (dashboard config) and SPECMEM_MAX_HEAP_MB (legacy)
    const maxHeapMB = parseInt(process.env['SPECMEM_MEMORY_LIMIT'] || process.env['SPECMEM_MAX_HEAP_MB'] || '100', 10);
    const warningThreshold = parseFloat(process.env['SPECMEM_MEMORY_WARNING'] || '0.7');
    const criticalThreshold = parseFloat(process.env['SPECMEM_MEMORY_CRITICAL'] || '0.8');
    const emergencyThreshold = parseFloat(process.env['SPECMEM_MEMORY_EMERGENCY'] || '0.9');
    logger.info({
        maxHeapMB,
        warningThreshold: `${warningThreshold * 100}%`,
        criticalThreshold: `${criticalThreshold * 100}%`,
        emergencyThreshold: `${emergencyThreshold * 100}%`
    }, 'initializing memory manager with RAM limits...');
    try {
        // Create memory manager with configured limits
        memoryManager = getMemoryManager({
            maxHeapBytes: maxHeapMB * 1024 * 1024,
            warningThreshold,
            criticalThreshold,
            emergencyThreshold,
            checkIntervalMs: 5000,
            maxCacheEntries: 1000
        });
        // Connect PostgreSQL overflow handler
        try {
            const db = getDatabase();
            embeddingOverflowHandler = createEmbeddingOverflowHandler(db);
            await embeddingOverflowHandler.initialize();
            memoryManager.setOverflowHandler(embeddingOverflowHandler);
            logger.info('memory manager connected to PostgreSQL overflow');
        }
        catch (error) {
            logger.warn({ error }, 'PostgreSQL overflow not available - running without persistence');
        }
        // Initialize and start monitoring
        memoryManager.initialize();
        // Log initial stats
        const stats = memoryManager.getStats();
        logger.info({
            heapUsedMB: Math.round(stats.heapUsed / 1024 / 1024),
            maxHeapMB: Math.round(stats.maxHeap / 1024 / 1024),
            usagePercent: `${(stats.usagePercent * 100).toFixed(1)}%`,
            pressureLevel: stats.pressureLevel
        }, 'memory manager initialized');
    }
    catch (error) {
        logger.error({ error }, 'failed to initialize memory manager');
    }
}
/**
 * Shutdown Memory Manager
 */
async function shutdownMemoryManager() {
    if (memoryManager) {
        logger.info('shutting down memory manager...');
        await memoryManager.shutdown();
        await resetMemoryManager();
        memoryManager = null;
        embeddingOverflowHandler = null;
        logger.info('memory manager shut down');
    }
}
/**
 * Shutdown Skills & Codebase Systems
 */
async function shutdownBrainSystems() {
    logger.info('shutting down brain systems...');
    if (skillReminder) {
        await skillReminder.shutdown();
        resetSkillReminder();
    }
    if (codebaseIndexer) {
        await codebaseIndexer.shutdown();
        resetCodebaseIndexer();
    }
    if (skillScanner) {
        await skillScanner.shutdown();
        resetSkillScanner();
    }
    logger.info('brain systems shut down');
}
/**
 * Main entry point
 */
// Global instance manager reference
let instanceManager = null;
/**
 * Initialize the instance manager for per-project tracking
 * This replaces the old cleanupStaleLocks() approach with proper per-project isolation
 */
async function initializeInstanceManager() {
    const projectPath = process.env.SPECMEM_PROJECT_PATH || process.cwd();
    // Migrate from old structure if needed
    try {
        await migrateFromOldStructure(projectPath);
    }
    catch (err) {
        logger.debug({ err }, 'Migration check failed (non-fatal)');
    }
    // Clean up any zombie instances for this project BEFORE we initialize
    try {
        const cleanup = cleanupSameProjectInstances(projectPath);
        if (cleanup.killed.length > 0) {
            logger.info({ killedPIDs: cleanup.killed, projectPath }, 'Cleaned up previous zombie instances for this project');
        }
        if (cleanup.skipped.length > 0) {
            logger.debug({ skippedPIDs: cleanup.skipped }, 'Skipped PIDs during cleanup');
        }
        if (cleanup.errors.length > 0) {
            logger.warn({ errors: cleanup.errors }, 'Some zombie instances could not be cleaned up');
        }
    }
    catch (err) {
        logger.warn({ err }, 'Failed to cleanup zombie instances (non-fatal)');
    }
    // Initialize instance manager
    instanceManager = getInstanceManager({
        projectPath,
        autoCleanup: true,
        lockStrategy: 'both',
        healthCheckIntervalMs: 30000,
    });
    const result = await instanceManager.initialize();
    if (!result.success) {
        if (result.alreadyRunning) {
            logger.warn('Another SpecMem instance is already running for this project');
            // Don't throw - allow this instance to continue but log the conflict
        }
        else if (result.error) {
            logger.warn({ error: result.error }, 'Instance manager initialization issue (non-fatal)');
        }
    }
    else {
        logger.info({
            projectPath,
            instanceDir: instanceManager.getInstanceDir(),
            pid: process.pid,
        }, 'Instance manager initialized - per-project tracking enabled');
    }
}
/**
 * Clean up stale lock files from previous runs
 * This now uses the InstanceManager for per-project instance tracking
 * IMPORTANT: Checks file age to avoid race conditions with new processes
 *
 * @deprecated Use InstanceManager.cleanupStaleLocks() instead
 */
function cleanupStaleLocks() {
    // Use the new instance manager if available
    if (instanceManager) {
        instanceManager.cleanupStaleLocks();
        return;
    }
    // Fallback to legacy behavior for backward compatibility
    const specmemDir = join(process.cwd(), '.specmem');
    if (!existsSync(specmemDir)) {
        return; // No lock dir, nothing to clean
    }
    const pidFile = join(specmemDir, 'specmem.pid');
    const sockFile = join(specmemDir, 'specmem.sock');
    const instanceFile = join(specmemDir, 'instance.json');
    // Check PID file age - don't clean if too recent (might be a new process starting)
    const MIN_AGE_MS = 10000; // 10 seconds
    if (existsSync(pidFile)) {
        try {
            const stats = statSync(pidFile);
            const pidFileAge = Date.now() - stats.mtimeMs;
            // If the PID file is very recent, skip cleanup to avoid race condition
            if (pidFileAge < MIN_AGE_MS) {
                logger.debug({ ageMs: pidFileAge }, 'PID file is too recent, skipping stale check');
                return;
            }
        }
        catch (e) {
            // Can't stat, continue with cleanup check
        }
    }
    // Check if there's a stale PID file
    if (existsSync(pidFile)) {
        try {
            const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
            // Never clean our own PID!
            if (pid === process.pid) {
                return;
            }
            // Check if the process is still running
            try {
                process.kill(pid, 0); // Signal 0 = check if process exists
                // Process exists - check if it's actually a specmem/node process
                const cmdline = execSync(`ps -p ${pid} -o comm= 2>/dev/null || echo ""`, { encoding: 'utf8' }).trim();
                if (cmdline.includes('node') || cmdline.includes('bootstrap')) {
                    // It's a node process, but is it US starting up? Check if it's very old
                    if (existsSync(instanceFile)) {
                        const instance = JSON.parse(readFileSync(instanceFile, 'utf8'));
                        const startTime = new Date(instance.startTime).getTime();
                        const ageMs = Date.now() - startTime;
                        // If it's been running for more than 1 hour and we're starting fresh, kill it
                        if (ageMs > 3600000) {
                            logger.warn({ pid, ageMs }, 'Killing very old specmem process to allow fresh start');
                            try {
                                process.kill(pid, 'SIGTERM');
                            }
                            catch (e) { /* ignore */ }
                        }
                    }
                }
            }
            catch (e) {
                // Process doesn't exist - stale lock!
                logger.info({ pid }, 'Cleaning up stale lock files from dead process');
                try {
                    unlinkSync(pidFile);
                }
                catch (e) { /* ignore */ }
                try {
                    unlinkSync(sockFile);
                }
                catch (e) { /* ignore */ }
                try {
                    unlinkSync(instanceFile);
                }
                catch (e) { /* ignore */ }
            }
        }
        catch (e) {
            // Can't read PID file - just clean up
            logger.debug('Cleaning up unreadable lock files');
            try {
                unlinkSync(pidFile);
            }
            catch (e) { /* ignore */ }
            try {
                unlinkSync(sockFile);
            }
            catch (e) { /* ignore */ }
        }
    }
    // Also clean stale socket if it exists without a PID file
    if (existsSync(sockFile) && !existsSync(pidFile)) {
        logger.info('Cleaning up orphaned socket file');
        try {
            unlinkSync(sockFile);
        }
        catch (e) { /* ignore */ }
    }
}
async function main() {
    startupLog('main() CALLED - entering main async function');
    // =========================================================================
    // ENSURE PROJECT ENVIRONMENT IS SET
    // This must happen early before any project-scoped operations
    // =========================================================================
    ensureProjectEnv();
    const projectInfo = getProjectInfo();
    startupLog(`Project path: ${projectInfo.path}`);
    startupLog(`Project hash: ${projectInfo.hashFull}`);
    startupLog(`Instance dir: ${projectInfo.instanceDir}`);
    // NOTE: cleanupStaleLocks() moved to after MCP transport connection
    // to ensure fastest possible startup time
    logger.info('Starting SpecMem MCP Server - THE BRAIN OF CLAUDE...');
    logger.info({ ...projectInfo }, 'Project environment initialized');
    startupLog('Starting SpecMem MCP Server...');
    // =========================================================================
    // PRE-FLIGHT VALIDATION (FAST - must complete in < 100ms)
    // Validates socket directories and environment variables BEFORE MCP connects.
    // Database validation is deferred to Phase 2 to not block MCP connection.
    // =========================================================================
    startupLog('Running pre-flight validation (fast checks only)...');
    let preflightResult;
    try {
        preflightResult = await quickValidation();
        if (!preflightResult.valid) {
            // Critical errors found - log and exit before MCP connects
            const errorOutput = formatValidationErrors(preflightResult);
            process.stderr.write(errorOutput);
            startupLog(`Pre-flight validation FAILED with ${preflightResult.errors.length} errors`);
            // Log each error for debugging
            for (const error of preflightResult.errors) {
                startupLog(`  ERROR [${error.code}]: ${error.message}`);
                logger.error({
                    code: error.code,
                    message: error.message,
                    details: error.details,
                    suggestion: error.suggestion,
                }, 'Startup validation error');
            }
            // Exit with the first error's code
            const exitCode = preflightResult.errors[0]?.code || EXIT_CODES.GENERAL_ERROR;
            process.exit(exitCode);
        }
        // Log warnings but continue
        if (preflightResult.warnings.length > 0) {
            startupLog(`Pre-flight validation passed with ${preflightResult.warnings.length} warnings`);
            for (const warning of preflightResult.warnings) {
                logger.warn({ warning }, 'Startup validation warning');
            }
        }
        else {
            startupLog(`Pre-flight validation passed (${preflightResult.duration}ms)`);
        }
    }
    catch (validationError) {
        // Validation itself failed - log but continue (don't block MCP connection)
        startupLog('Pre-flight validation threw an exception - continuing anyway', validationError);
        logger.error({ error: validationError }, 'Pre-flight validation failed unexpectedly');
        preflightResult = { valid: true, errors: [], warnings: [], duration: 0 };
    }
    // ==========================================================================
    // CRITICAL TIMING FIX: MCP CONNECTION MUST BE ESTABLISHED FIRST!
    // ==========================================================================
    //
    //  Code has a short timeout (~5-10s) for MCP server connections.
    // If we don't establish the stdio transport quickly,  shows:
    // "Failed to connect to MCP server"
    //
    // PREVIOUS BUG: We did heavy initialization BEFORE starting the server:
    // - Config sync (file I/O)
    // - Deploy to  (file I/O)
    // - Database init (can be 1-3s if cold)
    // - Config injection (file I/O)
    // - Embedding provider creation (DB queries)
    // All of this could take 5-10+ seconds, causing  to timeout!
    //
    // NEW APPROACH: Start MCP server IMMEDIATELY, defer everything else.
    // The server connects transport first, then initializes DB in background.
    // Tools will wait for DB if they need it.
    // ==========================================================================
    // === PHASE 1: FAST MCP CONNECTION (< 500ms target) ===
    startupLog('PHASE 1: Creating deferred embedding provider...');
    // Create minimal embedding provider stub - will be upgraded after DB init
    // Using null-safe pattern that defers to real provider once ready
    let embeddingProvider = null;
    let embeddingProviderReady = false;
    // HIGH-23 FIX: Queue for pending embedding requests instead of returning garbage
    // Requests wait for provider to be ready, with timeout to prevent indefinite hangs
    // REDUCED from 30s to 5s to fail fast and not make MCP appear unresponsive
    const EMBEDDING_PROVIDER_TIMEOUT_MS = 5000; // 5 second timeout - fail fast!
    const pendingEmbeddingQueue = [];
    // Process queued requests once provider is ready
    const processEmbeddingQueue = async () => {
        if (!embeddingProviderReady || !embeddingProvider)
            return;
        while (pendingEmbeddingQueue.length > 0) {
            const request = pendingEmbeddingQueue.shift();
            if (!request)
                continue;
            // Check if request has timed out
            const elapsed = Date.now() - request.timestamp;
            if (elapsed > EMBEDDING_PROVIDER_TIMEOUT_MS) {
                request.reject(new Error(`Embedding request timed out after ${EMBEDDING_PROVIDER_TIMEOUT_MS}ms`));
                continue;
            }
            try {
                const embedding = await embeddingProvider.generateEmbedding(request.text);
                request.resolve(embedding);
            }
            catch (err) {
                request.reject(err instanceof Error ? err : new Error(String(err)));
            }
        }
    };
    // Stub provider that queues requests until real provider is ready
    const deferredEmbeddingProvider = {
        async generateEmbedding(text) {
            // If provider is ready, use it directly
            if (embeddingProviderReady && embeddingProvider) {
                return embeddingProvider.generateEmbedding(text);
            }
            // HIGH-23 FIX: Queue the request and wait for provider to be ready
            // Instead of returning garbage placeholder data, we properly queue
            logger.debug('Embedding provider not ready yet, queueing request');
            return new Promise((resolve, reject) => {
                const timestamp = Date.now();
                pendingEmbeddingQueue.push({ text, resolve, reject, timestamp });
                // Set timeout to reject if provider doesn't become ready
                setTimeout(() => {
                    const idx = pendingEmbeddingQueue.findIndex(r => r.resolve === resolve && r.timestamp === timestamp);
                    if (idx !== -1) {
                        pendingEmbeddingQueue.splice(idx, 1);
                        reject(new Error(`Embedding service starting up - retry in a few seconds (waited ${EMBEDDING_PROVIDER_TIMEOUT_MS}ms)`));
                    }
                }, EMBEDDING_PROVIDER_TIMEOUT_MS);
            });
        },
        async generateEmbeddingsBatch(texts) {
            if (embeddingProviderReady && embeddingProvider) {
                // Use batch method if available on real provider
                if (embeddingProvider.generateEmbeddingsBatch) {
                    return embeddingProvider.generateEmbeddingsBatch(texts);
                }
                // Try EmbeddingServerManager batch socket
                try {
                    const { EmbeddingServerManager } = await import('./mcp/embeddingServerManager.js');
                    const manager = EmbeddingServerManager.getInstance();
                    if (manager && manager.generateEmbeddingsBatchViaSocket) {
                        return await manager.generateEmbeddingsBatchViaSocket(texts);
                    }
                } catch (batchErr) {
                    logger.debug({ error: String(batchErr) }, 'Batch socket failed, falling back to sequential');
                }
                // Fallback to sequential
                return Promise.all(texts.map(t => embeddingProvider.generateEmbedding(t)));
            }
            // Provider not ready - fall back to sequential with queueing
            return Promise.all(texts.map(t => deferredEmbeddingProvider.generateEmbedding(t)));
        }
    };
    // Create server with deferred embedding provider
    startupLog('Creating SpecMemServer instance...');
    const server = new SpecMemServer(deferredEmbeddingProvider);
    startupLog('SpecMemServer instance created');
    // START MCP SERVER IMMEDIATELY - establishes transport connection
    // This is the CRITICAL path - must complete in < 1 second
    startupLog('CRITICAL: About to call server.start() - this establishes MCP transport connection');
    const startTime = Date.now();
    await server.start();
    const startDuration = Date.now() - startTime;
    startupLog(`MCP SERVER STARTED in ${startDuration}ms - transport connection established!`);
    logger.info('MCP server started -  connection established!');
    // ==========================================================================
    // EARLY EMBEDDING CHECK: If socket exists and responds, mark ready NOW!
    // This allows find_memory to work IMMEDIATELY if server is already running
    // ==========================================================================
    const earlySocketPath = getEmbeddingSocketPath();
    if (existsSync(earlySocketPath)) {
        startupLog('Embedding socket exists - testing if server is already running...');
        try {
            const earlyTestResult = await new Promise((resolve) => {
                const testSocket = createConnection(earlySocketPath);
                const timeout = setTimeout(() => { testSocket.destroy(); resolve(false); }, 2000);
                testSocket.on('connect', () => { testSocket.write('{"type":"health"}\n'); });
                testSocket.on('data', () => { clearTimeout(timeout); testSocket.end(); resolve(true); });
                testSocket.on('error', () => { clearTimeout(timeout); resolve(false); });
            });
            if (earlyTestResult) {
                startupLog('FAST PATH: Embedding server already running! Creating early provider...');
                // Create minimal provider that talks directly to socket
                const socketPath = earlySocketPath;
                embeddingProvider = {
                    generateEmbedding: async (text) => {
                        return new Promise((resolve, reject) => {
                            const socket = createConnection(socketPath);
                            let buffer = '';
                            let resolved = false;
                            const timeout = setTimeout(() => {
                                if (!resolved) { resolved = true; socket.destroy(); reject(new Error('Embedding timeout')); }
                            }, 60000);
                            socket.on('connect', () => { socket.write(JSON.stringify({ text }) + '\n'); });
                            socket.on('data', (data) => {
                                buffer += data.toString();
                                let idx;
                                while ((idx = buffer.indexOf('\n')) !== -1) {
                                    if (resolved) return;
                                    const line = buffer.slice(0, idx);
                                    buffer = buffer.slice(idx + 1);
                                    try {
                                        const resp = JSON.parse(line);
                                        if (resp.error) { clearTimeout(timeout); resolved = true; socket.end(); reject(new Error(resp.error)); return; }
                                        if (resp.status === 'processing') continue;
                                        if (resp.embedding && Array.isArray(resp.embedding)) {
                                            clearTimeout(timeout); resolved = true; socket.end(); resolve(resp.embedding); return;
                                        }
                                    } catch (e) { /* ignore parse errors */ }
                                }
                            });
                            socket.on('error', (e) => { clearTimeout(timeout); if (!resolved) { resolved = true; reject(e); } });
                        });
                    },
                    generateEmbeddingsBatch: async (texts) => {
                        // Use batch socket for speed - single connection for all texts
                        try {
                            const { EmbeddingServerManager } = await import('./mcp/embeddingServerManager.js');
                            const mgr = EmbeddingServerManager.getInstance();
                            if (mgr && mgr.generateEmbeddingsBatchViaSocket) {
                                return await mgr.generateEmbeddingsBatchViaSocket(texts);
                            }
                        } catch (batchErr) {
                            logger.debug({ error: String(batchErr) }, 'Batch socket failed in early provider, falling back');
                        }
                        return Promise.all(texts.map(t => embeddingProvider.generateEmbedding(t)));
                    }
                };
                embeddingProviderReady = true;
                logger.info('EARLY EMBEDDING PROVIDER READY - find_memory will work immediately!');
                // CRITICAL: Start KYS heartbeat to keep embedding server alive!
                // Without this, the server will suicide after 90s of no heartbeat
                const { EmbeddingServerManager } = await import('./mcp/embeddingServerManager.js');
                const earlyManager = EmbeddingServerManager.getInstance();
                earlyManager.startKysHeartbeat();
                logger.info('KYS heartbeat started for early provider');
                // Process any already-queued requests
                if (pendingEmbeddingQueue.length > 0) {
                    startupLog(`Processing ${pendingEmbeddingQueue.length} early-queued requests`);
                    processEmbeddingQueue().catch(e => logger.warn({ e }, 'Early queue processing failed'));
                }
            } else {
                startupLog('Embedding socket exists but server not responding - will initialize normally');
            }
        } catch (e) {
            startupLog('Early embedding check failed (non-fatal): ' + e.message);
        }
    } else {
        startupLog('No existing embedding socket - will initialize normally');
    }
    // ==========================================================================
    // PHASE 2: DEFERRED INITIALIZATION (runs after MCP connection established)
    // ==========================================================================
    // These can take time but  is already connected and won't timeout
    startupLog('PHASE 2: Beginning deferred initialization (MCP already connected)');
    // Initialize instance manager for per-project tracking
    // This replaces the old cleanupStaleLocks() with proper project isolation
    try {
        await initializeInstanceManager();
        startupLog('Instance manager initialized - per-project tracking enabled');
    }
    catch (err) {
        logger.warn({ err }, 'Instance manager initialization failed (non-fatal), falling back to legacy cleanup');
        cleanupStaleLocks();
    }
    startupLog('Stale locks cleaned (deferred)');
    // ==========================================================================
    // EMBEDDING SERVER MANAGER - ENSURE FRESH START
    // ==========================================================================
    // CRITICAL: Initialize embedding server manager EARLY to ensure fresh start
    // This kills any old embedding servers and removes stale sockets BEFORE
    // LocalEmbeddingProvider tries to connect
    startupLog('Initializing EmbeddingServerManager for fresh start...');
    let embeddingManager = null;
    try {
        // CRITICAL FIX: Use the singleton getter so MCP tools share the same instance!
        // Previously this used `new EmbeddingServerManager()` directly, causing two separate
        // manager instances - startup had heartbeat running, tools didn't share it
        embeddingManager = getEmbeddingServerManager({
            healthCheckIntervalMs: 30000,
            // FIX: Increased from 5s to 15s - health checks during startup can take longer
            // while the model is still loading into memory. 5s was causing false negatives.
            healthCheckTimeoutMs: 15000,
            maxFailuresBeforeRestart: 3,
            restartCooldownMs: 10000,
            // FIX: Reduced from 60s to 45s to match DEFAULT_CONFIG and avoid unnecessary waiting
            // The server should be ready well within 45s; 60s just delays error detection
            startupTimeoutMs: 45000,
            maxRestartAttempts: 5,
            autoStart: true, // Auto-start the embedding server
            killStaleOnStart: true, // CRITICAL: Kill any stale processes
            maxProcessAgeHours: 1
        });
        await embeddingManager.initialize();
        logger.info('EmbeddingServerManager: Fresh embedding server started');
        startupLog('EmbeddingServerManager initialized - fresh server ready');
    }
    catch (err) {
        logger.warn({ error: err }, 'EmbeddingServerManager initialization failed (non-fatal)');
        startupLog('EmbeddingServerManager failed (non-fatal)', err);
        // LOW-32 FIX: Set explicit fallback state to indicate manager failed initialization
        // This prevents ambiguity between "not initialized yet" and "failed to initialize"
        embeddingManager = null;
        // Set an env var so downstream code knows embedding manager failed
        process.env['SPECMEM_EMBEDDING_MANAGER_FAILED'] = 'true';
    }
    // Cleanup orphaned embedding processes for THIS project
    // CRITICAL FIX: SKIP if EmbeddingServerManager is active - it already handles this!
    // The legacy cleanup was killing servers that the manager JUST started (race condition)
    if (embeddingManager && embeddingManager.isRunning) {
        startupLog('Skipping legacy orphan cleanup - EmbeddingServerManager is active');
    }
    const cleanupOrphanedEmbeddings = async () => {
        // CRITICAL: Skip cleanup if embedding manager started successfully
        if (embeddingManager && embeddingManager.isRunning) {
            return; // Manager owns the embedding server, don't kill it!
        }
        const projectPath = getProjectPath();
        const socketDir = path.join(projectPath, 'specmem', 'sockets');
        const socketPath = path.join(socketDir, 'embeddings.sock');
        const lockPath = path.join(socketDir, 'embedding.lock');
        const pidFile = path.join(socketDir, 'embedding.pid');
        try {
            // STEP 1: Kill orphaned embedding process using PID file
            if (existsSync(pidFile)) {
                try {
                    const pidContent = readFileSync(pidFile, 'utf8').trim();
                    const [oldPid, spawnTime] = pidContent.split(':').map(Number);
                    if (oldPid && !isNaN(oldPid)) {
                        // Check if process is still running
                        let isRunning = false;
                        try {
                            process.kill(oldPid, 0);
                            isRunning = true;
                        }
                        catch {
                            isRunning = false;
                        }
                        if (isRunning) {
                            startupLog(`Killing orphaned embedding server: PID ${oldPid} (spawned ${Date.now() - spawnTime}ms ago)`);
                            try {
                                process.kill(oldPid, 'SIGTERM');
                                // Wait a bit for graceful shutdown
                                await new Promise(resolve => setTimeout(resolve, 500));
                                // Force kill if still running
                                try {
                                    process.kill(oldPid, 0);
                                    process.kill(oldPid, 'SIGKILL');
                                }
                                catch { /* dead */ }
                            }
                            catch (killErr) {
                                logger.warn({ killErr, pid: oldPid }, 'Failed to kill orphaned embedding (may be already dead)');
                            }
                        }
                        // Clean up PID file regardless
                        try {
                            unlinkSync(pidFile);
                        }
                        catch { /* ignore */ }
                    }
                }
                catch (pidErr) {
                    logger.warn({ pidErr, pidFile }, 'Failed to read/process embedding PID file');
                }
            }
            // STEP 2: Clean up stale socket if not responsive
            if (existsSync(socketPath)) {
                const testAlive = () => new Promise((resolve) => {
                    const testSocket = createConnection(socketPath);
                    const timeout = setTimeout(() => { testSocket.destroy(); resolve(false); }, 2000);
                    testSocket.on('connect', () => {
                        clearTimeout(timeout);
                        testSocket.write('{"text":"test"}\n');
                    });
                    testSocket.on('data', () => { clearTimeout(timeout); testSocket.destroy(); resolve(true); });
                    testSocket.on('error', () => { clearTimeout(timeout); testSocket.destroy(); resolve(false); });
                });
                const isAlive = await testAlive();
                if (!isAlive) {
                    startupLog(`Cleaning stale embedding socket: ${socketPath}`);
                    try {
                        unlinkSync(socketPath);
                    }
                    catch { /* ignore */ }
                }
            }
            // STEP 3: Clean up stale lock files
            if (existsSync(lockPath)) {
                try {
                    const lockContent = readFileSync(lockPath, 'utf8').trim();
                    const [lockPid, lockTime] = lockContent.split(':').map(Number);
                    const lockAge = Date.now() - lockTime;
                    let pidRunning = false;
                    try {
                        process.kill(lockPid, 0);
                        pidRunning = true;
                    }
                    catch {
                        pidRunning = false;
                    }
                    if (!pidRunning || lockAge > 300000) {
                        startupLog(`Cleaning stale embedding lock: pid=${lockPid}, age=${lockAge}ms`);
                        unlinkSync(lockPath);
                    }
                }
                catch { /* ignore */ }
            }
            logger.debug({ projectPath }, 'Embedding orphan cleanup completed for project');
        }
        catch (err) {
            logger.warn({ err, projectPath }, 'Embedding cleanup failed (non-fatal)');
        }
    };
    try {
        await cleanupOrphanedEmbeddings();
        startupLog('Orphaned embeddings cleaned');
    }
    catch (err) {
        startupLog('Embedding cleanup failed (non-fatal)', err);
    }
    // Track deployment result for banner display later
    let deployResult = {
        hooksDeployed: [],
        hooksSkipped: [],
        commandsDeployed: [],
        commandsSkipped: [],
        settingsUpdated: false,
        errors: [],
        success: true,
        version: '0.0.0'
    };
    // --- Config Sync (deferred, non-blocking) ---
    startupLog('Config sync starting...');
    try {
        await syncConfigToUserFile(config);
        logger.info('[ConfigSync] Config synced to ~/.specmem/config.json');
        startupLog('Config sync complete');
    }
    catch (error) {
        logger.warn('[ConfigSync] Failed to sync config (non-fatal):', error);
        startupLog('Config sync failed (non-fatal)', error);
    }
    // --- Deploy Hooks and Commands (deferred, non-blocking) ---
    startupLog('Deploy to  starting...');
    try {
        deployResult = await deployTo();
        const totalDeployed = deployResult.hooksDeployed.length + deployResult.commandsDeployed.length;
        const totalSkipped = deployResult.hooksSkipped.length + deployResult.commandsSkipped.length;
        if (totalDeployed > 0) {
            logger.info('[DeployTo] Deployed to :', {
                version: deployResult.version,
                hooksDeployed: deployResult.hooksDeployed.length,
                hooksSkipped: deployResult.hooksSkipped.length,
                commandsDeployed: deployResult.commandsDeployed.length,
                commandsSkipped: deployResult.commandsSkipped.length,
                settingsUpdated: deployResult.settingsUpdated
            });
        }
        else if (totalSkipped > 0) {
            logger.info('[DeployTo] All files up-to-date', {
                version: deployResult.version,
                filesChecked: totalSkipped
            });
        }
        else {
            logger.info('[DeployTo] No files to deploy');
        }
        if (deployResult.errors.length > 0) {
            logger.warn('[DeployTo] Deployment warnings:', deployResult.errors);
        }
        startupLog('Deploy to  complete');
    }
    catch (error) {
        logger.warn('[DeployTo] Failed to deploy (non-fatal):', error);
        startupLog('Deploy to  failed (non-fatal)', error);
    }
    // --- Database Initialization (critical but deferred) ---
    // Note: Server already initialized DB via its own deferred init
    // This is a safety check / upgrade path
    startupLog('Database initialization starting...');
    logger.info('[Database] Ensuring database connection is ready...');
    try {
        const db = getDatabase(config.database);
        // Check if already initialized by server, if not initialize
        if (!db.isConnected()) {
            startupLog('Database not connected, initializing...');
            await db.initialize();
        }
        logger.info('[Database] Database ready');
        startupLog('Database ready');
        // yooo THIS IS THE ROOT CAUSE FIX!
        // The watcher needs getDbContext() which requires initializeTheBigBrainDb()
        // Without this, watcher fails silently and we lose file watching capability
        startupLog('Initializing BigBrain database layer...');
        try {
            await initializeTheBigBrainDb(config.database, false); // migrations already run by db.initialize()
            logger.info('[Database] BigBrain database layer initialized - watchers can now function');
            startupLog('BigBrain database layer ready');
        }
        catch (bigBrainErr) {
            // nah fr this is critical - watcher won't work without it
            logger.error({ error: bigBrainErr }, '[Database] Failed to initialize BigBrain layer (watcher will be disabled)');
            startupLog('BigBrain database layer FAILED', bigBrainErr);
            // Don't throw - let the server continue, watcher will just be disabled
        }
        // --- Full Validation (deferred - includes database checks) ---
        // Now that DB is connected, run full validation to catch any remaining issues
        startupLog('Running full validation (including database)...');
        try {
            const fullResult = await fullValidation();
            if (!fullResult.valid) {
                // Database validation failed - log errors but don't exit
                // (MCP is already connected, tools may still work partially)
                const errorOutput = formatValidationErrors(fullResult);
                process.stderr.write(errorOutput);
                startupLog(`Full validation FAILED with ${fullResult.errors.length} errors (non-fatal)`);
                for (const error of fullResult.errors) {
                    logger.error({
                        code: error.code,
                        message: error.message,
                        details: error.details,
                        suggestion: error.suggestion,
                    }, 'Database validation error (non-fatal)');
                }
            }
            else {
                startupLog(`Full validation passed (${fullResult.duration}ms)`);
                logger.info({ duration: fullResult.duration }, 'Full startup validation passed');
            }
            // Log any additional warnings from full validation
            if (fullResult.warnings.length > 0) {
                for (const warning of fullResult.warnings) {
                    if (!preflightResult.warnings.includes(warning)) {
                        logger.warn({ warning }, 'Database validation warning');
                    }
                }
            }
        }
        catch (fullValidationError) {
            startupLog('Full validation threw an exception (non-fatal)', fullValidationError);
            logger.warn({ error: fullValidationError }, 'Full validation failed unexpectedly (non-fatal)');
        }
    }
    catch (error) {
        logger.error('[Database] Failed to initialize database:', error);
        startupLog('DATABASE INITIALIZATION FAILED (fatal)', error);
        throw error; // Fatal - cannot continue without database
    }
    // --- Config Injection (deferred, non-blocking) ---
    try {
        const injectionResult = await injectConfig();
        logger.info('[ConfigInjector] Result:', {
            settingsUpdated: injectionResult.settingsUpdated,
            hooksCopied: injectionResult.hooksCopied,
            commandsCopied: injectionResult.commandsCopied,
            permissionsAdded: injectionResult.permissionsAdded,
            alreadyConfigured: injectionResult.alreadyConfigured
        });
    }
    catch (error) {
        logger.warn('[ConfigInjector] Config injection failed (non-fatal):', error);
    }
    // --- Real Embedding Provider (now DB is ready) ---
    embeddingProvider = await createEmbeddingProvider();
    embeddingProviderReady = true;
    logger.info('Real embedding provider ready - upgrading from stub');
    // HIGH-23 FIX: Process any queued embedding requests now that provider is ready
    if (pendingEmbeddingQueue.length > 0) {
        logger.info(`Processing ${pendingEmbeddingQueue.length} queued embedding requests`);
        await processEmbeddingQueue();
    }
    // Wire embedding provider to DimensionAdapter
    try {
        const adapter = getDimensionAdapter();
        adapter.setEmbeddingProvider(embeddingProvider);
        logger.info('DimensionAdapter: Connected to embedding provider');
    }
    catch (error) {
        logger.debug({ error }, 'Could not connect DimensionAdapter (non-fatal)');
    }
    // Server is already started, log that initialization is continuing
    logger.info('MCP server running - continuing background initialization...');
    // === INITIALIZE MEMORY MANAGER ===
    // Must be initialized early to monitor memory from the start
    await initializeMemoryManager();
    // === INITIALIZE BRAIN SYSTEMS ===
    // 1. Initialize Skills System (drag & drop .md files)
    await initializeSkillsSystem(embeddingProvider);
    // 2. Initialize Codebase Indexer (knows your whole project)
    await initializeCodebaseSystem(embeddingProvider);
    // 3. Initialize Reminder System (never forget skills)
    await initializeReminderSystem();
    // === INITIALIZE WATCHERS ===
    // initialize file watcher if enabled (PROJECT-SCOPED - only watches current project)
    let watcherInitialized = false;
    try {
        // Register cleanup handlers for graceful shutdown
        registerCleanupHandlers();
        const watcher = await initializeWatcher(embeddingProvider);
        watcherInitialized = watcher !== null;
        if (watcherInitialized) {
            logger.info('PROJECT-SCOPED file watcher enabled and running');
        }
    }
    catch (error) {
        logger.error({ error }, 'failed to initialize file watcher - continuing without it');
    }
    // initialize  session watcher if enabled
    let sessionWatcherInitialized = false;
    try {
        const sessionWatcher = await initializeSessionWatcher(embeddingProvider);
        sessionWatcherInitialized = sessionWatcher !== null;
        if (sessionWatcherInitialized) {
            logger.info(' session watcher enabled and running');
        }
    }
    catch (error) {
        logger.error({ error }, 'failed to initialize session watcher - continuing without it');
    }
    // === STARTUP INDEXING - ENSURE EVERYTHING IS READY ===
    // Check if codebase is indexed and sessions are extracted
    // Triggers background indexing/extraction if needed
    // This ensures  starts with a fully indexed codebase and extracted sessions
    try {
        startupLog('Running startup indexing checks...');
        const indexingResult = await runStartupIndexing(embeddingProvider, {
            skipCodebase: false, // Always check codebase
            skipSessions: false, // Always check sessions
            force: false // Only reindex if stale or missing
        });
        if (indexingResult.codebaseStatus.triggeredIndexing) {
            startupLog('Background codebase indexing triggered');
        }
        if (indexingResult.sessionStatus.triggeredExtraction) {
            startupLog('Background session extraction triggered');
        }
        logger.info({
            codebase: indexingResult.codebaseStatus,
            sessions: indexingResult.sessionStatus
        }, 'Startup indexing checks complete');
    }
    catch (error) {
        logger.warn({ error }, 'Startup indexing checks failed (non-fatal) - continuing');
        startupLog('Startup indexing checks failed (non-fatal)', error);
    }
    // === ALLOCATE UNIQUE PORTS FOR THIS INSTANCE ===
    // Uses project path hash for deterministic allocation with conflict detection
    // CRITICAL: Must use SPECMEM_PROJECT_PATH (set by bootstrap.cjs) for per-instance isolation
    // This ensures each  session gets unique ports based on project directory
    const projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
    logger.info({ projectPath, projectHash: process.env['SPECMEM_PROJECT_HASH'] }, 'Using project path for port allocation');
    let allocatedPorts = null;
    try {
        allocatedPorts = await allocatePorts({
            projectPath: projectPath,
            verifyAvailability: true,
            persistAllocation: true
        });
        // Update global port allocation
        setAllocatedPorts(allocatedPorts);
        logger.info({
            dashboard: allocatedPorts.dashboard,
            coordination: allocatedPorts.coordination,
            postgres: allocatedPorts.postgres,
            projectPath: allocatedPorts.projectPath,
            verified: allocatedPorts.verified
        }, 'Port allocation complete');
        // Register ports with instance manager for global tracking
        if (instanceManager && instanceManager.isInitialized()) {
            instanceManager.registerInstance({
                dashboard: allocatedPorts.dashboard,
                coordination: allocatedPorts.coordination,
                postgres: allocatedPorts.postgres,
            });
            logger.debug('Ports registered with instance manager');
        }
    }
    catch (error) {
        logger.warn({ error }, 'Port allocation failed, using defaults from environment');
    }
    // === CONFIGURE LAZY COORDINATION SERVER ===
    // The coordination server is now lazy - it only starts when team features are first used
    // This saves resources when team member coordination is not needed
    // Use allocated port or fall back to project-hash-derived port from portAllocator
    const { getDashboardPort: getDashPort, getCoordinationPort: getCoordPort } = await import('./utils/portAllocator.js');
    const coordinationPort = (allocatedPorts?.coordination ??
        parseInt(process.env['SPECMEM_COORDINATION_PORT'] || '', 10)) || getCoordPort();
    const coordinationHost = process.env['SPECMEM_COORDINATION_HOST'] || '127.0.0.1';
    const coordinationEnabled = process.env['SPECMEM_COORDINATION_ENABLED'] !== 'false';
    const coordinationMaxRetries = parseInt(process.env['SPECMEM_COORDINATION_MAX_RETRIES'] || '3', 10);
    // Configure the lazy coordination server (but don't start it yet)
    if (coordinationEnabled) {
        configureLazyCoordinationServer({
            port: coordinationPort,
            host: coordinationHost,
            maxPortAttempts: 10,
            maxStartupRetries: coordinationMaxRetries,
            retryDelayMs: 1000
        });
        logger.info({
            coordinationPort,
            coordinationHost,
            maxRetries: coordinationMaxRetries
        }, 'Coordination server configured for lazy initialization (will start on first team feature use)');
    }
    else {
        disableLazyCoordinationServer();
        logger.info('Coordination server disabled via SPECMEM_COORDINATION_ENABLED=false');
    }
    // Track coordination availability for status reporting
    // Note: coordinationAvailable now means "can be started" rather than "is running"
    const coordinationAvailable = coordinationEnabled;
    // === INITIALIZE DASHBOARD SERVER ===
    let dashboardServer = null;
    let dashboardAvailable = false;
    let actualDashboardPort = null;
    // Use allocated port or fall back to project-hash-derived port from portAllocator
    const dashboardPort = (allocatedPorts?.dashboard ??
        parseInt(process.env['SPECMEM_DASHBOARD_PORT'] || '', 10)) || getDashPort();
    const dashboardHost = process.env['SPECMEM_DASHBOARD_HOST'] || '127.0.0.1';
    const dashboardEnabled = process.env['SPECMEM_DASHBOARD_ENABLED'] !== 'false';
    const dashboardMaxRetries = parseInt(process.env['SPECMEM_DASHBOARD_MAX_RETRIES'] || '3', 10);
    // Use centralized password module - supports SPECMEM_PASSWORD (unified) and legacy vars
    const dashboardPassword = getPassword();
    // Warn if using default password (security concern in production)
    if (isUsingDefaultPassword() && dashboardEnabled) {
        logger.warn('Using default password - consider setting SPECMEM_PASSWORD or SPECMEM_DASHBOARD_PASSWORD for production');
    }
    if (dashboardEnabled) {
        // Retry loop with exponential backoff
        for (let attempt = 1; attempt <= dashboardMaxRetries; attempt++) {
            try {
                dashboardServer = getDashboardServer({
                    port: dashboardPort,
                    host: dashboardHost,
                    password: dashboardPassword,
                    coordinationPort: coordinationPort, // Coordination server starts lazily, use configured port
                    maxPortAttempts: 10,
                    maxStartupRetries: 2,
                    retryDelayMs: 1000
                });
                // Connect dashboard to brain systems
                try {
                    dashboardServer.setDatabase(getDatabase());
                }
                catch (e) {
                    logger.debug({ error: e }, 'database not ready for dashboard connection');
                }
                // Set embedding provider so HTTP API can use REAL MCP tool semantic search!
                dashboardServer.setEmbeddingProvider(embeddingProvider);
                if (skillScanner) {
                    dashboardServer.setSkillScanner(skillScanner);
                }
                if (codebaseIndexer) {
                    dashboardServer.setCodebaseIndexer(codebaseIndexer);
                }
                await dashboardServer.start();
                actualDashboardPort = dashboardServer.getActualPort();
                dashboardAvailable = true;
                logger.info({
                    port: actualDashboardPort,
                    configuredPort: dashboardPort,
                    host: dashboardHost,
                    url: `http://${dashboardHost}:${actualDashboardPort}`,
                    attempt
                }, 'CSGO-themed dashboard server started - TACTICAL OPS READY');
                break;
            }
            catch (error) {
                logger.warn({
                    error: error instanceof Error ? error.message : String(error),
                    attempt,
                    maxRetries: dashboardMaxRetries
                }, 'dashboard server startup attempt failed');
                // Reset for next attempt
                try {
                    await resetDashboardServer();
                }
                catch (resetError) {
                    logger.debug({ resetError }, 'error resetting dashboard server');
                }
                dashboardServer = null;
                // Wait before retry with exponential backoff (1s, 2s, 4s...)
                if (attempt < dashboardMaxRetries) {
                    const delay = 1000 * Math.pow(2, attempt - 1);
                    logger.info({ delayMs: delay }, 'waiting before dashboard retry');
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        if (!dashboardAvailable) {
            logger.error({
                dashboardPort,
                dashboardHost,
                maxRetries: dashboardMaxRetries
            }, 'DASHBOARD SERVER UNAVAILABLE - web UI will not be accessible');
        }
    }
    else {
        logger.info('dashboard server disabled via SPECMEM_DASHBOARD_ENABLED=false');
    }
    // handle shutdown signals gracefully
    const gracefulShutdown = async () => {
        logger.info('shutting down gracefully...');
        // Import timer registry for cleanup
        const { clearAllTimers } = await import('./utils/timerRegistry.js');
        // Clear all timers FIRST to prevent new work from being scheduled
        const clearedTimers = clearAllTimers();
        logger.info({ clearedTimers }, 'cleared all registered timers');
        // shutdown brain systems
        await shutdownBrainSystems();
        // shutdown memory manager
        await shutdownMemoryManager();
        // shutdown watchers
        if (watcherInitialized) {
            await shutdownWatcher();
        }
        if (sessionWatcherInitialized) {
            await shutdownSessionWatcher();
        }
        // shutdown coordination server (lazy - may or may not have been started)
        await executeLazyShutdownHandlers();
        await resetLazyCoordinationServer();
        // shutdown dashboard server
        if (dashboardServer) {
            await resetDashboardServer();
        }
        // shutdown instance manager (releases locks, unregisters from global registry)
        if (instanceManager) {
            instanceManager.shutdown();
            logger.info('Instance manager shutdown complete');
        }
        // shutdown embedding server manager (kills embedding server gracefully)
        // CRITICAL: This prevents orphaned frankenstein-embeddings.py processes!
        if (embeddingManager) {
            await embeddingManager.shutdown();
            logger.info('Embedding server manager shutdown complete');
        }
        // shutdown embedding provider (kills Python embedding process if running)
        // Note: embeddingManager now handles this, but kept for backward compat
        if (embeddingProvider && typeof embeddingProvider.shutdown === 'function') {
            await embeddingProvider.shutdown();
            logger.info('Embedding provider shutdown complete');
        }
        // then shutdown server
        await server.shutdown();
        process.exit(0);
    };
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    // SIGUSR1 handler for hot reload - triggers graceful restart
    // When code is updated, send SIGUSR1 to trigger graceful shutdown
    //  will respawn the process with the new code
    process.on('SIGUSR1', async () => {
        logger.info('SIGUSR1 received - initiating graceful restart for hot reload');
        startupLog('SIGUSR1 received - hot reload triggered');
        await gracefulShutdown();
        // gracefulShutdown() calls process.exit(0), so  will respawn with new code
    });
    // handle uncaught errors - SELF-HEALING MODE
    // Track recent errors to detect crash loops
    let recentErrors = [];
    const MAX_ERRORS_BEFORE_EXIT = 10;
    const ERROR_WINDOW_MS = 60000; // 1 minute

    process.on('uncaughtException', (error) => {
        // Log but don't crash for known non-fatal errors
        const errMsg = error?.message || String(error);
        const isFatal = errMsg.includes('EADDRINUSE') ||
                        errMsg.includes('ENOMEM') ||
                        errMsg.includes('heap') ||
                        errMsg.includes('stack');

        logger.error({ error, isFatal }, 'Uncaught exception - attempting recovery');

        // Track error frequency
        recentErrors.push(Date.now());
        recentErrors = recentErrors.filter(t => Date.now() - t < ERROR_WINDOW_MS);

        if (isFatal || recentErrors.length >= MAX_ERRORS_BEFORE_EXIT) {
            logger.fatal({ error, recentErrorCount: recentErrors.length }, 'Fatal error or error loop detected - exiting');
            process.exit(1);
        }
        // Non-fatal: log and continue (MCP stays alive)
        startupLog(`Non-fatal uncaught exception (${recentErrors.length}/${MAX_ERRORS_BEFORE_EXIT}): ${errMsg}`);
    });

    process.on('unhandledRejection', (reason) => {
        // SELF-HEALING: Log but DON'T exit for promise rejections
        // These are usually timeout/network errors that can be safely ignored
        const reasonStr = reason instanceof Error ? reason.message : String(reason);
        logger.warn({ reason: reasonStr }, 'Unhandled promise rejection - continuing (MCP stays alive)');
        startupLog(`Unhandled rejection (non-fatal): ${reasonStr.slice(0, 200)}`);
        // Don't exit - let MCP continue serving
    });
    // Server already started at the beginning for fast MCP connection
    // Now everything is initialized and ready!
    // Final status log with memory stats
    const memStats = memoryManager?.getStats();
    // Use getDashboardUrl helper for proper host handling (0.0.0.0 -> localhost for display)
    const dashboardUrl = dashboardAvailable && actualDashboardPort
        ? getDashboardUrl(dashboardHost, actualDashboardPort)
        : null;
    // Get lazy coordination server status for logging
    const coordStatus = getLazyCoordinationServerStatus();
    logger.info({
        skillsEnabled: skillScanner !== null,
        skillCount: skillScanner?.getAllSkills().length ?? 0,
        codebaseEnabled: codebaseIndexer !== null,
        codebaseFiles: codebaseIndexer?.getStats().totalFiles ?? 0,
        watcherEnabled: watcherInitialized,
        rootPath: config.watcher.rootPath,
        sessionWatcherEnabled: sessionWatcherInitialized,
        claudeDir: config.sessionWatcher.claudeDir ?? '~/.claude',
        coordinationServerEnabled: coordinationAvailable,
        coordinationServerLazy: true, // Now uses lazy initialization
        coordinationServerRunning: coordStatus.running,
        coordinationPort: coordStatus.port ?? coordinationPort,
        dashboardEnabled: dashboardAvailable,
        dashboardPort: actualDashboardPort,
        dashboardConfiguredPort: dashboardPort,
        dashboardUrl,
        memoryManagerEnabled: memoryManager !== null,
        memoryHeapUsedMB: memStats ? Math.round(memStats.heapUsed / 1024 / 1024) : null,
        memoryMaxHeapMB: memStats ? Math.round(memStats.maxHeap / 1024 / 1024) : null,
        memoryPressureLevel: memStats?.pressureLevel ?? 'unknown'
    }, 'SpecMem server fully initialized - THE BRAIN IS ALIVE');
    startupLog('SpecMem server FULLY INITIALIZED - all components ready');
    // === DISPLAY SPECMEM LOADED BANNER ===
    // Show a nice banner in  Code CLI
    displayLoadedBanner(deployResult, dashboardUrl);
    startupLog('main() COMPLETE - server running and waiting for requests');
}
// run if this is the main module
startupLog('All imports complete - calling main()');
main().catch((error) => {
    startupLog('main() REJECTED with error', error);
    logger.fatal({ error }, 'Failed to start SpecMem server');
    process.exit(1);
});
//# sourceMappingURL=index.js.map