// yooo this file manages ALL API-related database operations
// endpoints, bans, security events, oauth providers - EVERYTHING
// no more JSON files, we in PostgreSQL gang now fr fr
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
// ============================================================
// API DATA MANAGER CLASS
// ============================================================
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
export class ApiDataManager {
    pool;
    stats = {
        endpointsCreated: 0,
        bansCreated: 0,
        eventsCreated: 0,
        queries: 0
    };
    constructor(pool) {
        this.pool = pool;
    }
    // ============================================================
    // API ENDPOINTS OPERATIONS
    // ============================================================
    /**
     * Create a new API endpoint
     */
    async createEndpoint(payload) {
        const id = uuidv4();
        const start = Date.now();
        logger.debug({ path: payload.path, method: payload.method }, 'creating API endpoint');
        const result = await this.pool.queryWithSwag(`
      INSERT INTO api_endpoints (
        id, path, method, name, description,
        rate_limit_max, rate_limit_window_ms, rate_limit_skip_localhost,
        requires_auth, allowed_roles, allowed_ips, blocked_ips,
        is_enabled, tags, metadata
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15
      )
      RETURNING *
    `, [
            id,
            payload.path,
            payload.method,
            payload.name,
            payload.description || null,
            payload.rateLimitMax ?? 100,
            payload.rateLimitWindowMs ?? 60000,
            payload.rateLimitSkipLocalhost ?? true,
            payload.requiresAuth ?? true,
            payload.allowedRoles ?? [],
            payload.allowedIps ?? [],
            payload.blockedIps ?? [],
            payload.isEnabled ?? true,
            payload.tags ?? [],
            JSON.stringify(payload.metadata ?? {})
        ]);
        this.stats.endpointsCreated++;
        this.stats.queries++;
        logger.debug({ id, duration: Date.now() - start }, 'API endpoint created');
        return this.rowToEndpoint(result.rows[0]);
    }
    /**
     * Get endpoint by path and method
     */
    async getEndpoint(path, method) {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM api_endpoints
      WHERE path = $1 AND method = $2
    `, [path, method.toUpperCase()]);
        return result.rows.length > 0 ? this.rowToEndpoint(result.rows[0]) : null;
    }
    /**
     * Get all enabled endpoints
     */
    async getEnabledEndpoints() {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM api_endpoints
      WHERE is_enabled = true
      ORDER BY path, method
    `);
        return result.rows.map(row => this.rowToEndpoint(row));
    }
    /**
     * Update endpoint request stats
     */
    async updateEndpointStats(path, method, success) {
        this.stats.queries++;
        await this.pool.queryWithSwag(`
      UPDATE api_endpoints
      SET
        total_requests = total_requests + 1,
        successful_requests = successful_requests + CASE WHEN $3 THEN 1 ELSE 0 END,
        failed_requests = failed_requests + CASE WHEN $3 THEN 0 ELSE 1 END,
        last_request_at = NOW()
      WHERE path = $1 AND method = $2
    `, [path, method.toUpperCase(), success]);
    }
    /**
     * Check if IP is blocked for endpoint
     */
    async isIpBlockedForEndpoint(path, method, ip) {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT 1 FROM api_endpoints
      WHERE path = $1 AND method = $2
        AND ($3 = ANY(blocked_ips) OR (array_length(allowed_ips, 1) > 0 AND NOT $3 = ANY(allowed_ips)))
    `, [path, method.toUpperCase(), ip]);
        return result.rows.length > 0;
    }
    // ============================================================
    // IP BANS OPERATIONS
    // ============================================================
    /**
     * Create a new IP ban
     */
    async createBan(payload) {
        const id = uuidv4();
        const start = Date.now();
        logger.info({ ip: payload.ipAddress, reason: payload.reason }, 'creating IP ban');
        const result = await this.pool.queryWithSwag(`
      INSERT INTO ip_bans (
        id, ip_address, ip_range, reason, ban_type, severity,
        is_permanent, expires_at, user_agent, fingerprint, country,
        violations, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13
      )
      RETURNING *
    `, [
            id,
            payload.ipAddress,
            payload.ipRange || null,
            payload.reason,
            payload.banType ?? 'manual',
            payload.severity ?? 'medium',
            payload.isPermanent ?? false,
            payload.expiresAt || null,
            payload.userAgent || null,
            payload.fingerprint || null,
            payload.country || null,
            JSON.stringify(payload.violations ?? []),
            JSON.stringify(payload.metadata ?? {})
        ]);
        this.stats.bansCreated++;
        this.stats.queries++;
        logger.info({ id, duration: Date.now() - start }, 'IP ban created');
        return this.rowToBan(result.rows[0]);
    }
    /**
     * Check if IP is banned
     */
    async isIpBanned(ip) {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT 1 FROM ip_bans
      WHERE ip_address = $1
        AND is_active = true
        AND (is_permanent = true OR expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `, [ip]);
        return result.rows.length > 0;
    }
    /**
     * Get active ban for IP
     */
    async getActiveBan(ip) {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM ip_bans
      WHERE ip_address = $1
        AND is_active = true
        AND (is_permanent = true OR expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1
    `, [ip]);
        return result.rows.length > 0 ? this.rowToBan(result.rows[0]) : null;
    }
    /**
     * Lift a ban
     */
    async liftBan(id, liftedBy, reason) {
        this.stats.queries++;
        await this.pool.queryWithSwag(`
      UPDATE ip_bans
      SET is_active = false, lifted_at = NOW(), lifted_by = $2, lift_reason = $3
      WHERE id = $1
    `, [id, liftedBy, reason || null]);
        logger.info({ id, liftedBy }, 'IP ban lifted');
    }
    /**
     * Get all active bans
     */
    async getActiveBans(limit = 100, offset = 0) {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM ip_bans
      WHERE is_active = true
        AND (is_permanent = true OR expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
        return result.rows.map(row => this.rowToBan(row));
    }
    /**
     * Increment violation count for IP
     */
    async incrementViolation(ip, violation) {
        this.stats.queries++;
        await this.pool.queryWithSwag(`
      UPDATE ip_bans
      SET
        violation_count = violation_count + 1,
        violations = violations || $2::jsonb
      WHERE ip_address = $1 AND is_active = true
    `, [ip, JSON.stringify([violation])]);
    }
    // ============================================================
    // AUTOBAN CONFIG OPERATIONS
    // ============================================================
    /**
     * Get autoban configuration
     */
    async getAutobanConfig() {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM autoban_config ORDER BY id LIMIT 1
    `);
        return result.rows.length > 0 ? this.rowToAutobanConfig(result.rows[0]) : null;
    }
    /**
     * Update autoban configuration
     */
    async updateAutobanConfig(config) {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      UPDATE autoban_config
      SET
        is_enabled = COALESCE($1, is_enabled),
        threshold = COALESCE($2, threshold),
        duration_ms = COALESCE($3, duration_ms),
        window_ms = COALESCE($4, window_ms),
        tracked_violations = COALESCE($5, tracked_violations),
        excluded_ips = COALESCE($6, excluded_ips),
        excluded_countries = COALESCE($7, excluded_countries)
      WHERE id = (SELECT id FROM autoban_config ORDER BY id LIMIT 1)
      RETURNING *
    `, [
            config.isEnabled,
            config.threshold,
            config.durationMs,
            config.windowMs,
            config.trackedViolations,
            config.excludedIps,
            config.excludedCountries
        ]);
        return this.rowToAutobanConfig(result.rows[0]);
    }
    // ============================================================
    // SECURITY EVENTS OPERATIONS
    // ============================================================
    /**
     * Log a security event
     */
    async logSecurityEvent(payload) {
        const id = uuidv4();
        const start = Date.now();
        const result = await this.pool.queryWithSwag(`
      INSERT INTO security_events (
        id, event_type, event_action, category, ip_address, user_agent,
        fingerprint, session_id, details, severity, threat_score,
        country, region, city, is_vpn, is_proxy, is_tor,
        is_data_center, is_government, is_federal_facility, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21
      )
      RETURNING *
    `, [
            id,
            payload.eventType,
            payload.eventAction,
            payload.category ?? 'violation',
            payload.ipAddress || null,
            payload.userAgent || null,
            payload.fingerprint || null,
            payload.sessionId || null,
            JSON.stringify(payload.details ?? {}),
            payload.severity ?? 'medium',
            payload.threatScore ?? 0,
            payload.country || null,
            payload.region || null,
            payload.city || null,
            payload.isVpn ?? false,
            payload.isProxy ?? false,
            payload.isTor ?? false,
            payload.isDataCenter ?? false,
            payload.isGovernment ?? false,
            payload.isFederalFacility ?? false,
            JSON.stringify(payload.metadata ?? {})
        ]);
        this.stats.eventsCreated++;
        this.stats.queries++;
        logger.debug({ id, type: payload.eventType, duration: Date.now() - start }, 'security event logged');
        return this.rowToSecurityEvent(result.rows[0]);
    }
    /**
     * Get recent security events
     */
    async getRecentSecurityEvents(limit = 100, offset = 0) {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM security_events
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
        return result.rows.map(row => this.rowToSecurityEvent(row));
    }
    /**
     * Get security events by IP
     */
    async getSecurityEventsByIp(ip, limit = 50) {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM security_events
      WHERE ip_address = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [ip, limit]);
        return result.rows.map(row => this.rowToSecurityEvent(row));
    }
    /**
     * Get unresolved security events
     */
    async getUnresolvedEvents(severity) {
        this.stats.queries++;
        const query = severity
            ? `SELECT * FROM security_events WHERE is_resolved = false AND severity = $1 ORDER BY created_at DESC`
            : `SELECT * FROM security_events WHERE is_resolved = false ORDER BY created_at DESC`;
        const result = await this.pool.queryWithSwag(query, severity ? [severity] : []);
        return result.rows.map(row => this.rowToSecurityEvent(row));
    }
    /**
     * Resolve a security event
     */
    async resolveEvent(id, resolvedBy, notes) {
        this.stats.queries++;
        await this.pool.queryWithSwag(`
      UPDATE security_events
      SET is_resolved = true, resolved_at = NOW(), resolved_by = $2, resolution_notes = $3
      WHERE id = $1
    `, [id, resolvedBy, notes || null]);
    }
    // ============================================================
    // STATS OPERATIONS
    // ============================================================
    /**
     * Get API stats
     */
    async getApiStats() {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM api_stats
    `);
        if (result.rows.length === 0) {
            return {
                totalEndpoints: 0,
                enabledEndpoints: 0,
                authRequiredEndpoints: 0,
                deprecatedEndpoints: 0,
                totalApiRequests: 0,
                totalSuccessfulRequests: 0,
                totalFailedRequests: 0
            };
        }
        const row = result.rows[0];
        return {
            totalEndpoints: parseInt(row.total_endpoints) || 0,
            enabledEndpoints: parseInt(row.enabled_endpoints) || 0,
            authRequiredEndpoints: parseInt(row.auth_required_endpoints) || 0,
            deprecatedEndpoints: parseInt(row.deprecated_endpoints) || 0,
            totalApiRequests: parseInt(row.total_api_requests) || 0,
            totalSuccessfulRequests: parseInt(row.total_successful_requests) || 0,
            totalFailedRequests: parseInt(row.total_failed_requests) || 0,
            lastApiRequest: row.last_api_request
        };
    }
    /**
     * Get security stats
     */
    async getSecurityStats() {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM security_stats
    `);
        if (result.rows.length === 0) {
            return {
                totalEvents: 0,
                vpnEvents: 0,
                criticalEvents: 0,
                highSeverityEvents: 0,
                unresolvedEvents: 0,
                eventsLast24h: 0,
                eventsLast7d: 0,
                uniqueIps: 0,
                uniqueCountries: 0
            };
        }
        const row = result.rows[0];
        return {
            totalEvents: parseInt(row.total_events) || 0,
            vpnEvents: parseInt(row.vpn_events) || 0,
            criticalEvents: parseInt(row.critical_events) || 0,
            highSeverityEvents: parseInt(row.high_severity_events) || 0,
            unresolvedEvents: parseInt(row.unresolved_events) || 0,
            eventsLast24h: parseInt(row.events_last_24h) || 0,
            eventsLast7d: parseInt(row.events_last_7d) || 0,
            uniqueIps: parseInt(row.unique_ips) || 0,
            uniqueCountries: parseInt(row.unique_countries) || 0
        };
    }
    /**
     * Get ban stats
     */
    async getBanStats() {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM ban_stats
    `);
        if (result.rows.length === 0) {
            return {
                totalBans: 0,
                activeBans: 0,
                permanentBans: 0,
                autoBans: 0,
                manualBans: 0,
                vpnBans: 0,
                bansLast24h: 0,
                bansLast7d: 0
            };
        }
        const row = result.rows[0];
        return {
            totalBans: parseInt(row.total_bans) || 0,
            activeBans: parseInt(row.active_bans) || 0,
            permanentBans: parseInt(row.permanent_bans) || 0,
            autoBans: parseInt(row.auto_bans) || 0,
            manualBans: parseInt(row.manual_bans) || 0,
            vpnBans: parseInt(row.vpn_bans) || 0,
            bansLast24h: parseInt(row.bans_last_24h) || 0,
            bansLast7d: parseInt(row.bans_last_7d) || 0
        };
    }
    /**
     * Refresh all API data stats
     */
    async refreshStats() {
        this.stats.queries += 3;
        await Promise.all([
            this.pool.queryWithSwag(`SELECT refresh_api_stats()`),
            this.pool.queryWithSwag(`SELECT refresh_security_stats()`),
            this.pool.queryWithSwag(`SELECT refresh_ban_stats()`)
        ]);
        logger.debug('API data stats refreshed');
    }
    /**
     * Run cleanup for expired data
     */
    async runCleanup() {
        this.stats.queries++;
        const result = await this.pool.queryWithSwag(`
      SELECT * FROM cleanup_expired_api_data()
    `);
        const row = result.rows[0];
        const cleaned = {
            expiredBans: parseInt(row.expired_bans) || 0,
            expiredSessions: parseInt(row.expired_sessions) || 0,
            oldEvents: parseInt(row.old_events) || 0
        };
        logger.info(cleaned, 'API data cleanup completed');
        return cleaned;
    }
    /**
     * Get manager stats
     */
    getStats() {
        return { ...this.stats };
    }
    // ============================================================
    // PRIVATE HELPERS - Row to object mappers
    // ============================================================
    rowToEndpoint(row) {
        return {
            id: row.id,
            path: row.path,
            method: row.method,
            name: row.name,
            description: row.description,
            rateLimitMax: row.rate_limit_max,
            rateLimitWindowMs: row.rate_limit_window_ms,
            rateLimitSkipLocalhost: row.rate_limit_skip_localhost,
            requiresAuth: row.requires_auth,
            allowedRoles: row.allowed_roles || [],
            allowedIps: row.allowed_ips || [],
            blockedIps: row.blocked_ips || [],
            isEnabled: row.is_enabled,
            isDeprecated: row.is_deprecated,
            deprecationMessage: row.deprecation_message,
            totalRequests: parseInt(row.total_requests) || 0,
            successfulRequests: parseInt(row.successful_requests) || 0,
            failedRequests: parseInt(row.failed_requests) || 0,
            lastRequestAt: row.last_request_at,
            tags: row.tags || [],
            metadata: row.metadata || {},
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    rowToBan(row) {
        return {
            id: row.id,
            ipAddress: row.ip_address,
            ipRange: row.ip_range,
            reason: row.reason,
            banType: row.ban_type,
            severity: row.severity,
            isPermanent: row.is_permanent,
            expiresAt: row.expires_at,
            userAgent: row.user_agent,
            fingerprint: row.fingerprint,
            country: row.country,
            violationCount: row.violation_count,
            violations: row.violations || [],
            isActive: row.is_active,
            liftedAt: row.lifted_at,
            liftedBy: row.lifted_by,
            liftReason: row.lift_reason,
            metadata: row.metadata || {},
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    rowToAutobanConfig(row) {
        return {
            id: row.id,
            isEnabled: row.is_enabled,
            threshold: row.threshold,
            durationMs: row.duration_ms,
            windowMs: row.window_ms,
            trackedViolations: row.tracked_violations || [],
            excludedIps: row.excluded_ips || [],
            excludedCountries: row.excluded_countries || [],
            metadata: row.metadata || {},
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    rowToSecurityEvent(row) {
        return {
            id: row.id,
            eventType: row.event_type,
            eventAction: row.event_action,
            category: row.category,
            ipAddress: row.ip_address,
            userAgent: row.user_agent,
            fingerprint: row.fingerprint,
            sessionId: row.session_id,
            details: row.details || {},
            severity: row.severity,
            threatScore: row.threat_score,
            country: row.country,
            region: row.region,
            city: row.city,
            isVpn: row.is_vpn,
            isProxy: row.is_proxy,
            isTor: row.is_tor,
            isDataCenter: row.is_data_center,
            isGovernment: row.is_government,
            isFederalFacility: row.is_federal_facility,
            isResolved: row.is_resolved,
            resolvedAt: row.resolved_at,
            resolvedBy: row.resolved_by,
            resolutionNotes: row.resolution_notes,
            metadata: row.metadata || {},
            createdAt: row.created_at
        };
    }
}
// ============================================================
// SINGLETON MANAGEMENT
// ============================================================
let apiDataManagerInstance = null;
export function getApiDataManager() {
    if (!apiDataManagerInstance) {
        throw new Error('ApiDataManager not initialized - call initApiDataManager first');
    }
    return apiDataManagerInstance;
}
export function initApiDataManager(pool) {
    if (apiDataManagerInstance) {
        logger.warn('ApiDataManager already initialized');
        return apiDataManagerInstance;
    }
    apiDataManagerInstance = new ApiDataManager(pool);
    return apiDataManagerInstance;
}
export function resetApiDataManager() {
    apiDataManagerInstance = null;
}
//# sourceMappingURL=apiDataManager.js.map