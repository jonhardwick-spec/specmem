/**
 * terminalStream.ts - WebSocket Terminal Streaming API
 *
 * Provides WebSocket streaming of  Code terminal output with full
 * ANSI support (colors, formatting, cursor positioning, etc.)
 */
// @ts-ignore - express types
import { Router } from 'express';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { ptyStreamer } from '../ptyStreamer.js';
// ============================================================================
// Zod Validation Schemas
// ============================================================================
const SelectInstanceSchema = z.object({
    pid: z.number().optional(),
    tty: z.string().optional()
});
const SendInputSchema = z.object({
    data: z.string().min(1).max(10000)
});
// ============================================================================
// Active WebSocket Connections
// ============================================================================
const activeConnections = new Set();
// ============================================================================
// PTY Event Handlers
// ============================================================================
// Forward PTY data to all connected WebSocket clients
ptyStreamer.on('data', (chunk) => {
    const data = chunk.toString('utf-8'); // Convert to UTF-8 string (preserves ANSI)
    logger.debug({
        chunkSize: chunk.length,
        dataLength: data.length,
        activeConnectionsCount: activeConnections.size
    }, '[PTY-EVENT-DEBUG] Received data from ptyStreamer');
    activeConnections.forEach((ws) => {
        const readyState = ws.readyState;
        if (readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'terminal-output',
                    data: data
                }), (error) => {
                    if (error) {
                        logger.error({ error }, '[PTY-EVENT-DEBUG] Error sending terminal-output to client');
                    }
                });
            }
            catch (sendError) {
                logger.error({
                    error: sendError,
                    stack: sendError?.stack
                }, '[PTY-EVENT-DEBUG] Synchronous error sending terminal-output');
            }
        }
        else {
            logger.warn({
                readyState,
                readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][readyState] || 'UNKNOWN'
            }, '[PTY-EVENT-DEBUG] Skipping client - not in OPEN state');
        }
    });
});
ptyStreamer.on('error', (error) => {
    logger.error({
        error,
        message: error?.message,
        stack: error?.stack,
        activeConnectionsCount: activeConnections.size
    }, '[PTY-EVENT-DEBUG] PTY streamer error');
    activeConnections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'PTY streaming error'
                }));
            }
            catch (sendError) {
                logger.error({ error: sendError }, '[PTY-EVENT-DEBUG] Error sending error message to client');
            }
        }
    });
});
ptyStreamer.on('end', () => {
    logger.info({ activeConnectionsCount: activeConnections.size }, '[PTY-EVENT-DEBUG] PTY stream ended');
    activeConnections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: 'terminal-closed',
                    message: ' Code terminal closed'
                }));
            }
            catch (sendError) {
                logger.error({ error: sendError }, '[PTY-EVENT-DEBUG] Error sending terminal-closed to client');
            }
        }
    });
});
// ============================================================================
// WebSocket Handler
// ============================================================================
export function handleTerminalWebSocket(ws, req) {
    logger.info({
        readyState: ws.readyState,
        readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] || 'UNKNOWN'
    }, '[TERMINAL-WS-DEBUG] handleTerminalWebSocket called - WebSocket client connected');
    activeConnections.add(ws);
    logger.info({ activeConnectionsCount: activeConnections.size }, '[TERMINAL-WS-DEBUG] Added to activeConnections');
    // Setup heartbeat/keepalive to prevent idle timeout
    let heartbeatInterval = null;
    let isAlive = true;
    const startHeartbeat = () => {
        heartbeatInterval = setInterval(() => {
            if (!isAlive) {
                logger.warn('[TERMINAL-WS-DEBUG] Heartbeat timeout - client not responding, terminating');
                ws.terminate();
                return;
            }
            isAlive = false;
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                    logger.debug('[TERMINAL-WS-DEBUG] Sent ping to client');
                }
            }
            catch (pingError) {
                logger.error({ error: pingError }, '[TERMINAL-WS-DEBUG] Error sending ping');
            }
        }, 30000); // Ping every 30 seconds
    };
    ws.on('pong', () => {
        isAlive = true;
        logger.debug('[TERMINAL-WS-DEBUG] Received pong from client');
    });
    startHeartbeat();
    // Send initial instances list AFTER a delay to let mobile proxies fully establish the connection
    // Mobile carriers often have transparent proxies that kill WebSocket connections if data is sent too quickly
    setTimeout(() => {
        try {
            // Check if connection is still open before sending
            if (ws.readyState !== WebSocket.OPEN) {
                logger.warn({ readyState: ws.readyState }, '[TERMINAL-WS-DEBUG] Connection closed before delayed instances-list could be sent');
                return;
            }
            logger.info('[TERMINAL-WS-DEBUG] About to call findAllInstances (after delay)...');
            const instances = ptyStreamer.findAllInstances();
            logger.info({
                instanceCount: instances.length,
                instances: instances.map(i => ({
                    pid: i.pid,
                    screenName: i.screenName,
                    logFile: i.logFile,
                    attached: i.attached
                }))
            }, '[TERMINAL-WS-DEBUG] Found instances, preparing to send');
            const message = JSON.stringify({
                type: 'instances-list',
                instances: instances
            });
            logger.info({
                messageLength: message.length,
                readyState: ws.readyState,
                readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] || 'UNKNOWN'
            }, '[TERMINAL-WS-DEBUG] About to send instances-list message (after delay)');
            try {
                ws.send(message, (sendError) => {
                    if (sendError) {
                        logger.error({
                            error: sendError,
                            stack: sendError.stack,
                            message: sendError.message
                        }, '[TERMINAL-WS-DEBUG] ws.send callback error for instances-list');
                    }
                    else {
                        logger.info('[TERMINAL-WS-DEBUG] instances-list message sent successfully (callback confirmed)');
                    }
                });
                logger.info('[TERMINAL-WS-DEBUG] ws.send() called for instances-list (async)');
            }
            catch (sendError) {
                logger.error({
                    error: sendError,
                    stack: sendError?.stack,
                    message: sendError?.message
                }, '[TERMINAL-WS-DEBUG] Synchronous error during ws.send for instances-list');
            }
        }
        catch (error) {
            logger.error({
                error,
                stack: error?.stack,
                message: error?.message
            }, '[TERMINAL-WS-DEBUG] Failed in initial instances list block');
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to retrieve instances'
                    }));
                }
            }
            catch (sendError) {
                logger.error({
                    error: sendError,
                    stack: sendError?.stack
                }, '[TERMINAL-WS-DEBUG] Failed to send error message to client');
            }
        }
    }, 1000); // 1 second delay to let mobile proxies fully establish connection
    ws.on('message', (message) => {
        logger.info({
            messageLength: message.toString().length,
            readyState: ws.readyState
        }, '[TERMINAL-WS-DEBUG] Received message from client');
        try {
            const data = JSON.parse(message.toString());
            logger.info({ messageType: data.type }, '[TERMINAL-WS-DEBUG] Parsed message type');
            if (data.type === 'start-streaming') {
                logger.info('[TERMINAL-WS-DEBUG] Processing start-streaming request');
                // Use instance from client if provided, otherwise use newest
                let instance;
                if (data.logFile) {
                    // Client specified which instance to use
                    const allInstances = ptyStreamer.findAllInstances();
                    instance = allInstances.find(i => i.logFile === data.logFile);
                    if (!instance) {
                        logger.warn({ requestedLogFile: data.logFile }, '[TERMINAL-WS-DEBUG] Requested instance not found');
                        safeSend(ws, JSON.stringify({
                            type: 'error',
                            message: 'Selected instance not found'
                        }), 'start-streaming-instance-not-found');
                        return;
                    }
                }
                else {
                    // No instance specified, use newest
                    instance = ptyStreamer.getNewestInstance();
                }
                if (!instance) {
                    logger.warn('[TERMINAL-WS-DEBUG] No  Code instances found for streaming');
                    safeSend(ws, JSON.stringify({
                        type: 'error',
                        message: 'No  Code instances found'
                    }), 'start-streaming-error');
                    return;
                }
                logger.info({
                    instancePid: instance.pid,
                    logFile: instance.logFile
                }, '[TERMINAL-WS-DEBUG] Starting streaming for instance');
                const started = ptyStreamer.startStreaming(instance.logFile);
                if (started) {
                    logger.info('[TERMINAL-WS-DEBUG] Streaming started successfully');
                    safeSend(ws, JSON.stringify({
                        type: 'streaming-started',
                        instance: instance
                    }), 'streaming-started');
                }
                else {
                    logger.error('[TERMINAL-WS-DEBUG] Failed to start streaming');
                    safeSend(ws, JSON.stringify({
                        type: 'error',
                        message: 'Failed to start streaming'
                    }), 'start-streaming-failed');
                }
            }
            else if (data.type === 'stop-streaming') {
                logger.info('[TERMINAL-WS-DEBUG] Processing stop-streaming request');
                ptyStreamer.stopStreaming();
                safeSend(ws, JSON.stringify({
                    type: 'streaming-stopped'
                }), 'streaming-stopped');
            }
            else if (data.type === 'send-input') {
                logger.info('[TERMINAL-WS-DEBUG] Processing send-input request');
                // Send keyboard input to the currently streaming terminal
                const instance = ptyStreamer.getCurrentStreamingInstance();
                if (!instance) {
                    safeSend(ws, JSON.stringify({
                        type: 'error',
                        message: 'No active terminal stream - start streaming first'
                    }), 'send-input-no-instance');
                    return;
                }
                const parseResult = SendInputSchema.safeParse(data);
                if (!parseResult.success) {
                    safeSend(ws, JSON.stringify({
                        type: 'error',
                        message: 'Invalid input data'
                    }), 'send-input-invalid');
                    return;
                }
                logger.info({
                    screenName: instance.screenName,
                    dataLength: parseResult.data.data.length
                }, '[TERMINAL-WS-DEBUG] Sending input to streaming instance');
                const sent = ptyStreamer.writeToTerminal(instance.screenName, parseResult.data.data);
                if (!sent) {
                    safeSend(ws, JSON.stringify({
                        type: 'error',
                        message: 'Failed to send input'
                    }), 'send-input-failed');
                }
            }
            else if (data.type === 'list-instances') {
                logger.info('[TERMINAL-WS-DEBUG] Processing list-instances request');
                const instances = ptyStreamer.findAllInstances();
                logger.info({ instanceCount: instances.length }, '[TERMINAL-WS-DEBUG] Found instances for list-instances');
                safeSend(ws, JSON.stringify({
                    type: 'instances-list',
                    instances: instances
                }), 'list-instances-response');
            }
            else {
                logger.warn({ messageType: data.type }, '[TERMINAL-WS-DEBUG] Unknown message type received');
            }
        }
        catch (error) {
            logger.error({
                error,
                stack: error?.stack,
                message: error?.message,
                rawMessage: message.toString().substring(0, 200)
            }, '[TERMINAL-WS-DEBUG] Error handling WebSocket message');
            safeSend(ws, JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }), 'message-parse-error');
        }
    });
    ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'NO_REASON_PROVIDED';
        logger.info({
            code,
            reason: reasonStr,
            codeExplanation: getCloseCodeExplanation(code),
            activeConnectionsBefore: activeConnections.size,
            wasServerClose: code >= 1000 && code < 2000,
            wasClientClose: code >= 3000 && code < 5000
        }, '[TERMINAL-WS-DEBUG] Terminal WebSocket client disconnected');
        // Clear heartbeat interval
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        activeConnections.delete(ws);
        logger.info({ activeConnectionsAfter: activeConnections.size }, '[TERMINAL-WS-DEBUG] Removed from activeConnections');
        // Stop streaming if no clients connected
        if (activeConnections.size === 0) {
            logger.info('[TERMINAL-WS-DEBUG] No more clients, stopping streaming');
            ptyStreamer.stopStreaming();
        }
    });
    ws.on('error', (error) => {
        logger.error({
            error,
            errorName: error?.name,
            errorMessage: error?.message,
            errorCode: error?.code,
            stack: error?.stack,
            readyState: ws.readyState,
            readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] || 'UNKNOWN'
        }, '[TERMINAL-WS-DEBUG] WebSocket error - connection will close');
        // MED-32 FIX: Clear heartbeat interval in error handler too
        // This ensures cleanup happens even if close event is never fired
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        // MED-32 FIX: Ensure connection is removed from activeConnections
        // The close event may not fire after certain errors, so we clean up here
        const wasInSet = activeConnections.delete(ws);
        if (wasInSet) {
            logger.info({ activeConnectionsAfter: activeConnections.size }, '[TERMINAL-WS-DEBUG] Removed from activeConnections in error handler');
        }
    });
    logger.info('[TERMINAL-WS-DEBUG] handleTerminalWebSocket setup complete - all event handlers registered');
}
// Helper function to safely send messages with error handling
function safeSend(ws, message, context) {
    try {
        if (ws.readyState !== WebSocket.OPEN) {
            logger.warn({
                context,
                readyState: ws.readyState,
                readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] || 'UNKNOWN'
            }, '[TERMINAL-WS-DEBUG] Cannot send - WebSocket not open');
            return;
        }
        ws.send(message, (error) => {
            if (error) {
                logger.error({
                    context,
                    error,
                    stack: error?.stack
                }, '[TERMINAL-WS-DEBUG] safeSend callback error');
            }
            else {
                logger.debug({ context }, '[TERMINAL-WS-DEBUG] safeSend successful');
            }
        });
    }
    catch (error) {
        logger.error({
            context,
            error,
            stack: error?.stack
        }, '[TERMINAL-WS-DEBUG] safeSend synchronous error');
    }
}
// Helper function to explain WebSocket close codes
function getCloseCodeExplanation(code) {
    const codes = {
        1000: 'NORMAL_CLOSURE - Normal close',
        1001: 'GOING_AWAY - Endpoint going away (browser tab closed/navigated)',
        1002: 'PROTOCOL_ERROR - Protocol error',
        1003: 'UNSUPPORTED_DATA - Unsupported data type',
        1005: 'NO_STATUS_RECEIVED - No status code provided',
        1006: 'ABNORMAL_CLOSURE - Connection closed abnormally (no close frame)',
        1007: 'INVALID_PAYLOAD - Invalid payload data',
        1008: 'POLICY_VIOLATION - Policy violation',
        1009: 'MESSAGE_TOO_BIG - Message too big',
        1010: 'MANDATORY_EXTENSION - Missing extension',
        1011: 'INTERNAL_ERROR - Internal server error',
        1012: 'SERVICE_RESTART - Server restarting',
        1013: 'TRY_AGAIN_LATER - Server overloaded',
        1014: 'BAD_GATEWAY - Bad gateway',
        1015: 'TLS_HANDSHAKE - TLS handshake failure'
    };
    return codes[code] || `UNKNOWN_CODE_${code}`;
}
// ============================================================================
// REST API Router
// ============================================================================
export function createTerminalStreamRouter(requireAuth) {
    const router = Router();
    /**
     * GET /api/terminal-stream/instances - List all  instances
     */
    router.get('/instances', requireAuth, async (req, res) => {
        try {
            const instances = ptyStreamer.findAllInstances();
            res.json({
                success: true,
                instances: instances
            });
        }
        catch (error) {
            logger.error({ error }, 'Error listing instances');
            res.status(500).json({
                success: false,
                error: 'Failed to list instances'
            });
        }
    });
    /**
     * GET /api/terminal-stream/status - Get streaming status
     */
    router.get('/status', requireAuth, async (req, res) => {
        try {
            res.json({
                success: true,
                isStreaming: ptyStreamer.isActive(),
                activeConnections: activeConnections.size
            });
        }
        catch (error) {
            logger.error({ error }, 'Error getting status');
            res.status(500).json({
                success: false,
                error: 'Failed to get status'
            });
        }
    });
    return router;
}
export default createTerminalStreamRouter;
//# sourceMappingURL=terminalStream.js.map