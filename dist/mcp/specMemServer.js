#!/usr/bin/env node
/**
 * SpecMem - Speculative Memory MCP Server
 *
 * yo shoutout to doobidoo/mcp-memory-service for the inspo
 * we took their SQLite version and made it POSTGRESQL BEAST MODE
 * - hardwicksoftwareservices
 *
 * this thing hits different fr fr - semantic search, dream-inspired
 * consolidation, and postgresql go crazy together no cap
 */
// ============================================================================
// STARTUP LOGGING - Debug MCP connection issues
// Uses project-isolated path: /tmp/specmem-${PROJECT_HASH}/mcp-startup.log
// ============================================================================
import { existsSync, mkdirSync } from 'fs';
import { appendFile, writeFile } from 'fs/promises';
import * as path from 'path';
// DEBUG LOGGING - only enabled when SPECMEM_DEBUG=1
const __debugLog = process.env['SPECMEM_DEBUG'] === '1'
    ? (...args) => console.error('[DEBUG]', ...args) // stderr, not stdout!
    : () => { };
// Compute project directory name early for log isolation (READABLE!)
const __projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
const __projectDirName = process.env['SPECMEM_PROJECT_DIR_NAME'] ||
    path.basename(__projectPath)
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'default';
const __projectTmpDir = `/tmp/specmem-${__projectDirName}`;
// Ensure project tmp directory exists
try {
    if (!existsSync(__projectTmpDir)) {
        mkdirSync(__projectTmpDir, { recursive: true, mode: 0o755 });
    }
}
catch (mkdirErr) {
    if (mkdirErr.code === 'EACCES' || mkdirErr.code === 'EPERM') {
        console.error('\x1b[31m\x1b[1m  Hey, I need sudo! SpecMem can\'t create directories without proper permissions.\x1b[0m');
        console.error(`\x1b[31m  Failed path: ${__projectTmpDir}\x1b[0m`);
        console.error('\x1b[31m  Run with: sudo npx specmem-hardwicksoftware\x1b[0m');
        process.exit(1);
    }
    // Log at debug level - directory creation can fail if race condition
    if (process.env.SPECMEM_DEBUG === 'true') {
        console.error(`[DEBUG] Failed to create tmp dir: ${mkdirErr}`);
    }
}
const STARTUP_LOG_PATH = `${__projectTmpDir}/mcp-startup.log`;
function startupLog(msg, error) {
    const timestamp = new Date().toISOString();
    const pid = process.pid;
    let logLine = `${timestamp} [PID:${pid}] [specMemServer.ts] ${msg}\n`;
    if (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const errStack = error instanceof Error ? error.stack : undefined;
        logLine += `${timestamp} [PID:${pid}] [specMemServer.ts] ERROR: ${errMsg}\n`;
        if (errStack) {
            logLine += `${timestamp} [PID:${pid}] [specMemServer.ts] STACK: ${errStack}\n`;
        }
    }
    appendFile(STARTUP_LOG_PATH, logLine).catch(() => {
        // fire and forget - startup logging shouldnt block the event loop
    });
}
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createToolRegistry } from './toolRegistry.js';
import { MCPProtocolHandler } from './mcpProtocolHandler.js';
import { getDatabase } from '../database.js';
import { initTeamCommsDB } from './tools/teamComms.js';
import { config, getEmbeddingSocketPath } from '../config.js';
import { logger } from '../utils/logger.js';
import { reportProgress, reportComplete, reportError, setMcpServer as setProgressMcpServer } from '../utils/progressReporter.js';
import { createCommandHandler, getCommandsResource, getCommandHelpResource, getCommandExecutorToolDefinition } from '../commands/index.js';
// Skills system imports
import { getSkillScanner } from '../skills/skillScanner.js';
import { getSkillResourceProvider } from '../skills/skillsResource.js';
import { getSkillReminder } from '../reminders/skillReminder.js';
// Command loader - load command .md files as MCP prompts
import { getCommandLoader } from '../commands/commandLoader.js';
// CLI Notifications - centralized notification system
import { getDashboardUrl } from './cliNotifications.js';
// Resilient transport for connection health monitoring and graceful shutdown
import { getResilientTransport, resetResilientTransport, ConnectionState } from './resilientTransport.js';
// HR-6: Hot Reload Manager for tracking active tool calls during reload
// This enables safe hot reload by ensuring no tool calls are in flight
import { getHotReloadManager } from './hotReloadManager.js';
import { wrapToolResponse, compressHumanReadableFormat } from '../services/ResponseCompactor.js';
// Health Monitor - centralized health monitoring for all MCP components
import { getHealthMonitor, resetHealthMonitor, ComponentHealth } from './healthMonitor.js';
// Embedding Server Lifecycle Manager - manages embedding server process
import { getEmbeddingServerManager, resetEmbeddingServerManager } from './embeddingServerManager.js';
// Mini COT Server Lifecycle Manager - manages Mini COT model service
import { getMiniCOTServerManager, resetMiniCOTServerManager } from './miniCOTServerManager.js';
// Map cleanup utility for stale entry prevention
import { setupMapCleanupWithEmbeddedTime } from '../utils/mapCleanup.js';
const _SERVER_CACHE_BY_PROJECT = new Map();
// Cleanup stale server cache entries after 30 min inactivity
setupMapCleanupWithEmbeddedTime(_SERVER_CACHE_BY_PROJECT, {
    staleThresholdMs: 30 * 60 * 1000,
    checkIntervalMs: 5 * 60 * 1000,
    logPrefix: '[ServerCache]'
});
/**
 * Get project-scoped server cache stats
 */
function getServerCache() {
    const projectPath = __projectPath;
    if (!_SERVER_CACHE_BY_PROJECT.has(projectPath)) {
        _SERVER_CACHE_BY_PROJECT.set(projectPath, {
            hitCount: 0,
            missCount: 0,
            lastAccessTime: Date.now()
        });
    }
    const cache = _SERVER_CACHE_BY_PROJECT.get(projectPath);
    cache.lastAccessTime = Date.now();
    return cache;
}
// Legacy export for backwards compatibility - proxies to project-scoped cache
const _SERVER_CACHE = {
    get hitCount() { return getServerCache().hitCount; },
    set hitCount(v) { getServerCache().hitCount = v; },
    get missCount() { return getServerCache().missCount; },
    set missCount(v) { getServerCache().missCount = v; },
    get lastAccessTime() { return getServerCache().lastAccessTime; },
    set lastAccessTime(v) { getServerCache().lastAccessTime = v; }
};
/**
 * SpecMem MCP Server - the main event fr fr
 *
 * handles all the claude code integration like a champ
 * stdio transport go brrrr for that sweet sweet IPC
 */
export class SpecMemServer {
    server;
    db;
    toolRegistry;
    protocolHandler;
    commandHandler;
    startTime;
    toolCallCount = 0;
    lastError = null;
    embeddingProvider;
    resilientTransport = null;
    isShuttingDown = false;
    // HR-6: Hot reload manager for tracking active tool calls
    hotReloadManager = null;
    // Centralized health monitor for all MCP components
    healthMonitor = null;
    // Embedding server lifecycle manager - ensures embedding is ALWAYS available
    embeddingServerManager = null;
    // Mini COT server lifecycle manager - optional semantic analysis service
    miniCOTServerManager = null;
    constructor(embeddingProvider) {
        this.embeddingProvider = embeddingProvider;
        this.startTime = new Date();
        // server setup go crazy
        this.server = new Server({
            name: 'specmem',
            version: '1.0.0'
        }, {
            capabilities: {
                // CRITICAL FIX: Explicitly declare tool capabilities with listChanged
                // This tells  that our tool list can change dynamically and
                // it should respect sendToolListChanged() notifications
                tools: {
                    listChanged: true // Signal we support dynamic tool list updates
                },
                // we ready for resources and prompts too when claude needs em
                resources: {
                    listChanged: true // Signal we support dynamic resource list updates
                },
                prompts: {
                    listChanged: true // Signal we support dynamic prompt list updates
                },
                // logging enabled so we can announce ourselves to  fr fr
                logging: {}
            }
        });
        // setup the oninitialized callback to announce ourselves and signal readiness
        // This is called when the MCP protocol handshake completes (initialize/initialized)
        // NOTE: The MCP SDK supports async oninitialized callbacks, so we use async/await
        this.server.oninitialized = async () => {
            const timestamp = new Date().toISOString();
            // Enable progress reporter to use MCP sendLoggingMessage (visible in  Code!)
            setProgressMcpServer(this.server);
            // DEBUG: Log to startup file for reliable debugging
            startupLog('oninitialized callback fired - MCP handshake complete');
            // DEBUG: Log with high visibility that the initialized notification was received
            logger.info({ timestamp, event: 'HANDSHAKE_INITIALIZED' }, '[MCP DEBUG] Received initialized notification from  - handshake complete');
            // Write readiness signal to stderr for any process monitors
            // This is critical for debugging - it shows up in  Code's stderr logs
            process.stderr.write(`[SPECMEM DEBUG ${timestamp}] oninitialized callback fired - MCP handshake complete\n`);
            // Record activity on the resilient transport (if initialized)
            if (this.resilientTransport) {
                this.resilientTransport.recordActivity();
            }
            // CRITICAL FIX: Notify  that tools list is ready
            // This triggers  to re-fetch the tools list via ListToolsRequest
            // Without this,  may cache an empty tool list from early handshake
            startupLog('About to call notifyToolListReady() to trigger tools/list refresh');
            logger.info({ timestamp, event: 'HANDSHAKE_NOTIFY_TOOLS' }, '[MCP DEBUG] About to call notifyToolListReady() to trigger tools/list refresh');
            // IMPORTANT: Await the notification to ensure it's sent before continuing
            // This ensures proper sequencing of the handshake
            try {
                await this.notifyToolListReady();
                startupLog('Tool list notification sent successfully');
                logger.info({ timestamp, event: 'HANDSHAKE_NOTIFY_COMPLETE' }, '[MCP DEBUG] Tool list notification complete');
            }
            catch (notifyErr) {
                const error = notifyErr instanceof Error ? notifyErr : new Error(String(notifyErr));
                startupLog('FAILED to send tool list notification', notifyErr);
                logger.error({ timestamp, event: 'HANDSHAKE_NOTIFY_ERROR', error: error.message }, '[MCP DEBUG] Failed to notify tool list - tools may not be available');
                process.stderr.write(`[SPECMEM ERROR ${timestamp}] Tool notification failed: ${error.message}\n`);
            }
            // Send the startup announcement to
            startupLog('Calling announceToOnStartup()');
            this.announceToOnStartup();
            // Auto-start Codebook Learner (resource-capped background service)
            this._startCodebookLearner();
        };
        // get that db connection no cap
        this.db = getDatabase(config.database);
        // registry got all our goofy tools registered
        this.toolRegistry = createToolRegistry(this.db, embeddingProvider);
        // protocol handler do be handling protocols tho
        this.protocolHandler = new MCPProtocolHandler(this.toolRegistry);
        // command handler for slash commands - doobidoo style
        this.commandHandler = createCommandHandler(this.db, embeddingProvider);
        this.setupHandlers();
        this.setupResourceHandlers();
        this.setupErrorHandling();
        logger.info('SpecMem MCP Server initialized - ready to remember some stuff fr fr');
    }
    // ═══════════════════════════════════════════════════════════════════════
    // CODEBOOK LEARNER - Auto-start background service
    // Resource-capped: 500MB RAM, 5% CPU per core
    // Runs learning cycles every 5 min when misses accumulate
    // ═══════════════════════════════════════════════════════════════════════
    _startCodebookLearner() {
        const LEARN_INTERVAL_MS = 60 * 1000; // Check every 60s — constant low-resource crawl
        const MIN_MISSES_TO_LEARN = 3; // 3 unique misses = trigger (was 10)
        let learnerInstance = null;
        let isLearning = false;

        const runCycle = async () => {
            if (isLearning) return;
            try {
                // Lazy load CJS module
                if (!learnerInstance) {
                    const { createRequire } = await import('module');
                    const require = createRequire(import.meta.url);
                    const { CodebookLearner } = require('../services/codebookLearner.cjs');
                    learnerInstance = new CodebookLearner(process.cwd());
                    learnerInstance.startKYSWatchdog(); // KYS: pause server when Claude dies
                    // Pre-start translate server (lazy model load, low resource)
                    learnerInstance.start().then(ok => {
                        if (ok) logger.info('[CodebookLearner] Translate server pre-started');
                    }).catch(() => {});
                    logger.info('[CodebookLearner] Initialized + KYS watchdog active (500MB RAM / 5% CPU cap)');
                }

                // Step 0: ALWAYS fix mismatches first (even if no new misses)
                const mismatches = learnerInstance.getMismatchFreqs();
                if (mismatches.size > 0) {
                    isLearning = true;
                    const fixResult = await learnerInstance.fixMismatches({ stream: false });
                    if (fixResult.fixed > 0 || fixResult.removed > 0) {
                        logger.info(fixResult, '[CodebookLearner] Mismatches auto-patched');
                    }
                }

                // Check if enough misses accumulated for learning pass
                const freqs = learnerInstance.getMissFreqs();
                const candidates = [...freqs.entries()].filter(([, c]) => c >= 2).length;
                if (candidates < MIN_MISSES_TO_LEARN) {
                    isLearning = false;
                    return;
                }

                isLearning = true;
                logger.info({ candidates }, '[CodebookLearner] Learning cycle starting');

                // Step 2: Dictionary pass (instant, no server needed)
                const dictResult = await learnerInstance.learnFromDictionaries({ forceAll: false, stream: false });
                if (dictResult.added > 0) {
                    logger.info({ added: dictResult.added }, '[CodebookLearner] Dictionary entries added');
                }

                // Step 3: Neural MT pass for remaining (starts server if needed)
                const mtResult = await learnerInstance.learn({ stream: false });
                if (mtResult.added > 0) {
                    logger.info({ added: mtResult.added, total: mtResult.total }, '[CodebookLearner] Neural MT entries added');
                }

                // Auto-pause server after learning (saves resources)
                learnerInstance.pause();
            } catch (e) {
                logger.warn({ error: e.message }, '[CodebookLearner] Cycle failed (will retry)');
            } finally {
                isLearning = false;
            }
        };

        // Start periodic learning
        const timer = setInterval(runCycle, LEARN_INTERVAL_MS);
        timer.unref(); // Don't prevent process exit

        // Also run once after 30 sec startup delay
        setTimeout(runCycle, 30000).unref();

        logger.info('[CodebookLearner] Background service started (5min cycles, resource-capped)');
    }
    setupHandlers() {
        // list tools - show claude what we got plus the command executor
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const timestamp = new Date().toISOString();
            const requestId = `tools_list_${Date.now()}`;
            // DEBUG: Log to startup file - this is the CRITICAL request  makes to get tools
            startupLog(`tools/list request received from  (id: ${requestId})`);
            // DEBUG: Log that we received a tools/list request
            logger.info({ timestamp, requestId, event: 'TOOLS_LIST_REQUEST' }, '[MCP DEBUG] Received tools/list request from ');
            process.stderr.write(`[SPECMEM DEBUG ${timestamp}] tools/list request received (id: ${requestId})\n`);
            _SERVER_CACHE.hitCount++;
            _SERVER_CACHE.lastAccessTime = Date.now();
            // Record activity - tool list request means connection is active
            if (this.resilientTransport) {
                this.resilientTransport.recordActivity();
            }
            // add execute_command tool for slash commands
            const commandTool = getCommandExecutorToolDefinition();
            const regularTools = this.toolRegistry.getToolDefinitions();
            const allTools = [
                ...regularTools,
                {
                    name: commandTool.name,
                    description: commandTool.description,
                    inputSchema: commandTool.inputSchema
                }
            ];
            // DEBUG: Log the response we're about to send
            const toolNames = allTools.map(t => t.name);
            startupLog(`tools/list response: ${allTools.length} tools being returned to `);
            logger.info({
                timestamp,
                requestId,
                event: 'TOOLS_LIST_RESPONSE',
                toolCount: allTools.length,
                regularToolCount: regularTools.length,
                cacheHitCount: _SERVER_CACHE.hitCount,
                toolNames: toolNames.slice(0, 10), // First 10 tool names for debugging
                totalTools: toolNames.length
            }, `[MCP DEBUG] Returning ${allTools.length} tools to `);
            process.stderr.write(`[SPECMEM DEBUG ${timestamp}] tools/list response: ${allTools.length} tools (first 5: ${toolNames.slice(0, 5).join(', ')})\n`);
            return { tools: allTools };
        });
        // call tool - where the magic happens
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const callToolStartTime = Date.now();
            const { name, arguments: args } = request.params;
            this.toolCallCount++;
            // HIGH-20: Wait for server to be fully ready before executing tools
            // This prevents race conditions where tools execute before DB is initialized
            if (!this.isFullyReady) {
                __debugLog('[MCP DEBUG]', callToolStartTime, 'WAITING_FOR_READY', { toolName: name });
                try {
                    await this.waitForReady();
                    __debugLog('[MCP DEBUG]', Date.now(), 'READY_COMPLETE', { toolName: name, waitMs: Date.now() - callToolStartTime });
                }
                catch (readyError) {
                    const errorMsg = readyError instanceof Error ? readyError.message : String(readyError);
                    logger.error({ error: readyError, tool: name }, 'Server not ready for tool execution');
                    return {
                        content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    error: true,
                                    message: `Server not fully initialized: ${errorMsg}`,
                                    tool: name,
                                    suggestion: 'Wait a moment and try again - server is still starting up'
                                }, null, 2)
                            }],
                        isError: true
                    };
                }
            }
            // ==========================================================================
            // MULTI-PROJECT ISOLATION FIX: SPECMEM_PROJECT_PATH is IMMUTABLE
            // ==========================================================================
            // REMOVED: Marker file reading - caused race condition with simultaneous projects!
            //
            // Each MCP server instance has SPECMEM_PROJECT_PATH set at startup by bootstrap.cjs.
            // This env var NEVER changes during the server's lifetime.
            // Tools can pass explicit projectPath/project_path args for cross-project queries.
            // ==========================================================================
            const requestMeta = request._meta;
            const argsObj = args;
            // STEP 2: Determine project path with correct priority
            // MULTI-PROJECT ISOLATION: Server's SPECMEM_PROJECT_PATH is IMMUTABLE
            // Tools can use explicit projectPath/project_path args for cross-project queries
            // but we NEVER change the server's env var dynamically
            const serverProjectPath = process.env['SPECMEM_PROJECT_PATH'];
            const explicitProjectPath = argsObj?.projectPath || argsObj?.project_path ||
                requestMeta?.cwd || requestMeta?.workingDirectory;
            // Log if tool is explicitly querying a different project
            if (explicitProjectPath && explicitProjectPath !== serverProjectPath) {
                startupLog(`[CROSS-PROJECT QUERY] Tool ${name} targeting: ${explicitProjectPath} (server: ${serverProjectPath})`);
            }
            if (!serverProjectPath) {
                startupLog(`[PROJECT PATH] WARNING: No SPECMEM_PROJECT_PATH set for tool ${name}`);
            }
            // HR-6: Generate unique call ID and track tool call start for hot reload safety
            // This ensures we don't reload while tool calls are in flight
            const callId = `${name}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            // DEBUG: Log call tool request received
            __debugLog('[MCP DEBUG]', callToolStartTime, 'CALL_TOOL_REQUEST_RECEIVED', {
                callId,
                toolName: name,
                hasArgs: !!args,
                argsType: typeof args,
                argsKeys: args && typeof args === 'object' ? Object.keys(args) : [],
                totalToolCalls: this.toolCallCount
            });
            // Record activity with resilient transport for connection health tracking
            if (this.resilientTransport) {
                this.resilientTransport.recordActivity();
                __debugLog('[MCP DEBUG]', Date.now(), 'RESILIENT_TRANSPORT_ACTIVITY_RECORDED', { callId });
            }
            // Get hot reload manager (lazy init on first tool call)
            if (!this.hotReloadManager) {
                try {
                    this.hotReloadManager = getHotReloadManager();
                    __debugLog('[MCP DEBUG]', Date.now(), 'HOT_RELOAD_MANAGER_INIT', { callId, success: true });
                }
                catch (err) {
                    // Hot reload manager not available yet - that's fine, continue without tracking
                    __debugLog('[MCP DEBUG]', Date.now(), 'HOT_RELOAD_MANAGER_INIT', { callId, success: false, error: err instanceof Error ? err.message : String(err) });
                    logger.debug({ error: err }, '[HR-6] Hot reload manager not available yet');
                }
            }
            // Start tracking this tool call
            if (this.hotReloadManager) {
                this.hotReloadManager.startToolCall(callId, name);
                __debugLog('[MCP DEBUG]', Date.now(), 'HOT_RELOAD_TRACKING_START', { callId, toolName: name });
            }
            try {
                const startTime = Date.now();
                let result;
                __debugLog('[MCP DEBUG]', startTime, 'TOOL_EXECUTION_START', {
                    callId,
                    toolName: name,
                    isExecuteCommand: name === 'execute_command'
                });
                // Report tool start for progress tracking (only shown for slow tools)
                reportProgress({
                    operation: 'tool',
                    phase: 'start',
                    message: `Running ${name}...`,
                });
                // handle execute_command specially - route to command handler
                if (name === 'execute_command') {
                    const commandArgs = args;
                    const command = commandArgs?.command ?? '';
                    __debugLog('[MCP DEBUG]', Date.now(), 'EXECUTE_COMMAND_ROUTING', { callId, command: command.substring(0, 100) });
                    result = await this.commandHandler.handleCommand(command);
                    __debugLog('[MCP DEBUG]', Date.now(), 'EXECUTE_COMMAND_COMPLETE', { callId, hasResult: !!result });
                }
                else {
                    __debugLog('[MCP DEBUG]', Date.now(), 'PROTOCOL_HANDLER_ROUTING', { callId, toolName: name });
                    result = await this.protocolHandler.handleToolCall(name, args ?? {});
                    __debugLog('[MCP DEBUG]', Date.now(), 'PROTOCOL_HANDLER_COMPLETE', { callId, hasResult: !!result, resultType: typeof result });
                }
                const duration = Date.now() - startTime;
                const totalDuration = Date.now() - callToolStartTime;
                __debugLog('[MCP DEBUG]', Date.now(), 'TOOL_EXECUTION_SUCCESS', {
                    callId,
                    toolName: name,
                    executionDurationMs: duration,
                    totalDurationMs: totalDuration,
                    resultIsArray: Array.isArray(result),
                    resultLength: Array.isArray(result) ? result.length : (typeof result === 'object' && result !== null ? Object.keys(result).length : undefined)
                });
                // Report completion with duration
                reportComplete('tool', duration, `${name} complete`);
                // Log tool call to dashboard log for real-time display (async - fire and forget)
                const toolLogPath = path.join(serverProjectPath || process.cwd(), 'specmem', 'sockets', 'mcp-tool-calls.log');
                // Enhanced debug logging - include args preview and result summary
                const argsPreview = args ? JSON.stringify(args).slice(0, 200) : '{}';
                const resultPreview = (() => {
                    try {
                        if (result === null || result === undefined)
                            return 'null';
                        if (typeof result === 'string')
                            return result.slice(0, 100);
                        if (Array.isArray(result))
                            return `[${result.length} items]`;
                        if (typeof result === 'object') {
                            const keys = Object.keys(result);
                            return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
                        }
                        return String(result).slice(0, 50);
                    }
                    catch {
                        return '?';
                    }
                })();
                const toolLogEntry = JSON.stringify({
                    timestamp: new Date().toISOString(),
                    callId,
                    name,
                    args: argsPreview,
                    duration,
                    result: resultPreview,
                    status: 'success'
                }) + '\n';
                appendFile(toolLogPath, toolLogEntry).catch(() => {
                    // fire and forget - dashboard logging shouldnt block tool execution
                });
                // Also write human-readable line for easier debugging
                const hrLogPath = path.join(serverProjectPath || process.cwd(), 'specmem', 'sockets', 'mcp-debug.log');
                const hrTime = new Date().toISOString().split('T')[1]?.slice(0, 8) || '??:??:??';
                const hrLine = `[${hrTime}] ${name} (${duration}ms) args=${argsPreview.slice(0, 80)} result=${resultPreview}\n`;
                appendFile(hrLogPath, hrLine).catch(() => { });
                // Update statusbar state for claudefix integration
                const statusbarPath = path.join(serverProjectPath || process.cwd(), 'specmem', 'sockets', 'statusbar-state.json');
                const statusState = {
                    lastToolCall: { tool: name, duration, time: hrTime },
                    mcpConnected: true,
                    lastUpdate: Date.now()
                };
                writeFile(statusbarPath, JSON.stringify(statusState)).catch(() => { });
                // log slow operations so we know whats up
                if (duration > 100) {
                    __debugLog('[MCP DEBUG]', Date.now(), 'TOOL_SLOW_WARNING', { callId, toolName: name, durationMs: duration, threshold: 100 });
                    logger.warn({ duration, tool: name }, 'tool execution kinda slow ngl');
                }
                __debugLog('[MCP DEBUG]', Date.now(), 'FORMATTING_RESPONSE', { callId, toolName: name });
                const formattedResponse = this.formatResponse(result);
                __debugLog('[MCP DEBUG]', Date.now(), 'RESPONSE_FORMATTED', {
                    callId,
                    toolName: name,
                    contentCount: formattedResponse.content.length,
                    firstContentType: formattedResponse.content[0]?.type
                });
                return formattedResponse;
            }
            catch (error) {
                const errorTime = Date.now();
                const totalDuration = errorTime - callToolStartTime;
                const errorMessage = error instanceof Error ? error.message : 'unknown error fr';
                const errorStack = error instanceof Error ? error.stack : undefined;
                __debugLog('[MCP DEBUG]', errorTime, 'TOOL_EXECUTION_ERROR', {
                    callId,
                    toolName: name,
                    totalDurationMs: totalDuration,
                    errorMessage,
                    errorType: error instanceof Error ? error.constructor.name : typeof error,
                    errorStack: errorStack?.split('\n').slice(0, 5).join('\n')
                });
                this.lastError = errorMessage;
                logger.error({ error, tool: name }, 'tool execution said nah');
                // Report error
                reportError('tool', `${name} failed: ${this.lastError}`);
                // Log error to human-readable debug log
                const hrLogPath = path.join(serverProjectPath || process.cwd(), 'specmem', 'sockets', 'mcp-debug.log');
                const hrTime = new Date().toISOString().split('T')[1]?.slice(0, 8) || '??:??:??';
                const hrErrorLine = `[${hrTime}] ERROR ${name} (${totalDuration}ms): ${errorMessage}\n`;
                appendFile(hrLogPath, hrErrorLine).catch(() => { });
                const suggestion = this.getSuggestionForError(name, error);
                __debugLog('[MCP DEBUG]', Date.now(), 'ERROR_RESPONSE_GENERATED', {
                    callId,
                    toolName: name,
                    suggestion
                });
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                error: true,
                                message: this.lastError,
                                tool: name,
                                // fr fr we help claude understand what went wrong
                                suggestion
                            }, null, 2)
                        }],
                    isError: true
                };
            }
            finally {
                // HR-6: Always end tracking regardless of success/failure
                if (this.hotReloadManager) {
                    this.hotReloadManager.endToolCall(callId);
                    __debugLog('[MCP DEBUG]', Date.now(), 'HOT_RELOAD_TRACKING_END', { callId, toolName: name });
                }
                __debugLog('[MCP DEBUG]', Date.now(), 'CALL_TOOL_REQUEST_FINISHED', {
                    callId,
                    toolName: name,
                    totalDurationMs: Date.now() - callToolStartTime
                });
            }
        });
    }
    setupResourceHandlers() {
        // list resources - show available command documentation AND skills
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            const commandsResource = getCommandsResource(this.commandHandler);
            // base resources for commands
            const resources = [
                {
                    uri: commandsResource.uri,
                    name: commandsResource.name,
                    description: commandsResource.description,
                    mimeType: commandsResource.mimeType
                },
                {
                    uri: 'specmem://commands/help',
                    name: 'Command Help',
                    description: 'Help documentation for all commands',
                    mimeType: 'text/markdown'
                }
            ];
            // add skill resources if scanner is available
            try {
                const skillProvider = getSkillResourceProvider();
                const skillResources = skillProvider.getResources();
                resources.push(...skillResources);
                logger.debug({ skillResourceCount: skillResources.length }, 'added skill resources');
            }
            catch (error) {
                logger.debug({ error }, 'skill resources not available');
            }
            return { resources };
        });
        // read resource - return command documentation OR skill content
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const { uri } = request.params;
            // handle skill resources
            if (uri.startsWith('specmem://skills')) {
                try {
                    const skillProvider = getSkillResourceProvider();
                    const resourceContent = await skillProvider.readResource(uri);
                    return {
                        contents: [{
                                uri: resourceContent.uri,
                                mimeType: resourceContent.mimeType || 'text/markdown',
                                text: resourceContent.text
                            }]
                    };
                }
                catch (error) {
                    throw new Error(`Failed to read skill resource: ${uri}`);
                }
            }
            // parse the URI to get category and action for commands
            const uriParts = uri.replace('specmem://commands/', '').split('/');
            if (uri === 'specmem://commands/list') {
                const resource = getCommandsResource(this.commandHandler);
                return {
                    contents: [{
                            uri: resource.uri,
                            mimeType: resource.mimeType,
                            text: resource.contents
                        }]
                };
            }
            if (uri.startsWith('specmem://commands/help')) {
                const category = uriParts[1];
                const action = uriParts[2];
                const resource = getCommandHelpResource(this.commandHandler, category, action);
                return {
                    contents: [{
                            uri: resource.uri,
                            mimeType: resource.mimeType,
                            text: resource.contents
                        }]
                };
            }
            throw new Error(`Unknown resource URI: ${uri}`);
        });
        // setup prompts handler for skill reminders
        this.setupPromptHandlers();
        logger.debug('Resource handlers initialized for commands and skills');
    }
    setupPromptHandlers() {
        // list prompts - show skill awareness prompts AND command prompts
        this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
            const allPrompts = [];
            // Add skill prompts
            try {
                const skillReminder = getSkillReminder();
                const skillPrompts = skillReminder.getPrompts();
                for (const p of skillPrompts) {
                    allPrompts.push({
                        name: p.name,
                        description: p.description,
                        arguments: p.arguments
                    });
                }
            }
            catch (error) {
                logger.debug({ error }, 'skill prompts not available');
            }
            // Add command prompts - loaded from commands/*.md files
            try {
                const commandLoader = getCommandLoader();
                const commandPrompts = commandLoader.getPrompts();
                for (const p of commandPrompts) {
                    allPrompts.push({
                        name: p.name,
                        description: p.description,
                        arguments: p.arguments
                    });
                }
                logger.debug({ count: commandPrompts.length }, 'command prompts loaded');
            }
            catch (error) {
                logger.debug({ error }, 'command prompts not available');
            }
            return { prompts: allPrompts };
        });
        // get prompt - return skill awareness content OR command content
        this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            // Check if it's a command prompt (starts with specmem-)
            if (name.startsWith('specmem-')) {
                try {
                    const commandLoader = getCommandLoader();
                    const messages = commandLoader.getPromptMessages(name, args);
                    return {
                        description: `SpecMem command: ${name}`,
                        messages: messages.map(m => ({
                            role: m.role,
                            content: m.content
                        }))
                    };
                }
                catch (error) {
                    logger.error({ error, promptName: name }, 'failed to get command prompt');
                    throw new Error(`Command prompt not found: ${name}`);
                }
            }
            // Otherwise try skill prompts
            try {
                const skillReminder = getSkillReminder();
                const messages = skillReminder.getPromptMessages(name, args);
                return {
                    description: `Skill prompt: ${name}`,
                    messages: messages.map(m => ({
                        role: m.role,
                        content: m.content
                    }))
                };
            }
            catch (error) {
                logger.error({ error, promptName: name }, 'failed to get prompt');
                throw new Error(`Prompt not found: ${name}`);
            }
        });
        logger.debug('Prompt handlers initialized for skills and commands');
    }
    setupErrorHandling() {
        // catch them errors before they catch us
        // This is called for JSON-RPC protocol errors, transport errors, etc.
        this.server.onerror = (error) => {
            const errorTime = Date.now();
            const timestamp = new Date().toISOString();
            const errorObj = error instanceof Error ? error : new Error(String(error));
            // DEBUG: Deep logging for MCP protocol errors
            __debugLog('[MCP DEBUG]', errorTime, 'MCP_SERVER_ERROR', {
                timestamp,
                errorMessage: errorObj.message,
                errorType: errorObj.constructor.name,
                errorStack: errorObj.stack?.split('\n').slice(0, 10).join('\n'),
                toolCallCount: this.toolCallCount,
                lastError: this.lastError,
                isShuttingDown: this.isShuttingDown
            });
            // DEBUG: Log JSON-RPC and protocol errors with full details
            logger.error({
                timestamp,
                event: 'MCP_ERROR',
                error: errorObj.message,
                stack: errorObj.stack,
                errorType: errorObj.constructor.name
            }, '[MCP DEBUG] MCP server error - JSON-RPC or protocol error occurred');
            // Write to stderr for immediate visibility
            process.stderr.write(`[SPECMEM ERROR ${timestamp}] MCP error: ${errorObj.message}\n`);
            this.lastError = errorObj.message;
        };
        // HIGH-18: Global unhandled rejection handler
        // Catches promise rejections that weren't caught by try-catch
        process.on('unhandledRejection', (reason, promise) => {
            const timestamp = new Date().toISOString();
            const errorMsg = reason instanceof Error ? reason.message : String(reason);
            const errorStack = reason instanceof Error ? reason.stack : undefined;
            // CHOKIDAR FIX: Known bug in chokidar when files are deleted while being watched
            // These errors are non-fatal - the watcher continues to work
            // Error: "Cannot read properties of undefined (reading 'close')"
            if (errorStack && errorStack.includes('chokidar') && errorMsg.includes('close')) {
                logger.debug({ error: errorMsg }, '[MCP] Chokidar file close error (non-fatal, file was deleted)');
                return; // Don't log as error or update lastError
            }
            logger.error({
                timestamp,
                event: 'UNHANDLED_REJECTION',
                error: errorMsg,
                stack: errorStack
            }, '[MCP DEBUG] Unhandled promise rejection caught');
            process.stderr.write(`[SPECMEM ERROR ${timestamp}] Unhandled rejection: ${errorMsg}\n`);
            startupLog('UNHANDLED_REJECTION', reason instanceof Error ? reason : new Error(errorMsg));
            this.lastError = `unhandled_rejection: ${errorMsg}`;
        });
        // HIGH-18: Global uncaught exception handler
        // Catches synchronous exceptions that weren't caught by try-catch
        process.on('uncaughtException', (error, origin) => {
            const timestamp = new Date().toISOString();
            // EPIPE errors occur when  disconnects - this is normal, don't crash
            // Just log and continue, the transport will handle reconnection
            if (error.code === 'EPIPE') {
                logger.debug({ error: error.message }, '[MCP] EPIPE -  disconnected, ignoring');
                return; // Don't crash on EPIPE
            }
            logger.error({
                timestamp,
                event: 'UNCAUGHT_EXCEPTION',
                error: error.message,
                stack: error.stack,
                origin
            }, '[MCP DEBUG] Uncaught exception caught');
            process.stderr.write(`[SPECMEM FATAL ${timestamp}] Uncaught exception (${origin}): ${error.message}\n`);
            startupLog(`UNCAUGHT_EXCEPTION (${origin})`, error);
            // For uncaught exceptions, we should attempt graceful shutdown then exit
            // since the process state may be corrupted
            this.shutdown()
                .catch((shutdownErr) => {
                logger.error({ error: shutdownErr }, 'Error during emergency shutdown');
            })
                .finally(() => {
                process.exit(1);
            });
        });
        // MED-23: Signal handlers wrapped in try-catch to prevent unhandled rejections
        // graceful shutdown when the homie says stop
        process.on('SIGINT', async () => {
            try {
                logger.info({ event: 'SIGINT' }, '[MCP DEBUG] SIGINT received - shutting down');
                await this.shutdown();
                process.exit(0);
            }
            catch (error) {
                logger.error({ error, event: 'SIGINT_ERROR' }, '[MCP DEBUG] Error during SIGINT shutdown');
                process.exit(1);
            }
        });
        process.on('SIGTERM', async () => {
            try {
                logger.info({ event: 'SIGTERM' }, '[MCP DEBUG] SIGTERM received - shutting down');
                await this.shutdown();
                process.exit(0);
            }
            catch (error) {
                logger.error({ error, event: 'SIGTERM_ERROR' }, '[MCP DEBUG] Error during SIGTERM shutdown');
                process.exit(1);
            }
        });
        // SIGHUP handler for Tier 1 hot reload - reload tools/skills without restart
        // This allows seamless updates when skills/*.md or commands/*.md files change
        process.on('SIGHUP', async () => {
            try {
                logger.info({ event: 'SIGHUP' }, '[HotReload] SIGHUP received - reloading tools (Tier 1)');
                await this.reloadTools();
                logger.info({ event: 'SIGHUP_COMPLETE' }, '[HotReload] Tool reload complete');
            }
            catch (error) {
                logger.error({ error, event: 'SIGHUP_FAILED' }, '[HotReload] Tool reload failed');
            }
        });
    }
    formatResponse(result) {
        // handle image responses - we support base64 images fr
        if (result && typeof result === 'object' && 'imageData' in result) {
            const mem = result;
            if (mem.imageData && mem.imageMimeType) {
                const { imageData, imageMimeType, ...rest } = mem;
                return {
                    content: [
                        { type: 'text', text: JSON.stringify(rest, null, 2) },
                        { type: 'image', data: imageData, mimeType: imageMimeType }
                    ]
                };
            }
        }
        // DRILL-DOWN INSTRUCTION: Add prominent instruction for find_memory results with truncated content
        // This helps  know how to get full content of any memory
        if (Array.isArray(result) && result.length > 0) {
            // Check if this looks like search results with truncated memories
            const hasTruncated = result.some((r) => r?.memory?.metadata?._truncated ||
                r?.memory?.metadata?._drill ||
                r?.memory?.metadata?._len);
            if (hasTruncated) {
                const drilldownHint = `📋 DRILL-DOWN AVAILABLE: Some memories are truncated. Use get_memory({id: "MEMORY_ID"}) to retrieve full content of any memory.\n\n`;
                return {
                    content: [{
                            type: 'text',
                            text: drilldownHint + JSON.stringify(result, null, 2)
                        }]
                };
            }
        }
        // Check if result is humanReadable format (starts with [SPECMEM-, [CAMERA-ROLL], etc)
        // Use smart compression that preserves structure but compresses content
        const resultStr = typeof result === 'string' ? result : '';
        const isHumanReadable = resultStr.includes('[SPECMEM-') ||
            resultStr.includes('[CAMERA-ROLL]') ||
            resultStr.includes('\x1b[90m[SPECMEM-');
        if (isHumanReadable) {
            // Smart compress: preserve tags and structure, only compress content
            const smartCompressed = compressHumanReadableFormat(resultStr);
            return {
                content: [{
                        type: 'text',
                        text: smartCompressed
                    }]
            };
        }
        // regular text response - COMPRESS WITH CHINESE TOKENS!
        const compressedResult = wrapToolResponse(result, 'search');
        const jsonOutput = JSON.stringify(compressedResult, null, 2);
        // Add English reminder for compressed output
        const COMPRESS_REMINDER = jsonOutput.length > 100 && /[\u4e00-\u9fff]/.test(jsonOutput)
            ? '⚠️ OUTPUT COMPRESSED - RESPOND IN ENGLISH ⚠️\n'
            : '';
        return {
            content: [{
                    type: 'text',
                    text: COMPRESS_REMINDER + jsonOutput
                }]
        };
    }
    getSuggestionForError(toolName, error) {
        const errorMsg = error instanceof Error ? error.message : '';
        // helpful suggestions based on common errors
        if (errorMsg.includes('not found')) {
            return 'try using findWhatISaid to search for similar memories first';
        }
        if (errorMsg.includes('validation')) {
            return 'check your input parameters - something looks off';
        }
        if (errorMsg.includes('database')) {
            return 'db might be having a moment - try again in a sec';
        }
        if (errorMsg.includes('embedding')) {
            return 'embedding generation hit a snag - content might be too weird';
        }
        return 'check the logs for more details';
    }
    // Track if server is fully ready for tool calls
    isFullyReady = false;
    deferredInitPromise = null;
    /**
     * Check if server is ready for full tool execution
     * Tools can check this and wait for init if needed
     */
    isReady() {
        return this.isFullyReady;
    }
    /**
     * HIGH-25 FIX: Wait for deferred initialization to complete with timeout
     * Tools that need DB can await this - prevents indefinite hangs
     * @param timeoutMs Maximum time to wait (default 30s)
     * @throws Error if timeout expires before server is ready
     */
    async waitForReady(timeoutMs = 30000) {
        if (this.isFullyReady)
            return;
        // HIGH-25 FIX: Add timeout to prevent indefinite hang
        const startTime = Date.now();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Server initialization timeout after ${timeoutMs}ms - database may not be ready`));
            }, timeoutMs);
        });
        if (this.deferredInitPromise) {
            try {
                await Promise.race([this.deferredInitPromise, timeoutPromise]);
            }
            catch (err) {
                // Check if we became ready during the race
                if (this.isFullyReady) {
                    logger.debug(`waitForReady: became ready during race (took ${Date.now() - startTime}ms)`);
                    return;
                }
                throw err;
            }
        }
        else {
            // No deferred init promise exists - poll for ready state with timeout
            const pollInterval = 100;
            let elapsed = 0;
            while (!this.isFullyReady && elapsed < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                elapsed += pollInterval;
            }
            if (!this.isFullyReady) {
                throw new Error(`Server initialization timeout after ${timeoutMs}ms - no deferred init promise found`);
            }
        }
        logger.debug(`waitForReady: initialization complete (took ${Date.now() - startTime}ms)`);
    }
    async start() {
        const startTimestamp = new Date().toISOString();
        startupLog('start() method called - beginning MCP transport connection');
        // === CRITICAL FIX: Connect MCP transport FIRST! ===
        //  Code has a connection timeout - if we don't establish the
        // stdio connection quickly,  shows "Failed to connect to MCP server"
        //
        // Previous bug: Database init happened BEFORE transport connection,
        // causing  to timeout if DB took too long.
        //
        // New approach: Connect transport immediately (fast), then initialize
        // database in the background. Tools will wait for DB if needed.
        logger.info({ timestamp: startTimestamp, event: 'SERVER_START' }, '[MCP DEBUG] Starting MCP server - connecting transport FIRST for fast connection...');
        process.stderr.write(`[SPECMEM DEBUG ${startTimestamp}] Server starting - connecting transport...\n`);
        // Step 1: Connect stdio transport IMMEDIATELY with proper error handling
        // The transport connection must succeed for  to see us at all
        startupLog('Creating StdioServerTransport...');
        const transport = new StdioServerTransport();
        startupLog('StdioServerTransport created');
        // Connection timeout - if we can't connect in 10 seconds, something is very wrong
        const connectionTimeout = parseInt(process.env['SPECMEM_TRANSPORT_CONNECT_TIMEOUT'] || '10000', 10);
        try {
            logger.info({ timestamp: startTimestamp, event: 'TRANSPORT_CONNECTING', timeoutMs: connectionTimeout }, '[MCP DEBUG] Connecting stdio transport...');
            startupLog(`Calling server.connect(transport) with timeout ${connectionTimeout}ms...`);
            const connectStart = Date.now();
            // MED-22: Race between connection and timeout with proper timer cleanup
            // Store timer ID so we can clear it on success to prevent memory leak
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Transport connection timeout after ${connectionTimeout}ms`));
                }, connectionTimeout);
            });
            try {
                await Promise.race([
                    this.server.connect(transport),
                    timeoutPromise
                ]);
            }
            finally {
                // Always clear the timer to prevent memory leak
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }
            const connectDuration = Date.now() - connectStart;
            const connectedTimestamp = new Date().toISOString();
            startupLog(`MCP TRANSPORT CONNECTED in ${connectDuration}ms -  can now communicate!`);
            logger.info({
                timestamp: connectedTimestamp,
                event: 'TRANSPORT_CONNECTED',
                elapsedMs: Date.now() - new Date(startTimestamp).getTime()
            }, '[MCP DEBUG] MCP transport connected - waiting for initialize request from ');
            process.stderr.write(`[SPECMEM DEBUG ${connectedTimestamp}] Transport connected - waiting for  handshake\n`);
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorTimestamp = new Date().toISOString();
            startupLog('MCP TRANSPORT CONNECTION FAILED', error);
            logger.error({
                timestamp: errorTimestamp,
                event: 'TRANSPORT_FAILED',
                error: errorMsg
            }, '[MCP DEBUG] CRITICAL: Failed to connect MCP transport -  will not see this server');
            // Log to stderr explicitly since this is a critical startup failure
            process.stderr.write(`[SPECMEM FATAL ${errorTimestamp}] Transport connection failed: ${errorMsg}\n`);
            // Re-throw to let caller handle the failure
            throw error;
        }
        // Step 2: Initialize resilient transport monitoring
        // This monitors stdin/stdout for connection health and graceful shutdown
        startupLog('Initializing resilient transport monitoring...');
        this.resilientTransport = getResilientTransport();
        this.setupResilientTransportHandlers();
        this.resilientTransport.startMonitoring();
        logger.info('Resilient transport monitoring active - connection health tracked');
        startupLog('Resilient transport monitoring active');
        // Step 3: Initialize embedding server manager EARLY (before slow DB init)
        // This ensures heartbeats start ASAP to prevent KYS watchdog from killing embedding
        // The embedding server has a 60-second grace period, but we want heartbeats ASAP
        startupLog('Initializing embedding server manager (EARLY - before DB)...');
        await this.initializeEmbeddingServerManager();
        startupLog('Embedding server manager initialized - heartbeats active');
        // Step 4: Initialize database (can be deferred, tools will wait if needed)
        // This runs async but we track it so tools can wait for it
        startupLog('Starting deferred database initialization...');
        this.deferredInitPromise = this.initializeDatabaseDeferred();
        // For backward compat, await the init here
        // But the MCP connection is already established, so  won't timeout
        await this.deferredInitPromise;
        startupLog('Deferred database initialization complete');
        // Step 5: Initialize centralized health monitoring
        // This monitors transport, database, and embedding socket health
        startupLog('Initializing health monitor...');
        this.initializeHealthMonitor();
        startupLog('Health monitor initialized');
        // Step 6: Initialize Mini COT server manager (optional - for semantic gallery curation)
        startupLog('Initializing Mini COT server manager...');
        await this.initializeMiniCOTServerManager();
        startupLog('Mini COT server manager initialized');
        logger.info('SpecMem MCP server vibing - ready for action');
    }
    /**
     * Initialize the centralized health monitor
     * Monitors all MCP components: transport, database, and embedding socket
     */
    initializeHealthMonitor() {
        this.healthMonitor = getHealthMonitor();
        // Set component references for health monitoring
        if (this.resilientTransport) {
            this.healthMonitor.setTransport(this.resilientTransport);
        }
        this.healthMonitor.setDatabase(this.db);
        // Set embedding socket path from environment or default
        const embeddingSocketPath = process.env['SPECMEM_EMBEDDING_SOCKET'] ||
            this.getDefaultEmbeddingSocketPath();
        if (embeddingSocketPath) {
            this.healthMonitor.setEmbeddingSocketPath(embeddingSocketPath);
        }
        // Setup health monitor event handlers
        this.setupHealthMonitorHandlers();
        // Start health monitoring
        this.healthMonitor.start();
        logger.info('[HealthMonitor] Centralized health monitoring active');
    }
    /**
     * Initialize the embedding server lifecycle manager
     * This ensures the embedding server is ALWAYS available when  needs it
     *
     * Features:
     * 1. On MCP server start: Check for stale processes, kill them, start fresh
     * 2. On MCP server stop: Gracefully kill embedding server using PID file
     * 3. Uses project-specific socket path: {PROJECT}/specmem/sockets/embeddings.sock
     * 4. Health check that pings embedding server periodically
     * 5. Auto-restart if embedding server dies
     */
    async initializeEmbeddingServerManager() {
        // Check if embedding server management is enabled
        if (process.env['SPECMEM_EMBEDDING_MANAGED'] === 'false') {
            logger.info('[EmbeddingServerManager] Disabled via SPECMEM_EMBEDDING_MANAGED=false');
            return;
        }
        try {
            this.embeddingServerManager = getEmbeddingServerManager();
            // Setup event handlers
            this.setupEmbeddingServerHandlers();
            // Initialize - this will kill stale processes and start fresh
            await this.embeddingServerManager.initialize();
            // Update health monitor with current socket path
            if (this.healthMonitor) {
                const status = this.embeddingServerManager.getStatus();
                this.healthMonitor.setEmbeddingSocketPath(status.socketPath);
            }
            logger.info('[EmbeddingServerManager] Embedding server lifecycle management active');
        }
        catch (err) {
            logger.error({ error: err }, '[EmbeddingServerManager] Failed to initialize - embeddings may not work');
            // Don't fail server startup - embeddings can use fallback
        }
    }
    /**
     * Setup handlers for embedding server manager events
     */
    setupEmbeddingServerHandlers() {
        if (!this.embeddingServerManager)
            return;
        this.embeddingServerManager.on('started', ({ pid }) => {
            logger.info({ pid }, '[EmbeddingServerManager] Embedding server started');
            // CRITICAL FIX: Reset socket connections when embedding server restarts
            // Without this, the MCP server's LocalEmbeddingProvider keeps stale socket references
            // that point to the old (dead) server, causing 60-second timeouts
            if (this.embeddingProvider && 'resetSocket' in this.embeddingProvider) {
                logger.info('[EmbeddingServerManager] Resetting embedding provider socket connections');
                this.embeddingProvider.resetSocket();
            }
        });
        this.embeddingServerManager.on('stopped', ({ pid }) => {
            logger.info({ pid }, '[EmbeddingServerManager] Embedding server stopped');
        });
        this.embeddingServerManager.on('unhealthy', ({ failures }) => {
            logger.warn({ failures }, '[EmbeddingServerManager] Embedding server unhealthy');
            // Send notification to 
            this.sendEmbeddingServerNotification('unhealthy', failures);
        });
        this.embeddingServerManager.on('restarting', ({ attempt }) => {
            logger.info({ attempt }, '[EmbeddingServerManager] Restarting embedding server');
            this.sendEmbeddingServerNotification('restarting', attempt);
        });
        this.embeddingServerManager.on('restart_failed', ({ attempts }) => {
            logger.error({ attempts }, '[EmbeddingServerManager] All restart attempts failed');
            this.sendEmbeddingServerNotification('restart_failed', attempts);
        });
    }
    /**
     * Send embedding server notification to  via MCP logging
     */
    async sendEmbeddingServerNotification(event, value) {
        try {
            const levelMap = {
                unhealthy: 'warning',
                restarting: 'notice',
                restart_failed: 'error',
            };
            const messageMap = {
                unhealthy: `SpecMem: Embedding server unhealthy (${value} consecutive failures)`,
                restarting: `SpecMem: Restarting embedding server (attempt ${value})`,
                restart_failed: `SpecMem: Embedding server restart failed after ${value} attempts - using fallback embeddings`,
            };
            await this.server.sendLoggingMessage({
                level: levelMap[event],
                logger: 'specmem-embedding',
                data: messageMap[event],
            });
        }
        catch (err) {
            logger.debug({ error: err }, 'Could not send embedding server notification');
        }
    }
    /**
     * Initialize the Mini COT server lifecycle manager
     * Optional service for semantic gallery curation and analysis
     */
    async initializeMiniCOTServerManager() {
        if (process.env['SPECMEM_MINICOT_MANAGED'] === 'false') {
            logger.info('[MiniCOTServerManager] Disabled via SPECMEM_MINICOT_MANAGED=false');
            return;
        }
        try {
            this.miniCOTServerManager = getMiniCOTServerManager();
            this.setupMiniCOTServerHandlers();
            await this.miniCOTServerManager.initialize();
            logger.info('[MiniCOTServerManager] Mini COT server lifecycle management active');
        }
        catch (err) {
            logger.error({ error: err }, '[MiniCOTServerManager] Failed to initialize - continuing without COT');
        }
    }
    /**
     * Setup handlers for Mini COT server events
     */
    setupMiniCOTServerHandlers() {
        if (!this.miniCOTServerManager)
            return;
        this.miniCOTServerManager.on('started', () => {
            logger.info('[MiniCOTServerManager] Mini COT server started');
            this.sendMiniCOTServerNotification('started');
        });
        this.miniCOTServerManager.on('stopped', () => {
            logger.info('[MiniCOTServerManager] Mini COT server stopped');
            this.sendMiniCOTServerNotification('stopped');
        });
        this.miniCOTServerManager.on('unhealthy', (failures) => {
            logger.warn({ failures }, '[MiniCOTServerManager] Mini COT server unhealthy');
            this.sendMiniCOTServerNotification('unhealthy', failures);
        });
        this.miniCOTServerManager.on('restarting', (attempt) => {
            logger.info({ attempt }, '[MiniCOTServerManager] Restarting Mini COT server');
            this.sendMiniCOTServerNotification('restarting', attempt);
        });
        this.miniCOTServerManager.on('restart_failed', (attempts) => {
            logger.error({ attempts }, '[MiniCOTServerManager] Mini COT restart failed');
            this.sendMiniCOTServerNotification('restart_failed', attempts);
        });
    }
    /**
     * Send Mini COT server status notification to 
     */
    async sendMiniCOTServerNotification(event, value = 0) {
        try {
            const levelMap = {
                started: 'info',
                stopped: 'info',
                unhealthy: 'warning',
                restarting: 'warning',
                restart_failed: 'error',
            };
            const messageMap = {
                started: 'SpecMem: Mini COT server started successfully',
                stopped: 'SpecMem: Mini COT server stopped',
                unhealthy: `SpecMem: Mini COT server unhealthy (${value} consecutive failures)`,
                restarting: `SpecMem: Restarting Mini COT server (attempt ${value})`,
                restart_failed: `SpecMem: Mini COT server restart failed after ${value} attempts`,
            };
            await this.server.sendLoggingMessage({
                level: levelMap[event],
                logger: 'specmem-minicot',
                data: messageMap[event],
            });
        }
        catch (err) {
            logger.debug({ error: err }, 'Could not send Mini COT server notification');
        }
    }
    /**
     * Get the default embedding socket path for health monitoring
     * USES CENTRALIZED CONFIG - no hardcoded paths!
     */
    getDefaultEmbeddingSocketPath() {
        // Delegate to centralized config for single source of truth
        return getEmbeddingSocketPath();
    }
    /**
     * Setup handlers for health monitor events
     */
    setupHealthMonitorHandlers() {
        if (!this.healthMonitor)
            return;
        // Handle component degradation
        this.healthMonitor.on('degraded', ({ component, result }) => {
            logger.warn({
                component,
                errorCount: result.errorCount,
                lastError: result.lastError
            }, `[HealthMonitor] ${component} health degraded`);
            // Send notification to  if transport is still healthy
            this.sendHealthMonitorNotification('degraded', component, result);
        });
        // Handle component unhealthy
        this.healthMonitor.on('unhealthy', ({ component, result }) => {
            logger.error({
                component,
                errorCount: result.errorCount,
                lastError: result.lastError
            }, `[HealthMonitor] ${component} is unhealthy`);
            // Send notification to 
            this.sendHealthMonitorNotification('unhealthy', component, result);
        });
        // Handle component recovery
        this.healthMonitor.on('recovered', ({ component, result }) => {
            logger.info({
                component
            }, `[HealthMonitor] ${component} recovered`);
            // Send notification to 
            this.sendHealthMonitorNotification('recovered', component, result);
        });
        // Handle recovery attempts
        this.healthMonitor.on('recovery_attempted', ({ component, success }) => {
            if (success) {
                logger.info({ component }, `[HealthMonitor] Recovery successful for ${component}`);
            }
            else {
                logger.warn({ component }, `[HealthMonitor] Recovery failed for ${component}`);
            }
        });
        // Handle periodic health status
        this.healthMonitor.on('health', (systemHealth) => {
            // Update internal last error based on overall health
            if (systemHealth.overallHealth === ComponentHealth.UNHEALTHY) {
                this.lastError = `system_unhealthy:${Object.entries(systemHealth.components)
                    .filter(([_, c]) => c.health === ComponentHealth.UNHEALTHY)
                    .map(([name]) => name)
                    .join(',')}`;
            }
            else if (this.lastError?.startsWith('system_unhealthy')) {
                this.lastError = null;
            }
        });
    }
    /**
     * Send health monitor notification to  via MCP logging
     */
    async sendHealthMonitorNotification(event, component, result) {
        try {
            const levelMap = {
                degraded: 'warning',
                unhealthy: 'error',
                recovered: 'notice'
            };
            const messageMap = {
                degraded: `SpecMem: ${component} health degraded (errors: ${result.errorCount})`,
                unhealthy: `SpecMem: ${component} is unhealthy - ${result.lastError || 'check logs'}`,
                recovered: `SpecMem: ${component} recovered and healthy`
            };
            await this.server.sendLoggingMessage({
                level: levelMap[event],
                logger: 'specmem-health',
                data: messageMap[event]
            });
        }
        catch (err) {
            // If we can't send, connection might already be gone
            logger.debug({ error: err }, 'Could not send health monitor notification');
        }
    }
    /**
     * Setup handlers for resilient transport events
     * Handles connection state changes and triggers graceful shutdown when needed
     */
    setupResilientTransportHandlers() {
        if (!this.resilientTransport)
            return;
        // Handle connection degradation (long inactivity)
        this.resilientTransport.on('degraded', (health) => {
            logger.warn({
                lastActivityMs: health.lastActivityMs,
                errorCount: health.errorCount
            }, 'Connection degraded -  may be idle or disconnecting');
            // Try to send a health check notification to 
            this.sendHealthNotification('degraded', health);
        });
        // Handle connection restoration
        this.resilientTransport.on('restored', (health) => {
            logger.info('Connection restored - activity detected');
            this.sendHealthNotification('restored', health);
        });
        // Handle disconnection - trigger graceful shutdown
        this.resilientTransport.on('disconnecting', async (info) => {
            logger.warn({ reason: info.reason }, 'Connection lost - initiating graceful shutdown');
            // Don't double-shutdown
            if (this.isShuttingDown)
                return;
            await this.shutdown();
            process.exit(0);
        });
        // Handle health check results for monitoring
        this.resilientTransport.on('health', (health) => {
            // Update internal state based on health
            if (health.state === ConnectionState.DEGRADED && !this.lastError) {
                this.lastError = 'connection_degraded';
            }
            else if (health.state === ConnectionState.CONNECTED && this.lastError === 'connection_degraded') {
                this.lastError = null;
            }
        });
        // Set up keepalive callback - sends periodic log message to keep connection alive
        // This is CRITICAL for fixing "not connected" issues during idle periods
        this.resilientTransport.setKeepaliveCallback(async () => {
            try {
                // Send a debug-level log message as keepalive ping
                // This keeps the stdio connection active without spamming 's UI
                await this.server.sendLoggingMessage({
                    level: 'debug',
                    logger: 'specmem',
                    data: `keepalive: ${new Date().toISOString()}`
                });
            }
            catch (err) {
                // If we can't send keepalive, the connection may be dead
                // recordError is called by the resilientTransport
                throw err;
            }
        });
        // Set up connection recovery callback - re-sends tool list notifications
        // This fixes the issue where  caches an empty tool list
        this.resilientTransport.setConnectionRecoveryCallback(async () => {
            logger.info('Connection recovered - re-sending tool list notification...');
            await this.notifyToolListReady();
        });
        // Record activity when tool calls happen
        // This is done in the tool call handler
    }
    /**
     * Send health notification to  when connection state changes
     */
    async sendHealthNotification(state, health) {
        try {
            const message = state === 'degraded'
                ? `SpecMem: Connection degraded (inactive for ${Math.round(health.lastActivityMs / 1000)}s)`
                : `SpecMem: Connection restored`;
            await this.server.sendLoggingMessage({
                level: 'warning',
                logger: 'specmem',
                data: message
            });
        }
        catch (err) {
            // If we can't send, connection is probably already gone
            logger.debug({ error: err }, 'Could not send health notification');
        }
    }
    /**
     * Deferred database initialization
     * Called after MCP connection is established to prevent timeout
     */
    async initializeDatabaseDeferred() {
        try {
            await this.db.initialize();
            logger.info('Database go brrrr - initialized (deferred)');
            // CRITICAL FIX: Initialize team comms tables
            // Without this, send_team_message/read_team_messages silently fall back to in-memory
            try {
                const pool = this.db.getPool();
                if (pool) {
                    await initTeamCommsDB(pool);
                    logger.info('Team comms DB initialized - tables created');
                }
                else {
                    logger.warn('No database pool available - team comms using in-memory fallback');
                }
            }
            catch (teamCommsError) {
                // Non-fatal - tools can still work with in-memory fallback
                logger.warn({ error: teamCommsError }, 'Team comms DB init failed - using in-memory fallback');
            }
            this.isFullyReady = true;
        }
        catch (error) {
            logger.error({ error }, 'Database initialization failed in deferred init');
            throw error;
        }
    }
    async shutdown() {
        // Prevent double-shutdown
        if (this.isShuttingDown) {
            logger.debug('Shutdown already in progress - skipping');
            return;
        }
        this.isShuttingDown = true;
        logger.info('Shutting down SpecMem server gracefully...');
        // Step 1: Stop health monitor first
        // This prevents health check events during shutdown
        if (this.healthMonitor) {
            // HIGH-19: Remove all event listeners to prevent memory leak
            this.healthMonitor.removeAllListeners();
            this.healthMonitor.stop();
            resetHealthMonitor();
            this.healthMonitor = null;
            logger.debug('Health monitor shutdown complete');
        }
        // Step 2: Stop embedding server manager
        // This gracefully kills the embedding server process using PID file
        if (this.embeddingServerManager) {
            try {
                // HIGH-19: Remove all event listeners to prevent memory leak
                this.embeddingServerManager.removeAllListeners();
                await this.embeddingServerManager.shutdown();
                await resetEmbeddingServerManager();
                this.embeddingServerManager = null;
                logger.debug('Embedding server manager shutdown complete');
            }
            catch (err) {
                logger.warn({ error: err }, 'Error shutting down embedding server manager');
            }
        }
        // Step 2.5: Stop Mini COT server manager
        if (this.miniCOTServerManager) {
            try {
                this.miniCOTServerManager.removeAllListeners();
                await this.miniCOTServerManager.shutdown();
                await resetMiniCOTServerManager();
                this.miniCOTServerManager = null;
                logger.debug('Mini COT server manager shutdown complete');
            }
            catch (err) {
                logger.warn({ error: err }, 'Error shutting down Mini COT server manager');
            }
        }
        // Step 3: Stop resilient transport monitoring
        // This prevents new connection events during shutdown
        if (this.resilientTransport) {
            // HIGH-19: Remove all event listeners to prevent memory leak
            this.resilientTransport.removeAllListeners();
            this.resilientTransport.shutdown();
            resetResilientTransport();
            this.resilientTransport = null;
            logger.debug('Resilient transport shutdown complete');
        }
        // Step 4: Try to send a goodbye message to 
        try {
            await this.server.sendLoggingMessage({
                level: 'notice',
                logger: 'specmem',
                data: 'SpecMem shutting down gracefully - see you next time!'
            });
        }
        catch (err) {
            // Connection may already be closed - that's fine
            logger.debug({ error: err }, 'Could not send shutdown notification');
        }
        // Step 5: Close database connections
        try {
            await this.db.close();
            logger.debug('Database connections closed');
        }
        catch (err) {
            logger.warn({ error: err }, 'Error closing database connections');
        }
        // Step 6: Close the MCP server connection
        try {
            await this.server.close();
            logger.debug('MCP server connection closed');
        }
        catch (err) {
            logger.warn({ error: err }, 'Error closing MCP server');
        }
        logger.info('SpecMem server shutdown complete - until next time');
    }
    getStats() {
        const totalCacheAccess = _SERVER_CACHE.hitCount + _SERVER_CACHE.missCount;
        return {
            uptime: Date.now() - this.startTime.getTime(),
            toolCalls: this.toolCallCount,
            cacheHitRate: totalCacheAccess > 0 ? _SERVER_CACHE.hitCount / totalCacheAccess : 0,
            lastError: this.lastError
        };
    }
    /**
     * Get the tool registry for dynamic tool registration
     *
     * Useful for plugins or extensions that want to add tools at runtime.
     * After registering new tools, call refreshToolList() to notify .
     */
    getToolRegistry() {
        return this.toolRegistry;
    }
    /**
     * Refresh the tool list and notify  of changes
     *
     * Call this after dynamically registering new tools to make them
     * immediately available to  without requiring an MCP restart.
     *
     * @example
     * ```typescript
     * const server = new SpecMemServer(embeddingProvider);
     * const registry = server.getToolRegistry();
     * registry.register(new MyCustomTool());
     * await server.refreshToolList(); //  now sees the new tool!
     * ```
     */
    async refreshToolList() {
        await this.notifyToolListReady();
    }
    /**
     * Reload tools without full restart (Tier 1 hot reload)
     *
     * This method supports hot reloading of tools and skills without requiring
     * a full MCP server restart. It's designed to be called via SIGHUP signal
     * for seamless updates during development or when skills/commands change.
     *
     * What it does:
     * 1. Re-scans skills directory to pick up new/changed skill files
     * 2. Reloads command handlers if they support dynamic reload
     * 3. Notifies  that the tool list has changed (triggers re-fetch)
     *
     * @example
     * ```bash
     * # From CLI - send SIGHUP to trigger reload
     * kill -HUP $(pgrep -f specmem)
     * ```
     */
    async reloadTools() {
        logger.info('[HotReload] Reloading tools and skills...');
        try {
            // Re-scan skills if skill scanner is available
            try {
                const skillScanner = getSkillScanner();
                if (skillScanner) {
                    // scan() re-reads all skill files from disk
                    const result = await skillScanner.scan();
                    logger.info({
                        skillCount: result.totalCount,
                        categoryCount: result.categories.size,
                        errors: result.errors.length
                    }, '[HotReload] Skills rescanned');
                }
            }
            catch (skillError) {
                logger.warn({ error: skillError }, '[HotReload] Skills reload skipped - scanner not available');
            }
            // Re-scan commands if command handler exists and supports reload
            if (this.commandHandler) {
                // Check if commandHandler has a reload method
                const handler = this.commandHandler;
                if (typeof handler.reload === 'function') {
                    await handler.reload();
                    logger.info('[HotReload] Commands reloaded');
                }
                else {
                    logger.debug('[HotReload] Command handler does not support reload');
                }
            }
            // Reload command loader for .md file prompts
            try {
                const commandLoader = getCommandLoader();
                if (commandLoader && typeof commandLoader.reload === 'function') {
                    await commandLoader.reload();
                    logger.info('[HotReload] Command prompts reloaded');
                }
            }
            catch (cmdLoaderError) {
                logger.debug({ error: cmdLoaderError }, '[HotReload] Command loader reload skipped');
            }
            // Notify  that tool list has changed
            await this.notifyToolListReady();
            logger.info('[HotReload] Tool list notification sent to ');
        }
        catch (error) {
            logger.error({ error }, '[HotReload] Failed to reload tools');
            throw error;
        }
    }
    /**
     * Get health status of the MCP server (#42)
     *
     * Returns comprehensive health check info fr fr
     * Now includes transport, database, and embedding health via centralized health monitor
     */
    getHealth() {
        const stats = this.getStats();
        // Get comprehensive health from health monitor if available
        if (this.healthMonitor) {
            const systemHealth = this.healthMonitor.getSystemHealth();
            // Get tool count
            const toolCount = this.toolRegistry.getToolDefinitions().length;
            // Get skill count
            let skillCount = 0;
            try {
                const scanner = getSkillScanner();
                skillCount = scanner.getAllSkills().length;
            }
            catch (e) {
                // Skills not available
            }
            // Get memory usage
            const memUsage = process.memoryUsage();
            const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
            // Map ComponentHealth to string status
            const mapHealth = (h) => {
                switch (h) {
                    case ComponentHealth.HEALTHY: return 'healthy';
                    case ComponentHealth.DEGRADED: return 'degraded';
                    case ComponentHealth.UNHEALTHY: return 'unhealthy';
                    default: return 'unhealthy';
                }
            };
            // Type guards for optional components - prevent null reference errors
            const dbComponent = systemHealth.components?.database;
            const embeddingComponent = systemHealth.components?.embedding;
            const transportComponent = systemHealth.components?.transport;
            return {
                status: mapHealth(systemHealth.overallHealth),
                uptime: stats.uptime,
                database: {
                    connected: dbComponent ? dbComponent.health !== ComponentHealth.UNHEALTHY : false,
                    health: dbComponent?.health ?? 'unknown',
                    errorCount: dbComponent?.errorCount ?? 0
                },
                embedding: {
                    available: embeddingComponent ? embeddingComponent.health === ComponentHealth.HEALTHY : false,
                    health: embeddingComponent?.health ?? 'unknown',
                    errorCount: embeddingComponent?.errorCount ?? 0
                },
                tools: { count: toolCount },
                skills: { count: skillCount },
                memory: { heapUsedMB, heapTotalMB },
                transport: {
                    state: transportComponent?.details?.state ?? 'unknown',
                    lastActivityMs: transportComponent?.details?.lastActivityMs ?? 0,
                    errorCount: transportComponent?.errorCount ?? 0
                },
                timestamp: systemHealth.timestamp
            };
        }
        // Fallback: legacy health check logic when health monitor not available
        // Check database connection
        let dbConnected = false;
        try {
            // Just check if db is initialized - actual query would be too expensive for health check
            dbConnected = this.db !== null;
        }
        catch (e) {
            dbConnected = false;
        }
        // Get tool count
        const toolCount = this.toolRegistry.getToolDefinitions().length;
        // Get skill count
        let skillCount = 0;
        try {
            const scanner = getSkillScanner();
            skillCount = scanner.getAllSkills().length;
        }
        catch (e) {
            // Skills not available
        }
        // Get memory usage
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        // Get transport health
        let transportState = 'unknown';
        let lastActivityMs = 0;
        let transportErrorCount = 0;
        if (this.resilientTransport) {
            const transportHealth = this.resilientTransport.getHealth();
            transportState = transportHealth.state;
            lastActivityMs = transportHealth.lastActivityMs;
            transportErrorCount = transportHealth.errorCount;
        }
        // Determine overall status - now includes transport health
        let status = 'healthy';
        if (!dbConnected) {
            status = 'unhealthy';
        }
        else if (transportState === ConnectionState.DISCONNECTED || transportState === ConnectionState.DISCONNECTING) {
            status = 'unhealthy';
        }
        else if (transportState === ConnectionState.DEGRADED || stats.lastError || heapUsedMB > 400 || transportErrorCount > 0) {
            status = 'degraded';
        }
        return {
            status,
            uptime: stats.uptime,
            database: { connected: dbConnected, health: dbConnected ? 'healthy' : 'unhealthy', errorCount: 0 },
            embedding: { available: false, health: 'unknown', errorCount: 0 },
            tools: { count: toolCount },
            skills: { count: skillCount },
            memory: { heapUsedMB, heapTotalMB },
            transport: { state: transportState, lastActivityMs, errorCount: transportErrorCount },
            timestamp: new Date().toISOString()
        };
    }
    /**
     * Get the health monitor instance for direct access
     * Useful for advanced health monitoring scenarios
     */
    getHealthMonitor() {
        return this.healthMonitor;
    }
    /**
     * Force a comprehensive health check immediately
     * Returns the full system health status
     */
    async forceHealthCheck() {
        if (this.healthMonitor) {
            return this.healthMonitor.forceHealthCheck();
        }
        return null;
    }
    /**
     * Get the embedding server manager instance
     * Useful for monitoring embedding server status
     */
    getEmbeddingServerManager() {
        return this.embeddingServerManager;
    }
    /**
     * Get embedding server status
     * Returns detailed status about the embedding server process
     */
    getEmbeddingServerStatus() {
        if (this.embeddingServerManager) {
            return this.embeddingServerManager.getStatus();
        }
        return null;
    }
    /**
     * Force restart the embedding server
     * Useful if embeddings are failing and you want to try a fresh start
     */
    async restartEmbeddingServer() {
        if (!this.embeddingServerManager) {
            logger.warn('[EmbeddingServerManager] Not initialized - cannot restart');
            return false;
        }
        logger.info('[EmbeddingServerManager] Manual restart requested');
        await this.embeddingServerManager.stop();
        return await this.embeddingServerManager.start();
    }
    /**
     * Get Mini COT server lifecycle manager
     * Returns the manager if initialized, null otherwise
     */
    getMiniCOTServerManager() {
        return this.miniCOTServerManager;
    }
    /**
     * Get Mini COT server status
     * Returns detailed status about the Mini COT server process
     */
    getMiniCOTServerStatus() {
        if (this.miniCOTServerManager) {
            return this.miniCOTServerManager.getStatus();
        }
        return null;
    }
    /**
     * Force restart the Mini COT server
     * Useful if COT analysis is failing and you want to try a fresh start
     */
    async restartMiniCOTServer() {
        if (!this.miniCOTServerManager) {
            logger.warn('[MiniCOTServerManager] Not initialized - cannot restart');
            return false;
        }
        logger.info('[MiniCOTServerManager] Manual restart requested');
        await this.miniCOTServerManager.stop();
        return await this.miniCOTServerManager.start();
    }
    /**
     * Start Mini COT server (if stopped)
     * Sets the stopped flag to false and starts the server
     */
    async startMiniCOTServer() {
        if (!this.miniCOTServerManager) {
            logger.warn('[MiniCOTServerManager] Not initialized - cannot start');
            return false;
        }
        return await this.miniCOTServerManager.start();
    }
    /**
     * Stop Mini COT server
     * Sets the stopped flag to true and stops the server
     */
    async stopMiniCOTServer() {
        if (!this.miniCOTServerManager) {
            logger.warn('[MiniCOTServerManager] Not initialized - cannot stop');
            return;
        }
        await this.miniCOTServerManager.stop();
    }
    /**
     * Notify  that the tool list is ready
     *
     * CRITICAL FOR TOOL AUTO-DISCOVERY:
     * This calls the MCP SDK's sendToolListChanged() method which sends a
     * notifications/tools/list_changed notification to  Code.
     *
     * When  receives this notification, it will:
     * 1. Invalidate its cached tool list
     * 2. Make a new ListToolsRequest to get the updated list
     * 3. Make all 39+ SpecMem tools available in its tool palette
     *
     * Without this notification,  may cache an empty or stale tool list
     * from the initial handshake before all tools are registered.
     *
     * The MCP protocol flow:
     * 1. Server -> Client: notifications/tools/list_changed
     * 2. Client -> Server: tools/list request
     * 3. Server -> Client: tools/list response with all 39 tools
     *
     * @see https://spec.modelcontextprotocol.io/specification/2024-11-05/server/tools/
     */
    async notifyToolListReady() {
        const timestamp = new Date().toISOString();
        const notifyId = `notify_${Date.now()}`;
        try {
            const toolCount = this.toolRegistry.getToolCount();
            // DEBUG: Log before sending notification
            logger.info({
                timestamp,
                notifyId,
                event: 'NOTIFY_TOOLS_START',
                toolCount
            }, '[MCP DEBUG] Sending tools/list_changed notification to ...');
            process.stderr.write(`[SPECMEM DEBUG ${timestamp}] Sending tools/list_changed notification (id: ${notifyId}, tools: ${toolCount})\n`);
            // Send the tools/list_changed notification
            // This is the KEY to making tools auto-discoverable!
            await this.server.sendToolListChanged();
            // DEBUG: Log success
            logger.info({
                timestamp,
                notifyId,
                event: 'NOTIFY_TOOLS_SUCCESS',
                toolCount
            }, '[MCP DEBUG] tools/list_changed notification sent successfully');
            process.stderr.write(`[SPECMEM DEBUG ${timestamp}] tools/list_changed sent successfully (id: ${notifyId})\n`);
            // Also send prompts/list_changed if we have prompts
            try {
                await this.server.sendPromptListChanged();
                logger.debug({ timestamp, event: 'NOTIFY_PROMPTS_SUCCESS' }, '[MCP DEBUG] prompts/list_changed sent');
            }
            catch (promptErr) {
                const promptError = promptErr instanceof Error ? promptErr : new Error(String(promptErr));
                logger.debug({
                    timestamp,
                    event: 'NOTIFY_PROMPTS_FAILED',
                    error: promptError.message
                }, '[MCP DEBUG] Could not send prompt list change notification');
            }
            // And resources/list_changed for completeness
            try {
                await this.server.sendResourceListChanged();
                logger.debug({ timestamp, event: 'NOTIFY_RESOURCES_SUCCESS' }, '[MCP DEBUG] resources/list_changed sent');
            }
            catch (resourceErr) {
                const resourceError = resourceErr instanceof Error ? resourceErr : new Error(String(resourceErr));
                logger.debug({
                    timestamp,
                    event: 'NOTIFY_RESOURCES_FAILED',
                    error: resourceError.message
                }, '[MCP DEBUG] Could not send resource list change notification');
            }
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            // DEBUG: Log the failure with full details
            logger.warn({
                timestamp,
                notifyId,
                event: 'NOTIFY_TOOLS_FAILED',
                error: error.message,
                stack: error.stack
            }, '[MCP DEBUG] FAILED to send tool list change notification -  may not see tools!');
            process.stderr.write(`[SPECMEM DEBUG ${timestamp}] FAILED to send tools/list_changed: ${error.message}\n`);
            // Fallback: Write to stderr for debugging
            process.stderr.write(`[SPECMEM] Tool list ready: ${this.toolRegistry.getToolCount()} tools registered (notification failed)\n`);
        }
    }
    /**
     * Announce specmem to  on startup
     *
     * yo this is the startup banner that lets  know we loaded fr fr
     * shows all tools, skills, and dashboard URL so  knows whats available
     */
    announceToOnStartup() {
        try {
            // get all available tools
            const tools = this.toolRegistry.getToolDefinitions();
            const commandTool = getCommandExecutorToolDefinition();
            // get skills if available
            let skills = [];
            try {
                const scanner = getSkillScanner();
                skills = scanner.getAllSkills().map(s => s.name);
            }
            catch (e) {
                // skills not available - this is fine, just means skills system not initialized
                logger.debug({ error: e }, 'skills scanner not available yet, that is ok fr fr');
            }
            // get dashboard URL from config - use getDashboardUrl helper for proper host handling
            const dashboardPort = parseInt(process.env['SPECMEM_DASHBOARD_PORT'] || '8595', 10);
            const dashboardHost = process.env['SPECMEM_DASHBOARD_HOST'] || '127.0.0.1';
            const dashboardEnabled = process.env['SPECMEM_DASHBOARD_ENABLED'] !== 'false';
            const dashboardUrl = dashboardEnabled ? getDashboardUrl(dashboardHost, dashboardPort) : null;
            // build the announcement message with emojis for CLI display
            const toolsList = tools.map(t => `  - ${t.name}: ${t.description?.split('.')[0] || 'no description'}`).join('\n');
            // Use emojis as specified in requirements
            let announcement = `SpecMem Loaded

Available Tools:
${toolsList}
  - ${commandTool.name}: ${commandTool.description?.split('.')[0] || 'Execute slash commands'}`;
            if (skills.length > 0) {
                announcement += `\n\nSkills: ${skills.join(', ')}`;
            }
            if (dashboardUrl) {
                // Include dashboard URL with emoji as specified
                announcement += `\n\nDashboard: ${dashboardUrl}`;
            }
            announcement += `\n\nType save_memory to store, find_memory to search.`;
            // FIX #11: Auto-announce with retry mechanism
            // The MCP connection might not be fully established when we first try to send
            // So we implement retry logic with exponential backoff
            const maxRetries = parseInt(process.env['SPECMEM_ANNOUNCE_MAX_RETRIES'] || '3', 10);
            const initialDelayMs = parseInt(process.env['SPECMEM_ANNOUNCE_RETRY_DELAY'] || '1000', 10);
            // Fire-and-forget with error logging - don't block startup on announcement
            this.sendAnnouncementWithRetry(announcement, maxRetries, initialDelayMs)
                .catch((err) => {
                logger.debug({ error: err }, 'Announcement retry chain failed - non-fatal');
            });
            logger.info('scheduled startup announcement to ');
        }
        catch (error) {
            logger.debug({ error }, 'failed to generate startup announcement - continuing anyway');
        }
    }
    /**
     * Send announcement with retry logic
     *
     * Implements exponential backoff retry for sending the startup announcement
     * because the MCP connection might not be fully ready on first attempt
     */
    async sendAnnouncementWithRetry(announcement, maxRetries, delayMs, attempt = 1) {
        try {
            // Check if debug mode is enabled
            const debugAnnounce = process.env['SPECMEM_DEBUG_ANNOUNCE'] === 'true';
            if (debugAnnounce) {
                logger.info({ attempt, announcement: announcement.slice(0, 200) }, 'attempting to send announcement');
            }
            await this.server.sendLoggingMessage({
                level: 'notice',
                logger: 'specmem',
                data: announcement
            });
            logger.info({ attempt }, 'successfully sent startup announcement to ');
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (attempt < maxRetries) {
                // Calculate delay with exponential backoff
                const nextDelay = delayMs * Math.pow(2, attempt - 1);
                logger.debug({
                    attempt,
                    maxRetries,
                    nextDelay,
                    error: error.message
                }, 'announcement send failed, scheduling retry');
                // Schedule retry
                setTimeout(() => {
                    this.sendAnnouncementWithRetry(announcement, maxRetries, delayMs, attempt + 1);
                }, nextDelay);
            }
            else {
                // All retries exhausted - log warning but don't crash
                logger.warn({
                    attempts: maxRetries,
                    error: error.message
                }, 'could not send startup announcement after all retries -  may not see tools list');
                // Alternative: try sending as a notification if logging fails
                try {
                    // Just log to stderr as fallback
                    logger.info('='.repeat(60));
                    logger.info('SPECMEM STARTUP - TOOLS AVAILABLE:');
                    logger.info(announcement);
                    logger.info('='.repeat(60));
                }
                catch (fallbackError) {
                    // Truly silent fail - we tried our best
                }
            }
        }
    }
}
export { _SERVER_CACHE };
//# sourceMappingURL=specMemServer.js.map