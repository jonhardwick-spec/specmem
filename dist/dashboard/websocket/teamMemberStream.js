/**
 * teamMemberStream.ts - WebSocket Handler for Real-Time TeamMember Updates
 *
 * Phase 2: Real-time team member status updates and communications
 *
 * Features:
 * - /ws/team-members/live - Real-time team member session updates
 * - Broadcasts team member status changes
 * - Broadcasts new communications
 * - Client subscription management
 */
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../../utils/logger.js';
// ============================================================================
// TeamMember Stream WebSocket Manager
// ============================================================================
export class TeamMemberStreamManager {
    wss;
    clients = new Map();
    pingInterval = null;
    messageQueue = [];
    maxQueueSize = 100;
    path;
    constructor(server, path = '/ws/team-members/live') {
        this.path = path;
        // CRITICAL FIX: Use noServer mode to prevent duplicate upgrade handler conflicts
        // When multiple WebSocketServers are attached to the same HTTP server with
        // { server: xxx }, they ALL receive the 'upgrade' event and try to handle it.
        // The one that doesn't match the path sends a 400 error AFTER another WSS
        // has already completed the upgrade, causing the RSV1/1006 close bug.
        this.wss = new WebSocketServer({
            noServer: true,
            perMessageDeflate: false // Disable compression for lower latency
        });
        // Manually handle upgrade events for our specific path
        server.on('upgrade', (request, socket, head) => {
            const url = new URL(request.url || '/', `http://${request.headers.host}`);
            // Only handle requests for our specific path
            if (url.pathname === this.path) {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            }
            // Don't do anything for other paths - let other handlers deal with them
        });
        this.setupWebSocket();
        this.startPingInterval();
        logger.info({ path }, 'Team Member WebSocket stream initialized (noServer mode)');
    }
    setupWebSocket() {
        this.wss.on('connection', (ws, request) => {
            const clientId = this.generateClientId();
            const client = {
                ws,
                id: clientId,
                subscriptions: new Set(['*']), // Subscribe to all by default
                connectedAt: new Date(),
                lastPing: new Date()
            };
            this.clients.set(clientId, client);
            logger.info({ clientId, totalClients: this.clients.size }, 'Team Member stream client connected');
            // Send welcome message
            this.sendToClient(client, {
                type: 'heartbeat',
                data: {
                    clientId,
                    message: 'Connected to team member stream',
                    activeClients: this.clients.size
                },
                timestamp: new Date().toISOString()
            });
            // Send any queued messages
            this.flushQueueToClient(client);
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleClientMessage(client, message);
                }
                catch (error) {
                    this.sendToClient(client, {
                        type: 'error',
                        data: { message: 'Invalid message format' },
                        timestamp: new Date().toISOString()
                    });
                }
            });
            ws.on('pong', () => {
                client.lastPing = new Date();
            });
            ws.on('close', () => {
                this.clients.delete(clientId);
                logger.info({ clientId, totalClients: this.clients.size }, 'Team Member stream client disconnected');
            });
            ws.on('error', (error) => {
                logger.error({ clientId, error }, 'Team Member stream client error');
                this.clients.delete(clientId);
            });
        });
        this.wss.on('error', (error) => {
            logger.error({ error }, 'Team Member WebSocket server error');
        });
    }
    handleClientMessage(client, message) {
        const action = message.action;
        switch (action) {
            case 'subscribe':
                // Subscribe to specific session updates
                const sessionId = message.sessionId;
                if (sessionId) {
                    client.subscriptions.add(sessionId);
                    this.sendToClient(client, {
                        type: 'heartbeat',
                        data: { message: `Subscribed to session ${sessionId}` },
                        timestamp: new Date().toISOString()
                    });
                }
                break;
            case 'unsubscribe':
                // Unsubscribe from specific session
                const unsubId = message.sessionId;
                if (unsubId) {
                    client.subscriptions.delete(unsubId);
                    this.sendToClient(client, {
                        type: 'heartbeat',
                        data: { message: `Unsubscribed from session ${unsubId}` },
                        timestamp: new Date().toISOString()
                    });
                }
                break;
            case 'subscribe_all':
                // Subscribe to all updates
                client.subscriptions.add('*');
                this.sendToClient(client, {
                    type: 'heartbeat',
                    data: { message: 'Subscribed to all sessions' },
                    timestamp: new Date().toISOString()
                });
                break;
            case 'ping':
                // Respond to client ping
                this.sendToClient(client, {
                    type: 'heartbeat',
                    data: { message: 'pong', serverTime: new Date().toISOString() },
                    timestamp: new Date().toISOString()
                });
                break;
            case 'get_status':
                // Send current status
                this.sendToClient(client, {
                    type: 'heartbeat',
                    data: {
                        clientId: client.id,
                        subscriptions: Array.from(client.subscriptions),
                        connectedAt: client.connectedAt.toISOString(),
                        activeClients: this.clients.size
                    },
                    timestamp: new Date().toISOString()
                });
                break;
            default:
                this.sendToClient(client, {
                    type: 'error',
                    data: { message: `Unknown action: ${action}` },
                    timestamp: new Date().toISOString()
                });
        }
    }
    sendToClient(client, message) {
        if (client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(message));
            }
            catch (error) {
                logger.warn({ clientId: client.id, error }, 'Failed to send message to client');
            }
        }
    }
    flushQueueToClient(client) {
        for (const message of this.messageQueue) {
            if (this.shouldReceiveMessage(client, message)) {
                this.sendToClient(client, message);
            }
        }
    }
    shouldReceiveMessage(client, message) {
        // If subscribed to all, receive everything
        if (client.subscriptions.has('*')) {
            return true;
        }
        // Otherwise, check if subscribed to the specific session
        if (message.sessionId && client.subscriptions.has(message.sessionId)) {
            return true;
        }
        return false;
    }
    startPingInterval() {
        // Ping clients every 30 seconds to keep connections alive
        this.pingInterval = setInterval(() => {
            const now = Date.now();
            const staleTimeout = 60000; // 60 seconds
            for (const [clientId, client] of this.clients.entries()) {
                // Check for stale connections
                if (now - client.lastPing.getTime() > staleTimeout) {
                    logger.warn({ clientId }, 'Closing stale team member stream connection');
                    client.ws.terminate();
                    this.clients.delete(clientId);
                    continue;
                }
                // Send ping
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.ping();
                }
            }
        }, 30000);
    }
    generateClientId() {
        return `teamMember_ws_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    // ============================================================================
    // Public Methods for Broadcasting
    // ============================================================================
    /**
     * Broadcast a message to all subscribed clients
     */
    broadcast(message) {
        // Add to queue for new clients
        this.messageQueue.push(message);
        if (this.messageQueue.length > this.maxQueueSize) {
            this.messageQueue.shift();
        }
        // Send to all connected clients
        for (const client of this.clients.values()) {
            if (this.shouldReceiveMessage(client, message)) {
                this.sendToClient(client, message);
            }
        }
    }
    /**
     * Broadcast team member status change
     */
    broadcastTeamMemberStatus(sessionId, teamMemberType, status, data) {
        this.broadcast({
            type: 'teamMember_status',
            sessionId,
            teamMemberType,
            data: { status, ...data },
            timestamp: new Date().toISOString()
        });
    }
    /**
     * Broadcast new communication
     */
    broadcastCommunication(sessionId, teamMemberType, communication) {
        this.broadcast({
            type: 'communication',
            sessionId,
            teamMemberType,
            data: communication,
            timestamp: new Date().toISOString()
        });
    }
    /**
     * Broadcast session creation
     */
    broadcastSessionCreated(sessionId, teamMemberType, task) {
        this.broadcast({
            type: 'session_created',
            sessionId,
            teamMemberType,
            data: { task },
            timestamp: new Date().toISOString()
        });
    }
    /**
     * Broadcast session end
     */
    broadcastSessionEnded(sessionId, teamMemberType, finalStatus) {
        this.broadcast({
            type: 'session_ended',
            sessionId,
            teamMemberType,
            data: { finalStatus },
            timestamp: new Date().toISOString()
        });
    }
    /**
     * Get number of connected clients
     */
    getClientCount() {
        return this.clients.size;
    }
    /**
     * Get client statistics
     */
    getStats() {
        const bySubscription = {};
        for (const client of this.clients.values()) {
            for (const sub of client.subscriptions) {
                bySubscription[sub] = (bySubscription[sub] || 0) + 1;
            }
        }
        return {
            totalClients: this.clients.size,
            clientsBySubscription: bySubscription
        };
    }
    /**
     * Shutdown the WebSocket server
     */
    async shutdown() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        // Close all client connections
        for (const client of this.clients.values()) {
            client.ws.close(1000, 'Server shutting down');
        }
        this.clients.clear();
        // Close the server
        return new Promise((resolve) => {
            this.wss.close(() => {
                logger.info('Team Member WebSocket stream shut down');
                resolve();
            });
        });
    }
}
// ============================================================================
// Per-Project Instance Management (Map pattern for project isolation)
// ============================================================================
import { getProjectPath } from '../../config.js';
const teamMemberStreamsByProject = new Map();
export function initializeTeamMemberStream(server, path, projectPath) {
    const targetProject = projectPath || getProjectPath();
    if (!teamMemberStreamsByProject.has(targetProject)) {
        teamMemberStreamsByProject.set(targetProject, new TeamMemberStreamManager(server, path));
    }
    return teamMemberStreamsByProject.get(targetProject);
}
export function getTeamMemberStreamManager(projectPath) {
    const targetProject = projectPath || getProjectPath();
    return teamMemberStreamsByProject.get(targetProject) || null;
}
/**
 * Shutdown and reset the TeamMemberStreamManager for a specific project
 * MUST be called during server shutdown to prevent memory leaks
 */
export async function shutdownTeamMemberStream(projectPath) {
    const targetProject = projectPath || getProjectPath();
    const manager = teamMemberStreamsByProject.get(targetProject);
    if (manager) {
        await manager.shutdown();
        teamMemberStreamsByProject.delete(targetProject);
    }
}
/**
 * Shutdown all TeamMemberStreamManagers across all projects
 */
export async function shutdownAllTeamMemberStreams() {
    for (const [projectPath, manager] of teamMemberStreamsByProject.entries()) {
        await manager.shutdown();
        teamMemberStreamsByProject.delete(projectPath);
    }
}
//# sourceMappingURL=teamMemberStream.js.map