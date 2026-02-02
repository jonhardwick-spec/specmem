import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
export interface ApiEndpoint {
    id: string;
    path: string;
    method: string;
    name: string;
    description?: string;
    rateLimitMax: number;
    rateLimitWindowMs: number;
    rateLimitSkipLocalhost: boolean;
    requiresAuth: boolean;
    allowedRoles: string[];
    allowedIps: string[];
    blockedIps: string[];
    isEnabled: boolean;
    isDeprecated: boolean;
    deprecationMessage?: string;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    lastRequestAt?: Date;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface CreateEndpointPayload {
    path: string;
    method: string;
    name: string;
    description?: string;
    rateLimitMax?: number;
    rateLimitWindowMs?: number;
    rateLimitSkipLocalhost?: boolean;
    requiresAuth?: boolean;
    allowedRoles?: string[];
    allowedIps?: string[];
    blockedIps?: string[];
    isEnabled?: boolean;
    tags?: string[];
    metadata?: Record<string, unknown>;
}
export interface IpBan {
    id: string;
    ipAddress: string;
    ipRange?: string;
    reason: string;
    banType: 'manual' | 'auto' | 'vpn' | 'rate_limit' | 'security' | 'abuse';
    severity: 'low' | 'medium' | 'high' | 'critical';
    isPermanent: boolean;
    expiresAt?: Date;
    userAgent?: string;
    fingerprint?: string;
    country?: string;
    violationCount: number;
    violations: Array<Record<string, unknown>>;
    isActive: boolean;
    liftedAt?: Date;
    liftedBy?: string;
    liftReason?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface CreateBanPayload {
    ipAddress: string;
    ipRange?: string;
    reason: string;
    banType?: 'manual' | 'auto' | 'vpn' | 'rate_limit' | 'security' | 'abuse';
    severity?: 'low' | 'medium' | 'high' | 'critical';
    isPermanent?: boolean;
    expiresAt?: Date;
    userAgent?: string;
    fingerprint?: string;
    country?: string;
    violations?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
}
export interface AutobanConfig {
    id: number;
    isEnabled: boolean;
    threshold: number;
    durationMs: number;
    windowMs: number;
    trackedViolations: string[];
    excludedIps: string[];
    excludedCountries: string[];
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface SecurityEvent {
    id: string;
    eventType: string;
    eventAction: string;
    category: 'violation' | 'warning' | 'info' | 'audit' | 'error';
    ipAddress?: string;
    userAgent?: string;
    fingerprint?: string;
    sessionId?: string;
    details: Record<string, unknown>;
    severity: 'low' | 'medium' | 'high' | 'critical';
    threatScore: number;
    country?: string;
    region?: string;
    city?: string;
    isVpn: boolean;
    isProxy: boolean;
    isTor: boolean;
    isDataCenter: boolean;
    isGovernment: boolean;
    isFederalFacility: boolean;
    isResolved: boolean;
    resolvedAt?: Date;
    resolvedBy?: string;
    resolutionNotes?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
}
export interface CreateSecurityEventPayload {
    eventType: string;
    eventAction: string;
    category?: 'violation' | 'warning' | 'info' | 'audit' | 'error';
    ipAddress?: string;
    userAgent?: string;
    fingerprint?: string;
    sessionId?: string;
    details?: Record<string, unknown>;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    threatScore?: number;
    country?: string;
    region?: string;
    city?: string;
    isVpn?: boolean;
    isProxy?: boolean;
    isTor?: boolean;
    isDataCenter?: boolean;
    isGovernment?: boolean;
    isFederalFacility?: boolean;
    metadata?: Record<string, unknown>;
}
export interface OAuthProvider {
    id: string;
    providerName: string;
    displayName?: string;
    clientId?: string;
    clientSecretEncrypted?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    userinfoUrl?: string;
    scope: string;
    isEnabled: boolean;
    isConfigured: boolean;
    redirectUri?: string;
    iconUrl?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface AdminSession {
    id: string;
    sessionToken: string;
    username?: string;
    ipAddress?: string;
    userAgent?: string;
    isActive: boolean;
    createdAt: Date;
    lastActivityAt: Date;
    expiresAt?: Date;
    endedAt?: Date;
    sessionData: Record<string, unknown>;
}
export interface ApiStats {
    totalEndpoints: number;
    enabledEndpoints: number;
    authRequiredEndpoints: number;
    deprecatedEndpoints: number;
    totalApiRequests: number;
    totalSuccessfulRequests: number;
    totalFailedRequests: number;
    lastApiRequest?: Date;
}
export interface SecurityStats {
    totalEvents: number;
    vpnEvents: number;
    criticalEvents: number;
    highSeverityEvents: number;
    unresolvedEvents: number;
    eventsLast24h: number;
    eventsLast7d: number;
    uniqueIps: number;
    uniqueCountries: number;
}
export interface BanStats {
    totalBans: number;
    activeBans: number;
    permanentBans: number;
    autoBans: number;
    manualBans: number;
    vpnBans: number;
    bansLast24h: number;
    bansLast7d: number;
}
/**
 * ApiDataManager - manages all API-related database operations
 *
 * Replaces JSON file storage with PostgreSQL:
 * - data/api-endpoints/endpoints.json
 * - data/bans/data.json
 * - data/bans/autoban-config.json
 * - data/oauth/providers.json
 * - data/events/vpn.json
 * - data/vpn_violations/*.json
 * - data/admin_sessions/data.json
 * - data/security/government-facilities.json
 */
export declare class ApiDataManager {
    private pool;
    private stats;
    constructor(pool: ConnectionPoolGoBrrr);
    /**
     * Create a new API endpoint
     */
    createEndpoint(payload: CreateEndpointPayload): Promise<ApiEndpoint>;
    /**
     * Get endpoint by path and method
     */
    getEndpoint(path: string, method: string): Promise<ApiEndpoint | null>;
    /**
     * Get all enabled endpoints
     */
    getEnabledEndpoints(): Promise<ApiEndpoint[]>;
    /**
     * Update endpoint request stats
     */
    updateEndpointStats(path: string, method: string, success: boolean): Promise<void>;
    /**
     * Check if IP is blocked for endpoint
     */
    isIpBlockedForEndpoint(path: string, method: string, ip: string): Promise<boolean>;
    /**
     * Create a new IP ban
     */
    createBan(payload: CreateBanPayload): Promise<IpBan>;
    /**
     * Check if IP is banned
     */
    isIpBanned(ip: string): Promise<boolean>;
    /**
     * Get active ban for IP
     */
    getActiveBan(ip: string): Promise<IpBan | null>;
    /**
     * Lift a ban
     */
    liftBan(id: string, liftedBy: string, reason?: string): Promise<void>;
    /**
     * Get all active bans
     */
    getActiveBans(limit?: number, offset?: number): Promise<IpBan[]>;
    /**
     * Increment violation count for IP
     */
    incrementViolation(ip: string, violation: Record<string, unknown>): Promise<void>;
    /**
     * Get autoban configuration
     */
    getAutobanConfig(): Promise<AutobanConfig | null>;
    /**
     * Update autoban configuration
     */
    updateAutobanConfig(config: Partial<AutobanConfig>): Promise<AutobanConfig>;
    /**
     * Log a security event
     */
    logSecurityEvent(payload: CreateSecurityEventPayload): Promise<SecurityEvent>;
    /**
     * Get recent security events
     */
    getRecentSecurityEvents(limit?: number, offset?: number): Promise<SecurityEvent[]>;
    /**
     * Get security events by IP
     */
    getSecurityEventsByIp(ip: string, limit?: number): Promise<SecurityEvent[]>;
    /**
     * Get unresolved security events
     */
    getUnresolvedEvents(severity?: string): Promise<SecurityEvent[]>;
    /**
     * Resolve a security event
     */
    resolveEvent(id: string, resolvedBy: string, notes?: string): Promise<void>;
    /**
     * Get API stats
     */
    getApiStats(): Promise<ApiStats>;
    /**
     * Get security stats
     */
    getSecurityStats(): Promise<SecurityStats>;
    /**
     * Get ban stats
     */
    getBanStats(): Promise<BanStats>;
    /**
     * Refresh all API data stats
     */
    refreshStats(): Promise<void>;
    /**
     * Run cleanup for expired data
     */
    runCleanup(): Promise<{
        expiredBans: number;
        expiredSessions: number;
        oldEvents: number;
    }>;
    /**
     * Get manager stats
     */
    getStats(): {
        endpointsCreated: number;
        bansCreated: number;
        eventsCreated: number;
        queries: number;
    };
    private rowToEndpoint;
    private rowToBan;
    private rowToAutobanConfig;
    private rowToSecurityEvent;
}
export declare function getApiDataManager(): ApiDataManager;
export declare function initApiDataManager(pool: ConnectionPoolGoBrrr): ApiDataManager;
export declare function resetApiDataManager(): void;
//# sourceMappingURL=apiDataManager.d.ts.map