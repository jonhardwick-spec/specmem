/**
 * wsRateLimiter.ts - WebSocket Rate Limiting for SpecMem
 *
 * yo this protects our WebSocket from abuse
 * 100 messages per minute per connection, 1MB max message size
 * track connection counts per IP fr fr
 *
 * Issue #25 fix - rate limiting on WebSocket
 */
import { logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    maxMessagesPerWindow: 100,
    windowMs: 60000, // 1 minute
    maxMessageSize: 1024 * 1024, // 1MB
    maxConnectionsPerIp: 10,
    disconnectOnAbuse: true,
    abuseThreshold: 1.5 // 50% over limit
};
/**
 * WsRateLimiter - WebSocket rate limiting
 *
 * Features that PROTECT US:
 * - Per-connection message rate limiting
 * - Message size limiting
 * - Per-IP connection limits
 * - Abuse detection and disconnect
 * - Statistics tracking
 */
export class WsRateLimiter {
    config;
    connections = new Map();
    ipConnections = new Map();
    abusiveIps = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Register a new WebSocket connection
     */
    registerConnection(ws, ip) {
        // Check if IP is blocked
        const blocked = this.abusiveIps.get(ip);
        if (blocked && blocked.until > Date.now()) {
            logger.warn({ ip, reason: blocked.reason }, 'connection from blocked IP rejected');
            return false;
        }
        // Check per-IP connection limit
        const ipConns = this.ipConnections.get(ip) || new Set();
        if (ipConns.size >= this.config.maxConnectionsPerIp) {
            logger.warn({ ip, connectionCount: ipConns.size }, 'connection limit exceeded for IP');
            return false;
        }
        // Register connection
        this.connections.set(ws, {
            messages: [],
            ip,
            connectedAt: Date.now(),
            warnings: 0,
            totalMessages: 0,
            totalBytes: 0
        });
        ipConns.add(ws);
        this.ipConnections.set(ip, ipConns);
        logger.debug({ ip, totalConnectionsForIp: ipConns.size }, 'WebSocket connection registered');
        return true;
    }
    /**
     * Unregister a WebSocket connection
     */
    unregisterConnection(ws) {
        const data = this.connections.get(ws);
        if (!data)
            return;
        // Remove from IP tracking
        const ipConns = this.ipConnections.get(data.ip);
        if (ipConns) {
            ipConns.delete(ws);
            if (ipConns.size === 0) {
                this.ipConnections.delete(data.ip);
            }
        }
        this.connections.delete(ws);
        logger.debug({ ip: data.ip, totalMessages: data.totalMessages }, 'WebSocket connection unregistered');
    }
    /**
     * Check if a message is allowed
     */
    checkMessage(ws, messageSize) {
        const data = this.connections.get(ws);
        if (!data) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: Date.now(),
                reason: 'Connection not registered'
            };
        }
        const now = Date.now();
        const windowStart = now - this.config.windowMs;
        // Check message size
        if (messageSize > this.config.maxMessageSize) {
            data.warnings++;
            logger.warn({
                ip: data.ip,
                messageSize,
                maxSize: this.config.maxMessageSize,
                warnings: data.warnings
            }, 'message size exceeds limit');
            if (this.shouldDisconnect(data)) {
                this.blockIp(data.ip, 'Excessive large messages');
                return {
                    allowed: false,
                    remaining: 0,
                    resetAt: now + this.config.windowMs,
                    reason: 'Message too large - connection will be terminated'
                };
            }
            return {
                allowed: false,
                remaining: 0,
                resetAt: now + this.config.windowMs,
                reason: `Message size ${messageSize} exceeds limit ${this.config.maxMessageSize}`
            };
        }
        // Clean old messages from tracking
        data.messages = data.messages.filter(t => t > windowStart);
        // Check rate limit
        if (data.messages.length >= this.config.maxMessagesPerWindow) {
            data.warnings++;
            logger.warn({
                ip: data.ip,
                messageCount: data.messages.length,
                maxMessages: this.config.maxMessagesPerWindow,
                warnings: data.warnings
            }, 'rate limit exceeded');
            if (this.shouldDisconnect(data)) {
                this.blockIp(data.ip, 'Rate limit abuse');
                return {
                    allowed: false,
                    remaining: 0,
                    resetAt: data.messages[0] + this.config.windowMs,
                    reason: 'Rate limit exceeded - connection will be terminated'
                };
            }
            return {
                allowed: false,
                remaining: 0,
                resetAt: data.messages[0] + this.config.windowMs,
                reason: 'Rate limit exceeded'
            };
        }
        // Record message
        data.messages.push(now);
        data.totalMessages++;
        data.totalBytes += messageSize;
        return {
            allowed: true,
            remaining: this.config.maxMessagesPerWindow - data.messages.length,
            resetAt: now + this.config.windowMs
        };
    }
    /**
     * Check if connection should be disconnected
     */
    shouldDisconnect(data) {
        if (!this.config.disconnectOnAbuse)
            return false;
        // Check if consistently over limit
        const messagesInWindow = data.messages.length;
        const abuseLimit = this.config.maxMessagesPerWindow * this.config.abuseThreshold;
        return messagesInWindow >= abuseLimit || data.warnings >= 5;
    }
    /**
     * Block an IP temporarily
     */
    blockIp(ip, reason) {
        const blockDuration = 5 * 60 * 1000; // 5 minutes
        this.abusiveIps.set(ip, {
            until: Date.now() + blockDuration,
            reason
        });
        logger.warn({ ip, reason, blockDurationMs: blockDuration }, 'IP blocked for abuse');
    }
    /**
     * Get connection stats
     */
    getConnectionStats(ws) {
        return this.connections.get(ws);
    }
    /**
     * Get overall stats
     */
    getStats() {
        let totalMessages = 0;
        let totalBytes = 0;
        for (const data of this.connections.values()) {
            totalMessages += data.totalMessages;
            totalBytes += data.totalBytes;
        }
        // Clean expired blocks
        const now = Date.now();
        for (const [ip, block] of this.abusiveIps) {
            if (block.until <= now) {
                this.abusiveIps.delete(ip);
            }
        }
        return {
            totalConnections: this.connections.size,
            uniqueIps: this.ipConnections.size,
            blockedIps: this.abusiveIps.size,
            totalMessages,
            totalBytes
        };
    }
    /**
     * Check if an IP is blocked
     */
    isIpBlocked(ip) {
        const block = this.abusiveIps.get(ip);
        if (!block)
            return false;
        if (block.until <= Date.now()) {
            this.abusiveIps.delete(ip);
            return false;
        }
        return true;
    }
    /**
     * Manually unblock an IP
     */
    unblockIp(ip) {
        return this.abusiveIps.delete(ip);
    }
    /**
     * Reset the rate limiter
     */
    reset() {
        this.connections.clear();
        this.ipConnections.clear();
        this.abusiveIps.clear();
    }
}
// Singleton instance
let limiterInstance = null;
/**
 * Get the global WebSocket rate limiter
 */
export function getWsRateLimiter(config) {
    if (!limiterInstance) {
        limiterInstance = new WsRateLimiter(config);
    }
    return limiterInstance;
}
/**
 * Reset the global rate limiter
 */
export function resetWsRateLimiter() {
    if (limiterInstance) {
        limiterInstance.reset();
    }
    limiterInstance = null;
}
/**
 * Extract client IP from WebSocket or HTTP request
 */
export function extractClientIp(req) {
    // Check various proxy headers
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        return ips?.split(',')[0]?.trim() || 'unknown';
    }
    const realIp = req.headers['x-real-ip'];
    if (realIp) {
        return Array.isArray(realIp) ? realIp[0] || 'unknown' : realIp;
    }
    return req.socket?.remoteAddress || 'unknown';
}
//# sourceMappingURL=wsRateLimiter.js.map