/**
 * server.ts - TeamMember Coordination HTTP/WebSocket Server
 *
 * Production-ready coordination server using Express + ws for
 * inter-team member communication. Integrates with LWJEB event bus
 * for sub-10ms event propagation.
 *
 * Features:
 * - WebSocket endpoint for real-time team member communication
 * - REST API for team member registration and events
 * - Heartbeat monitoring with automatic cleanup
 * - Event broadcast to all connected team members
 * - LWJEB event bus integration
 *
 * @author hardwicksoftwareservices
 */
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { createTeamMemberRegisteredEvent, createTeamMemberHeartbeatEvent } from './events.js';
import { getTeamMemberRegistry } from './TeamMemberRegistry.js';
import { CoordinationEventDispatcher } from './handlers.js';
import { logger } from '../utils/logger.js';
import { isPortAvailable, sleep } from '../utils/portUtils.js';
import { getCoordinationPort, getDashboardPort } from '../utils/portAllocator.js';
/**
 * Default configuration - uses dynamic ports from portAllocator for per-project isolation
 */
function getDefaultConfig() {
    const coordPort = getCoordinationPort();
    const dashPort = getDashboardPort();
    return {
        port: coordPort,
        host: '127.0.0.1',
        heartbeatIntervalMs: 10000,
        heartbeatTimeoutMs: 30000,
        maxMessageSize: 1024 * 1024, // 1MB
        enableCors: true,
        allowedOrigins: [
            `http://localhost:${coordPort}`,
            `http://127.0.0.1:${coordPort}`,
            `http://localhost:${dashPort}`,
            `http://127.0.0.1:${dashPort}`
        ],
        maxPortAttempts: 10,
        maxStartupRetries: 3,
        retryDelayMs: 1000
    };
}
const DEFAULT_CONFIG = getDefaultConfig();
// ============================================================================
// Coordination Server
// ============================================================================
/**
 * CoordinationServer - HTTP/WebSocket server for team member coordination
 *
 * Provides:
 * - WebSocket endpoint: ws://host:port/teamMembers
 * - REST endpoints: POST /team-members/register, POST /team-members/event
 * - Real-time event broadcast to connected team members
 * - Integration with LWJEB event bus
 */
export class CoordinationServer {
    config;
    server;
    wss;
    registry;
    dispatcher;
    connections = new Map();
    teamMemberToConnection = new Map();
    heartbeatInterval = null;
    isRunning = false;
    startTime = 0;
    actualPort = 0; // The port we actually bound to
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        // Initialize registry with matching heartbeat timeout
        this.registry = getTeamMemberRegistry({
            heartbeatTimeoutMs: this.config.heartbeatTimeoutMs,
            autoCleanup: true
        });
        // Create HTTP server
        this.server = createServer(this.handleHttpRequest.bind(this));
        // Create WebSocket server
        this.wss = new WebSocketServer({
            noServer: true,
            maxPayload: this.config.maxMessageSize
        });
        // Initialize event dispatcher
        this.dispatcher = new CoordinationEventDispatcher(this.registry, this.broadcast.bind(this), this.sendToTeamMember.bind(this));
        // Setup upgrade handling for WebSocket
        this.server.on('upgrade', this.handleUpgrade.bind(this));
        // Setup WebSocket connection handling
        this.wss.on('connection', this.handleConnection.bind(this));
        // Listen to registry events
        this.setupRegistryListeners();
        logger.info({ config: this.config }, 'CoordinationServer created');
    }
    /**
     * Start the server with port retry logic
     * Will try multiple ports if the base port is in use
     */
    async start() {
        if (this.isRunning) {
            logger.warn('Server already running');
            return;
        }
        const { maxPortAttempts, maxStartupRetries, retryDelayMs } = this.config;
        for (let portOffset = 0; portOffset < maxPortAttempts; portOffset++) {
            const port = this.config.port + portOffset;
            // Check port availability first
            const available = await isPortAvailable(port, this.config.host);
            if (!available) {
                logger.debug({ port, host: this.config.host }, 'Port already in use, trying next');
                continue;
            }
            // Try to start the server with retries
            for (let retry = 0; retry < maxStartupRetries; retry++) {
                try {
                    await this.startOnPort(port);
                    this.actualPort = port;
                    return; // Success!
                }
                catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    // Check if it's a port-in-use error (race condition)
                    if (error.message.includes('EADDRINUSE') || error.code === 'EADDRINUSE') {
                        logger.warn({ port }, 'Port became unavailable during startup, trying next');
                        break; // Try next port
                    }
                    logger.warn({
                        port,
                        retry: retry + 1,
                        maxRetries: maxStartupRetries,
                        error: error.message
                    }, 'Coordination server startup failed, retrying');
                    // Wait before retry with exponential backoff
                    if (retry < maxStartupRetries - 1) {
                        await sleep(retryDelayMs * Math.pow(2, retry));
                    }
                }
            }
        }
        // All attempts failed
        const errorMsg = `Failed to start coordination server on any port in range ${this.config.port}-${this.config.port + maxPortAttempts - 1}`;
        logger.error({ basePort: this.config.port, maxPortAttempts }, errorMsg);
        throw new Error(errorMsg);
    }
    /**
     * Internal method to start server on a specific port
     */
    startOnPort(port) {
        return new Promise((resolve, reject) => {
            // Set up error handler before listening to catch EADDRINUSE
            const errorHandler = (error) => {
                // Remove error handler to prevent memory leak
                this.server.removeListener('error', errorHandler);
                logger.error({ error, port }, 'Server error during startup');
                reject(error);
            };
            this.server.once('error', errorHandler);
            this.server.listen(port, this.config.host, () => {
                // Remove error handler on success
                this.server.removeListener('error', errorHandler);
                this.isRunning = true;
                this.startTime = Date.now();
                this.actualPort = port;
                // Start heartbeat checking
                this.startHeartbeatInterval();
                // Set up persistent error handler for runtime errors
                this.server.on('error', (error) => {
                    logger.error({ error, port: this.actualPort }, 'Server runtime error');
                    // Don't crash - emit degraded status instead
                    this.emitServerStatus('degraded');
                });
                logger.info({
                    port,
                    configuredPort: this.config.port,
                    host: this.config.host,
                    wsEndpoint: `ws://${this.config.host}:${port}/teamMembers`
                }, 'CoordinationServer started');
                // Emit server status event
                this.emitServerStatus('ready');
                resolve();
            });
        });
    }
    /**
     * Stop the server
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        // Emit shutdown status
        this.emitServerStatus('shutting_down');
        // Stop heartbeat interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        // Close all WebSocket connections
        for (const conn of this.connections.values()) {
            conn.ws.close(1001, 'Server shutting down');
        }
        // Clear connections
        this.connections.clear();
        this.teamMemberToConnection.clear();
        // Shutdown dispatcher
        await this.dispatcher.shutdown();
        // Close HTTP server
        return new Promise((resolve) => {
            this.server.close(() => {
                this.isRunning = false;
                logger.info('CoordinationServer stopped');
                resolve();
            });
        });
    }
    /**
     * Handle HTTP requests (REST API)
     */
    handleHttpRequest(req, res) {
        // Set CORS headers
        if (this.config.enableCors) {
            const origin = req.headers.origin || '*';
            if (this.config.allowedOrigins.includes('*') ||
                this.config.allowedOrigins.includes(origin)) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            }
        }
        // Handle preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathname = url.pathname;
        // Route requests
        if (pathname === '/health' && req.method === 'GET') {
            this.handleHealthCheck(req, res);
        }
        else if (pathname === '/team-members/register' && req.method === 'POST') {
            this.handleRegisterTeamMember(req, res);
        }
        else if (pathname === '/team-members/event' && req.method === 'POST') {
            this.handleEventPost(req, res);
        }
        else if (pathname === '/teamMembers' && req.method === 'GET') {
            this.handleGetTeamMembers(req, res);
        }
        else if (pathname === '/metrics' && req.method === 'GET') {
            this.handleGetMetrics(req, res);
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    }
    /**
     * Handle health check endpoint
     */
    handleHealthCheck(req, res) {
        const stats = this.registry.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            uptime: Date.now() - this.startTime,
            teamMembers: stats.totalTeamMembers,
            connections: this.connections.size
        }));
    }
    /**
     * Handle team member registration via REST API
     */
    handleRegisterTeamMember(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > this.config.maxMessageSize) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Request too large' }));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                // Validate required fields
                if (!data.teamMemberId || !data.name || !data.type) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields: teamMemberId, name, type' }));
                    return;
                }
                const teamMemberInfo = {
                    teamMemberId: data.teamMemberId,
                    name: data.name,
                    type: data.type,
                    capabilities: data.capabilities ?? [],
                    priority: data.priority ?? 'normal',
                    metadata: data.metadata
                };
                // Register team member
                const entry = this.registry.register(teamMemberInfo);
                // Dispatch registration event
                const event = createTeamMemberRegisteredEvent(teamMemberInfo);
                this.dispatcher.dispatchAsync(event);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    teamMemberId: data.teamMemberId,
                    registeredAt: entry.registeredAt
                }));
            }
            catch (error) {
                logger.error({ error }, 'Error registering team member via REST');
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        });
    }
    /**
     * Handle event posting via REST API
     */
    handleEventPost(req, res) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > this.config.maxMessageSize) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Request too large' }));
                req.destroy();
            }
        });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (!data.event || !data.event.type) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing event or event type' }));
                    return;
                }
                // Add timestamp if not present
                if (!data.event.timestamp) {
                    data.event.timestamp = Date.now();
                }
                // Dispatch event
                await this.dispatcher.dispatch(data.event);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    eventType: data.event.type,
                    timestamp: data.event.timestamp
                }));
            }
            catch (error) {
                logger.error({ error }, 'Error posting event via REST');
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        });
    }
    /**
     * Handle get team members endpoint
     */
    handleGetTeamMembers(req, res) {
        const teamMembers = this.registry.getAll().map(entry => ({
            teamMemberId: entry.teamMember.teamMemberId,
            name: entry.teamMember.name,
            type: entry.teamMember.type,
            state: entry.state,
            capabilities: entry.teamMember.capabilities,
            priority: entry.teamMember.priority,
            registeredAt: entry.registeredAt,
            lastHeartbeat: entry.lastHeartbeat,
            connected: this.teamMemberToConnection.has(entry.teamMember.teamMemberId)
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ teamMembers }));
    }
    /**
     * Handle get metrics endpoint
     */
    handleGetMetrics(req, res) {
        const registryStats = this.registry.getStats();
        const dispatcherMetrics = this.dispatcher.getMetrics();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            registry: registryStats,
            dispatcher: dispatcherMetrics,
            connections: {
                total: this.connections.size,
                authenticated: this.teamMemberToConnection.size
            },
            uptime: Date.now() - this.startTime
        }));
    }
    /**
     * Handle WebSocket upgrade
     */
    handleUpgrade(request, socket, head) {
        const url = new URL(request.url || '/', `http://${request.headers.host}`);
        if (url.pathname === '/teamMembers') {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request);
            });
        }
        else {
            socket.destroy();
        }
    }
    /**
     * Handle new WebSocket connection
     */
    handleConnection(ws, request) {
        const connectionId = randomUUID();
        const connection = {
            ws,
            connectionId,
            isAlive: true,
            connectedAt: Date.now(),
            lastMessage: Date.now()
        };
        this.connections.set(connectionId, connection);
        logger.info({ connectionId }, 'New WebSocket connection');
        // Setup ping/pong for heartbeat
        ws.on('pong', () => {
            connection.isAlive = true;
        });
        // Handle messages
        ws.on('message', (data) => {
            this.handleWebSocketMessage(connection, data);
        });
        // Handle close
        ws.on('close', (code, reason) => {
            this.handleWebSocketClose(connection, code, reason.toString());
        });
        // Handle errors
        ws.on('error', (error) => {
            logger.error({ connectionId, error }, 'WebSocket error');
        });
        // Send welcome message
        this.sendToConnection(connection, {
            type: 'server:status',
            timestamp: Date.now(),
            teamMemberId: 'server',
            status: 'ready',
            connectedTeamMembers: this.registry.size,
            uptime: Date.now() - this.startTime
        });
    }
    /**
     * Handle WebSocket message
     */
    handleWebSocketMessage(connection, data) {
        connection.lastMessage = Date.now();
        connection.isAlive = true;
        try {
            const message = JSON.parse(data.toString());
            // Handle different message types
            if (message.type === 'register') {
                this.handleWsRegister(connection, message);
            }
            else if (message.type === 'heartbeat') {
                this.handleWsHeartbeat(connection, message);
            }
            else if (message.type === 'sync') {
                this.handleWsSync(connection);
            }
            else if (message.type && message.teamMemberId) {
                // It's a coordination event
                this.handleWsEvent(connection, message);
            }
            else {
                logger.warn({ connectionId: connection.connectionId }, 'Unknown message type');
            }
        }
        catch (error) {
            logger.error({ connectionId: connection.connectionId, error }, 'Error parsing WebSocket message');
            this.sendToConnection(connection, {
                type: 'teamMember:error',
                timestamp: Date.now(),
                teamMemberId: 'server',
                error: {
                    code: 'PARSE_ERROR',
                    message: 'Failed to parse message',
                    recoverable: true
                },
                severity: 'warning'
            });
        }
    }
    /**
     * Handle WebSocket registration
     */
    handleWsRegister(connection, message) {
        try {
            // Determine team member type - prefer teamMemberType, but also accept 'type' if it's not the message type 'register'
            const teamMemberTypeValue = message.teamMemberType || (message.type !== 'register' ? message.type : undefined) || 'unknown';
            const teamMemberInfo = {
                teamMemberId: message.teamMemberId,
                name: message.name,
                type: teamMemberTypeValue,
                capabilities: message.capabilities ?? [],
                priority: message.priority ?? 'normal',
                metadata: message.metadata
            };
            // Register team member
            const entry = this.registry.register(teamMemberInfo, connection.connectionId);
            connection.teamMemberId = teamMemberInfo.teamMemberId;
            // Map team member to connection
            this.teamMemberToConnection.set(teamMemberInfo.teamMemberId, connection.connectionId);
            // Dispatch registration event
            const event = createTeamMemberRegisteredEvent(teamMemberInfo);
            this.dispatcher.dispatchAsync(event);
            // Send confirmation
            this.sendToConnection(connection, {
                type: 'registered',
                teamMemberId: teamMemberInfo.teamMemberId,
                timestamp: Date.now(),
                registeredAt: entry.registeredAt
            });
            logger.info({
                teamMemberId: teamMemberInfo.teamMemberId,
                connectionId: connection.connectionId
            }, 'Team Member registered via WebSocket');
        }
        catch (error) {
            logger.error({ connectionId: connection.connectionId, error }, 'Registration failed');
            this.sendToConnection(connection, {
                type: 'teamMember:error',
                timestamp: Date.now(),
                teamMemberId: 'server',
                error: {
                    code: 'REGISTRATION_FAILED',
                    message: error instanceof Error ? error.message : 'Registration failed',
                    recoverable: true
                },
                severity: 'error'
            });
        }
    }
    /**
     * Handle WebSocket heartbeat
     */
    handleWsHeartbeat(connection, message) {
        if (!connection.teamMemberId) {
            return;
        }
        const entry = this.registry.heartbeat(connection.teamMemberId, message.state);
        if (entry) {
            // Create and dispatch heartbeat event
            const event = createTeamMemberHeartbeatEvent(connection.teamMemberId, entry.state, Date.now() - entry.registeredAt);
            this.dispatcher.dispatchAsync(event);
        }
    }
    /**
     * Handle WebSocket sync request
     */
    handleWsSync(connection) {
        const state = this.registry.exportState();
        const syncResponse = {
            type: 'server:sync_response',
            timestamp: Date.now(),
            teamMemberId: 'server',
            teamMembers: state.teamMembers,
            states: state.states
        };
        this.sendToConnection(connection, syncResponse);
    }
    /**
     * Handle WebSocket coordination event
     */
    handleWsEvent(connection, event) {
        // Verify team member is registered if event has teamMemberId
        if (event.teamMemberId && event.teamMemberId !== 'server' && !this.registry.has(event.teamMemberId)) {
            logger.warn({ teamMemberId: event.teamMemberId }, 'Event from unregistered team member');
            return;
        }
        // Dispatch through event bus
        this.dispatcher.dispatchAsync(event);
    }
    /**
     * Handle WebSocket close
     */
    handleWebSocketClose(connection, code, reason) {
        logger.info({
            connectionId: connection.connectionId,
            teamMemberId: connection.teamMemberId,
            code,
            reason
        }, 'WebSocket connection closed');
        // Clean up team member mapping
        if (connection.teamMemberId) {
            this.teamMemberToConnection.delete(connection.teamMemberId);
            // Unregister team member if connected via WebSocket
            this.registry.unregister(connection.teamMemberId, code === 1000 ? 'normal' : 'error');
        }
        // Remove connection
        this.connections.delete(connection.connectionId);
    }
    /**
     * Setup registry event listeners
     */
    setupRegistryListeners() {
        this.registry.on('teamMember:registered', (event) => {
            // Broadcast to all connections
            this.broadcast(event);
        });
        this.registry.on('teamMember:disconnected', (event) => {
            // Broadcast to all connections
            this.broadcast(event);
        });
        this.registry.on('teamMember:state_changed', ({ teamMemberId, oldState, newState }) => {
            logger.debug({ teamMemberId, oldState, newState }, 'Team Member state changed');
        });
    }
    /**
     * Broadcast event to all connected team members
     */
    broadcast(event, excludeTeamMemberId) {
        const startTime = performance.now();
        let sent = 0;
        for (const conn of this.connections.values()) {
            if (excludeTeamMemberId && conn.teamMemberId === excludeTeamMemberId) {
                continue;
            }
            if (conn.ws.readyState === WebSocket.OPEN) {
                this.sendToConnection(conn, event);
                sent++;
            }
        }
        const duration = performance.now() - startTime;
        if (duration > 10) {
            logger.warn({
                eventType: event.type,
                duration,
                recipients: sent
            }, 'Broadcast exceeded 10ms target');
        }
    }
    /**
     * Send event to specific teamMember
     */
    sendToTeamMember(teamMemberId, event) {
        const connectionId = this.teamMemberToConnection.get(teamMemberId);
        if (!connectionId) {
            return false;
        }
        const connection = this.connections.get(connectionId);
        if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        this.sendToConnection(connection, event);
        return true;
    }
    /**
     * Send message to connection
     */
    sendToConnection(connection, message) {
        try {
            connection.ws.send(JSON.stringify(message));
        }
        catch (error) {
            logger.error({
                connectionId: connection.connectionId,
                error
            }, 'Failed to send message');
        }
    }
    /**
     * Start heartbeat checking interval
     */
    startHeartbeatInterval() {
        this.heartbeatInterval = setInterval(() => {
            for (const conn of this.connections.values()) {
                if (!conn.isAlive) {
                    // Connection didn't respond to ping
                    logger.info({ connectionId: conn.connectionId }, 'Terminating unresponsive connection');
                    conn.ws.terminate();
                    continue;
                }
                conn.isAlive = false;
                conn.ws.ping();
            }
        }, this.config.heartbeatIntervalMs);
        // Allow process to exit
        if (this.heartbeatInterval.unref) {
            this.heartbeatInterval.unref();
        }
    }
    /**
     * Emit server status event
     */
    emitServerStatus(status) {
        const event = {
            type: 'server:status',
            timestamp: Date.now(),
            teamMemberId: 'server',
            status,
            connectedTeamMembers: this.registry.size,
            uptime: Date.now() - this.startTime
        };
        this.broadcast(event);
    }
    /**
     * Get server status
     */
    getStatus() {
        return {
            running: this.isRunning,
            port: this.actualPort || this.config.port,
            configuredPort: this.config.port,
            uptime: this.isRunning ? Date.now() - this.startTime : 0,
            connections: this.connections.size,
            teamMembers: this.registry.size
        };
    }
    /**
     * Get the actual port the server is bound to
     */
    getActualPort() {
        return this.actualPort || this.config.port;
    }
    /**
     * Get the team member registry
     */
    getRegistry() {
        return this.registry;
    }
    /**
     * Get the event dispatcher
     */
    getDispatcher() {
        return this.dispatcher;
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create and optionally start a coordination server
 */
export async function createCoordinationServer(config, autoStart = false) {
    const server = new CoordinationServer(config);
    if (autoStart) {
        await server.start();
    }
    return server;
}
// ============================================================================
// Singleton Instance (Legacy - Use LazyCoordinationServer instead)
// ============================================================================
let globalServer = null;
/**
 * Get the global coordination server
 * @deprecated Use getLazyCoordinationServer() instead for on-demand initialization
 */
export function getCoordinationServer(config) {
    if (!globalServer) {
        globalServer = new CoordinationServer(config);
    }
    return globalServer;
}
/**
 * Reset the global server (for testing)
 * @deprecated Use resetLazyCoordinationServer() instead
 */
export async function resetCoordinationServer() {
    if (globalServer) {
        await globalServer.stop();
        globalServer = null;
    }
}
/**
 * Global lazy coordination server state
 */
const lazyState = {
    server: null,
    starting: false,
    startPromise: null,
    config: null,
    disabled: false,
    lastError: null,
    shutdownRegistered: false,
};
/**
 * List of shutdown handlers to call when MCP server exits
 */
const shutdownHandlers = [];
/**
 * Configure the lazy coordination server
 * Call this during MCP initialization to set port and other config
 * The server won't start until first team feature is used
 *
 * @param config Server configuration (port, host, etc.)
 */
export function configureLazyCoordinationServer(config) {
    lazyState.config = config;
    logger.info({ config }, 'LazyCoordinationServer: configured (will start on first use)');
}
/**
 * Disable the lazy coordination server
 * Call this if SPECMEM_COORDINATION_ENABLED=false
 */
export function disableLazyCoordinationServer() {
    lazyState.disabled = true;
    logger.info('LazyCoordinationServer: disabled via configuration');
}
/**
 * Check if the coordination server is running
 */
export function isCoordinationServerRunning() {
    return lazyState.server !== null && lazyState.server.getStatus().running;
}
/**
 * Check if the coordination server is available (running or can be started)
 */
export function isCoordinationServerAvailable() {
    if (lazyState.disabled) {
        return false;
    }
    if (lazyState.server !== null) {
        return lazyState.server.getStatus().running;
    }
    // Can be started on demand
    return true;
}
/**
 * Get the lazy coordination server, starting it if necessary
 * This is the main entry point for team member features
 *
 * @returns The coordination server instance, or null if disabled
 * @throws Error if server startup fails
 */
export async function getLazyCoordinationServer() {
    // Check if disabled
    if (lazyState.disabled) {
        logger.debug('LazyCoordinationServer: disabled, returning null');
        return null;
    }
    // Return existing server if running
    if (lazyState.server !== null && lazyState.server.getStatus().running) {
        return lazyState.server;
    }
    // Wait for pending start if already starting
    if (lazyState.starting && lazyState.startPromise) {
        logger.debug('LazyCoordinationServer: waiting for pending start');
        await lazyState.startPromise;
        return lazyState.server;
    }
    // Start the server
    lazyState.starting = true;
    lazyState.startPromise = startLazyServer();
    try {
        await lazyState.startPromise;
        return lazyState.server;
    }
    catch (error) {
        lazyState.lastError = error instanceof Error ? error : new Error(String(error));
        throw error;
    }
    finally {
        lazyState.starting = false;
        lazyState.startPromise = null;
    }
}
/**
 * Internal function to start the lazy server
 */
async function startLazyServer() {
    logger.info('LazyCoordinationServer: starting on first team feature use...');
    // Create the server with configured options
    const config = lazyState.config || {};
    lazyState.server = new CoordinationServer(config);
    // Register shutdown handler if not already done
    if (!lazyState.shutdownRegistered) {
        registerLazyShutdownHandler(async () => {
            if (lazyState.server) {
                await lazyState.server.stop();
                lazyState.server = null;
            }
        });
        lazyState.shutdownRegistered = true;
    }
    // Start with retries
    const maxRetries = config.maxStartupRetries || 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await lazyState.server.start();
            const status = lazyState.server.getStatus();
            logger.info({
                port: status.port,
                configuredPort: status.configuredPort,
                attempt,
            }, 'LazyCoordinationServer: started successfully');
            return;
        }
        catch (error) {
            logger.warn({
                error: error instanceof Error ? error.message : String(error),
                attempt,
                maxRetries,
            }, 'LazyCoordinationServer: startup attempt failed');
            if (attempt < maxRetries) {
                // Wait with exponential backoff
                const delay = 1000 * Math.pow(2, attempt - 1);
                await sleep(delay);
            }
            else {
                // All retries exhausted
                lazyState.server = null;
                throw error;
            }
        }
    }
}
/**
 * Register a shutdown handler to be called when the MCP server exits
 * This ensures clean shutdown of the coordination server
 */
export function registerLazyShutdownHandler(handler) {
    shutdownHandlers.push(handler);
}
/**
 * Execute all shutdown handlers
 * Call this from the MCP server's graceful shutdown
 */
export async function executeLazyShutdownHandlers() {
    logger.info({ handlerCount: shutdownHandlers.length }, 'LazyCoordinationServer: executing shutdown handlers');
    for (const handler of shutdownHandlers) {
        try {
            await handler();
        }
        catch (error) {
            logger.error({ error }, 'LazyCoordinationServer: shutdown handler failed');
        }
    }
    shutdownHandlers.length = 0;
}
/**
 * Reset the lazy coordination server (for testing)
 */
export async function resetLazyCoordinationServer() {
    if (lazyState.server) {
        await lazyState.server.stop();
    }
    lazyState.server = null;
    lazyState.starting = false;
    lazyState.startPromise = null;
    lazyState.config = null;
    lazyState.disabled = false;
    lazyState.lastError = null;
    lazyState.shutdownRegistered = false;
    shutdownHandlers.length = 0;
    logger.info('LazyCoordinationServer: reset complete');
}
/**
 * Get status of the lazy coordination server
 */
export function getLazyCoordinationServerStatus() {
    return {
        configured: lazyState.config !== null,
        disabled: lazyState.disabled,
        running: lazyState.server !== null && lazyState.server.getStatus().running,
        starting: lazyState.starting,
        port: lazyState.server?.getActualPort() ?? null,
        lastError: lazyState.lastError?.message ?? null,
    };
}
/**
 * Require the coordination server to be running
 * Throws a user-friendly error if it's disabled
 *
 * @param featureName Name of the feature requiring the server (for error message)
 * @returns The running coordination server
 * @throws Error if server is disabled or fails to start
 */
export async function requireCoordinationServer(featureName) {
    if (lazyState.disabled) {
        throw new Error(`${featureName} requires the coordination server, but it is disabled. ` +
            `Set SPECMEM_COORDINATION_ENABLED=true to enable team member features.`);
    }
    const server = await getLazyCoordinationServer();
    if (!server) {
        throw new Error(`${featureName} requires the coordination server, but it failed to start. ` +
            `Check logs for details.`);
    }
    return server;
}
//# sourceMappingURL=server.js.map