/**
 * wsRateLimiter.ts - WebSocket Rate Limiting for SpecMem
 *
 * yo this protects our WebSocket from abuse
 * 100 messages per minute per connection, 1MB max message size
 * track connection counts per IP fr fr
 *
 * Issue #25 fix - rate limiting on WebSocket
 */
import WebSocket from 'ws';
/**
 * Rate limiter configuration
 */
export interface WsRateLimiterConfig {
    /** Max messages per window */
    maxMessagesPerWindow: number;
    /** Window size in ms */
    windowMs: number;
    /** Max message size in bytes */
    maxMessageSize: number;
    /** Max connections per IP */
    maxConnectionsPerIp: number;
    /** Whether to disconnect on abuse */
    disconnectOnAbuse: boolean;
    /** Abuse threshold (percentage over limit to trigger disconnect) */
    abuseThreshold: number;
}
/**
 * Connection tracking data
 */
interface ConnectionData {
    messages: number[];
    ip: string;
    connectedAt: number;
    warnings: number;
    totalMessages: number;
    totalBytes: number;
}
/**
 * Rate limit result
 */
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    reason?: string;
}
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
export declare class WsRateLimiter {
    private config;
    private connections;
    private ipConnections;
    private abusiveIps;
    constructor(config?: Partial<WsRateLimiterConfig>);
    /**
     * Register a new WebSocket connection
     */
    registerConnection(ws: WebSocket, ip: string): boolean;
    /**
     * Unregister a WebSocket connection
     */
    unregisterConnection(ws: WebSocket): void;
    /**
     * Check if a message is allowed
     */
    checkMessage(ws: WebSocket, messageSize: number): RateLimitResult;
    /**
     * Check if connection should be disconnected
     */
    private shouldDisconnect;
    /**
     * Block an IP temporarily
     */
    private blockIp;
    /**
     * Get connection stats
     */
    getConnectionStats(ws: WebSocket): ConnectionData | undefined;
    /**
     * Get overall stats
     */
    getStats(): {
        totalConnections: number;
        uniqueIps: number;
        blockedIps: number;
        totalMessages: number;
        totalBytes: number;
    };
    /**
     * Check if an IP is blocked
     */
    isIpBlocked(ip: string): boolean;
    /**
     * Manually unblock an IP
     */
    unblockIp(ip: string): boolean;
    /**
     * Reset the rate limiter
     */
    reset(): void;
}
/**
 * Get the global WebSocket rate limiter
 */
export declare function getWsRateLimiter(config?: Partial<WsRateLimiterConfig>): WsRateLimiter;
/**
 * Reset the global rate limiter
 */
export declare function resetWsRateLimiter(): void;
/**
 * Extract client IP from WebSocket or HTTP request
 */
export declare function extractClientIp(req: {
    headers: Record<string, string | string[] | undefined>;
    socket?: {
        remoteAddress?: string;
    };
}): string;
export {};
//# sourceMappingURL=wsRateLimiter.d.ts.map