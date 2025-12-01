// yooo this script migrates all JSON data to PostgreSQL
// run this ONCE after the migration to move existing data
// this is the BIG MOVE from JSON files to the database fr fr
import * as fs from 'fs';
import * as path from 'path';
import { ApiDataManager } from './apiDataManager.js';
import { logger } from '../utils/logger.js';
// Data directory paths
const DATA_DIR = path.join(process.cwd(), 'data');
const ENDPOINTS_FILE = path.join(DATA_DIR, 'api-endpoints', 'endpoints.json');
const BANS_FILE = path.join(DATA_DIR, 'bans', 'data.json');
const AUTOBAN_CONFIG_FILE = path.join(DATA_DIR, 'bans', 'autoban-config.json');
const OAUTH_FILE = path.join(DATA_DIR, 'oauth', 'providers.json');
const VPN_EVENTS_FILE = path.join(DATA_DIR, 'events', 'vpn.json');
const VPN_VIOLATIONS_DIR = path.join(DATA_DIR, 'vpn_violations');
const ADMIN_SESSIONS_FILE = path.join(DATA_DIR, 'admin_sessions', 'data.json');
const GOV_FACILITIES_FILE = path.join(DATA_DIR, 'security', 'government-facilities.json');
/**
 * Safely read and parse a JSON file
 */
function safeReadJson(filePath, defaultValue) {
    try {
        if (!fs.existsSync(filePath)) {
            logger.debug({ filePath }, 'JSON file does not exist');
            return defaultValue;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    }
    catch (err) {
        logger.warn({ filePath, error: err.message }, 'Failed to read JSON file');
        return defaultValue;
    }
}
/**
 * Migrate API endpoints from JSON to PostgreSQL
 */
async function migrateEndpoints(apiData) {
    const result = { migrated: 0, failed: 0 };
    const endpoints = safeReadJson(ENDPOINTS_FILE, []);
    if (endpoints.length === 0) {
        logger.info('No endpoints to migrate');
        return result;
    }
    logger.info({ count: endpoints.length }, 'Migrating API endpoints');
    for (const endpoint of endpoints) {
        try {
            await apiData.createEndpoint({
                path: endpoint.path || endpoint.route || '/unknown',
                method: endpoint.method || 'GET',
                name: endpoint.name || endpoint.path || 'Unknown',
                description: endpoint.description,
                rateLimitMax: endpoint.rateLimitMax || endpoint.rateLimit?.max || 100,
                rateLimitWindowMs: endpoint.rateLimitWindowMs || endpoint.rateLimit?.windowMs || 60000,
                rateLimitSkipLocalhost: endpoint.rateLimitSkipLocalhost ?? true,
                requiresAuth: endpoint.requiresAuth ?? true,
                allowedRoles: endpoint.allowedRoles || [],
                allowedIps: endpoint.allowedIps || [],
                blockedIps: endpoint.blockedIps || [],
                isEnabled: endpoint.isEnabled ?? endpoint.enabled ?? true,
                tags: endpoint.tags || [],
                metadata: endpoint.metadata || {}
            });
            result.migrated++;
        }
        catch (err) {
            logger.error({ endpoint: endpoint.path, error: err.message }, 'Failed to migrate endpoint');
            result.failed++;
        }
    }
    return result;
}
/**
 * Migrate IP bans from JSON to PostgreSQL
 */
async function migrateBans(apiData) {
    const result = { migrated: 0, failed: 0 };
    const bans = safeReadJson(BANS_FILE, {});
    const banEntries = Object.entries(bans);
    if (banEntries.length === 0) {
        logger.info('No bans to migrate');
        return result;
    }
    logger.info({ count: banEntries.length }, 'Migrating IP bans');
    for (const [ip, banData] of banEntries) {
        try {
            await apiData.createBan({
                ipAddress: ip,
                reason: banData.reason || 'Migrated from JSON',
                banType: banData.banType || banData.type || 'manual',
                severity: banData.severity || 'medium',
                isPermanent: banData.isPermanent ?? banData.permanent ?? false,
                expiresAt: banData.expiresAt ? new Date(banData.expiresAt) : undefined,
                userAgent: banData.userAgent,
                fingerprint: banData.fingerprint,
                country: banData.country,
                violations: banData.violations || [],
                metadata: { migratedFrom: 'json', originalData: banData }
            });
            result.migrated++;
        }
        catch (err) {
            logger.error({ ip, error: err.message }, 'Failed to migrate ban');
            result.failed++;
        }
    }
    return result;
}
/**
 * Migrate autoban configuration from JSON to PostgreSQL
 */
async function migrateAutobanConfig(apiData) {
    const config = safeReadJson(AUTOBAN_CONFIG_FILE, null);
    if (!config) {
        logger.info('No autoban config to migrate');
        return false;
    }
    logger.info('Migrating autoban configuration');
    try {
        await apiData.updateAutobanConfig({
            isEnabled: config.enabled ?? config.isEnabled ?? true,
            threshold: config.threshold ?? 10,
            durationMs: config.duration ?? config.durationMs ?? 300000,
            windowMs: config.windowMs ?? 86400000,
            trackedViolations: config.trackedViolations || ['vpn', 'rate_limit', 'security'],
            excludedIps: config.excludedIps || [],
            excludedCountries: config.excludedCountries || []
        });
        return true;
    }
    catch (err) {
        logger.error({ error: err.message }, 'Failed to migrate autoban config');
        return false;
    }
}
/**
 * Migrate security events (VPN events and violations) from JSON to PostgreSQL
 */
async function migrateSecurityEvents(apiData) {
    const result = { migrated: 0, failed: 0 };
    // Migrate VPN events file
    const vpnEvents = safeReadJson(VPN_EVENTS_FILE, []);
    logger.info({ count: vpnEvents.length }, 'Migrating VPN events');
    for (const event of vpnEvents) {
        try {
            await apiData.logSecurityEvent({
                eventType: event.event_type || event.eventType || 'vpn',
                eventAction: event.event_action || event.eventAction || 'VPN detected',
                category: event.category || 'violation',
                ipAddress: event.ip_address || event.ipAddress,
                userAgent: event.user_agent || event.userAgent,
                fingerprint: event.fingerprint,
                details: event.details || {},
                severity: event.severity || 'high',
                threatScore: event.details?.threatScore || event.threatScore || 0,
                country: event.details?.country || event.country,
                isVpn: event.details?.isVPN ?? event.isVpn ?? true,
                isDataCenter: event.details?.isDataCenter ?? event.isDataCenter ?? false,
                isGovernment: event.details?.isGovernment ?? event.isGovernment ?? false,
                isFederalFacility: event.details?.isFederalFacility ?? event.isFederalFacility ?? false,
                metadata: { migratedFrom: 'vpn.json', originalTimestamp: event.timestamp }
            });
            result.migrated++;
        }
        catch (err) {
            logger.error({ error: err.message }, 'Failed to migrate VPN event');
            result.failed++;
        }
    }
    // Migrate individual VPN violation files
    if (fs.existsSync(VPN_VIOLATIONS_DIR)) {
        const files = fs.readdirSync(VPN_VIOLATIONS_DIR).filter(f => f.endsWith('.json'));
        logger.info({ count: files.length }, 'Migrating VPN violation files');
        for (const file of files) {
            try {
                const filePath = path.join(VPN_VIOLATIONS_DIR, file);
                const violation = safeReadJson(filePath, null);
                if (violation) {
                    await apiData.logSecurityEvent({
                        eventType: 'vpn_violation',
                        eventAction: violation.action || 'VPN violation detected',
                        category: 'violation',
                        ipAddress: violation.ip || violation.ipAddress,
                        userAgent: violation.userAgent,
                        details: violation,
                        severity: violation.severity || 'high',
                        threatScore: violation.threatScore || 0,
                        country: violation.country,
                        isVpn: violation.isVPN ?? true,
                        isDataCenter: violation.isDataCenter ?? false,
                        metadata: { migratedFrom: file }
                    });
                    result.migrated++;
                }
            }
            catch (err) {
                logger.error({ file, error: err.message }, 'Failed to migrate VPN violation file');
                result.failed++;
            }
        }
    }
    return result;
}
/**
 * Migrate OAuth providers from JSON to PostgreSQL
 */
async function migrateOAuthProviders(pool) {
    const result = { migrated: 0, failed: 0 };
    const data = safeReadJson(OAUTH_FILE, { providers: [] });
    if (!data.providers || data.providers.length === 0) {
        logger.info('No OAuth providers to migrate');
        return result;
    }
    logger.info({ count: data.providers.length }, 'Migrating OAuth providers');
    for (const provider of data.providers) {
        try {
            await pool.queryWithSwag(`
        INSERT INTO oauth_providers (
          provider_name, display_name, client_id, client_secret_encrypted,
          authorization_url, token_url, userinfo_url, scope,
          is_enabled, is_configured, redirect_uri, icon_url, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (provider_name) DO NOTHING
      `, [
                provider.name || provider.providerName,
                provider.displayName || provider.name,
                provider.clientId,
                provider.clientSecret, // Should be encrypted in production
                provider.authorizationUrl,
                provider.tokenUrl,
                provider.userinfoUrl,
                provider.scope || 'openid profile email',
                provider.isEnabled ?? false,
                provider.isConfigured ?? false,
                provider.redirectUri,
                provider.iconUrl,
                JSON.stringify(provider.metadata || {})
            ]);
            result.migrated++;
        }
        catch (err) {
            logger.error({ provider: provider.name, error: err.message }, 'Failed to migrate OAuth provider');
            result.failed++;
        }
    }
    return result;
}
/**
 * Migrate admin sessions from JSON to PostgreSQL
 */
async function migrateAdminSessions(pool) {
    const result = { migrated: 0, failed: 0 };
    const sessions = safeReadJson(ADMIN_SESSIONS_FILE, []);
    if (sessions.length === 0) {
        logger.info('No admin sessions to migrate');
        return result;
    }
    logger.info({ count: sessions.length }, 'Migrating admin sessions');
    for (const session of sessions) {
        try {
            await pool.queryWithSwag(`
        INSERT INTO admin_sessions (
          session_token, username, ip_address, user_agent,
          is_active, expires_at, session_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (session_token) DO NOTHING
      `, [
                session.token || session.sessionToken,
                session.username,
                session.ipAddress || session.ip,
                session.userAgent,
                session.isActive ?? true,
                session.expiresAt ? new Date(session.expiresAt) : null,
                JSON.stringify(session.data || session.sessionData || {})
            ]);
            result.migrated++;
        }
        catch (err) {
            logger.error({ error: err.message }, 'Failed to migrate admin session');
            result.failed++;
        }
    }
    return result;
}
/**
 * Migrate government facilities from JSON to PostgreSQL
 */
async function migrateGovernmentFacilities(pool) {
    const result = { migrated: 0, failed: 0 };
    const facilities = safeReadJson(GOV_FACILITIES_FILE, []);
    if (facilities.length === 0) {
        logger.info('No government facilities to migrate');
        return result;
    }
    logger.info({ count: facilities.length }, 'Migrating government facilities');
    for (const facility of facilities) {
        try {
            await pool.queryWithSwag(`
        INSERT INTO government_facilities (
          name, facility_type, country, ip_ranges,
          classification, threat_level, should_block,
          should_log, alert_on_access, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
                facility.name,
                facility.type || facility.facilityType,
                facility.country,
                facility.ipRanges || facility.ip_ranges || [],
                facility.classification || 'government',
                facility.threatLevel || 'high',
                facility.shouldBlock ?? false,
                facility.shouldLog ?? true,
                facility.alertOnAccess ?? true,
                JSON.stringify(facility.metadata || {})
            ]);
            result.migrated++;
        }
        catch (err) {
            logger.error({ facility: facility.name, error: err.message }, 'Failed to migrate government facility');
            result.failed++;
        }
    }
    return result;
}
/**
 * Main migration function - runs all migrations
 */
export async function migrateAllJsonToPostgres(pool) {
    logger.info('Starting JSON to PostgreSQL migration...');
    const start = Date.now();
    const apiData = new ApiDataManager(pool);
    const errors = [];
    const result = {
        endpoints: { migrated: 0, failed: 0 },
        bans: { migrated: 0, failed: 0 },
        autobanConfig: false,
        securityEvents: { migrated: 0, failed: 0 },
        oauthProviders: { migrated: 0, failed: 0 },
        adminSessions: { migrated: 0, failed: 0 },
        governmentFacilities: { migrated: 0, failed: 0 },
        errors
    };
    // Run all migrations
    try {
        result.endpoints = await migrateEndpoints(apiData);
    }
    catch (err) {
        errors.push(`Endpoints migration failed: ${err.message}`);
    }
    try {
        result.bans = await migrateBans(apiData);
    }
    catch (err) {
        errors.push(`Bans migration failed: ${err.message}`);
    }
    try {
        result.autobanConfig = await migrateAutobanConfig(apiData);
    }
    catch (err) {
        errors.push(`Autoban config migration failed: ${err.message}`);
    }
    try {
        result.securityEvents = await migrateSecurityEvents(apiData);
    }
    catch (err) {
        errors.push(`Security events migration failed: ${err.message}`);
    }
    try {
        result.oauthProviders = await migrateOAuthProviders(pool);
    }
    catch (err) {
        errors.push(`OAuth providers migration failed: ${err.message}`);
    }
    try {
        result.adminSessions = await migrateAdminSessions(pool);
    }
    catch (err) {
        errors.push(`Admin sessions migration failed: ${err.message}`);
    }
    try {
        result.governmentFacilities = await migrateGovernmentFacilities(pool);
    }
    catch (err) {
        errors.push(`Government facilities migration failed: ${err.message}`);
    }
    // Refresh stats after migration
    try {
        await apiData.refreshStats();
    }
    catch (err) {
        logger.warn({ error: err.message }, 'Failed to refresh stats after migration');
    }
    const duration = Date.now() - start;
    logger.info({ result, duration }, 'JSON to PostgreSQL migration completed');
    return result;
}
/**
 * Check if migration is needed
 */
export async function checkMigrationNeeded() {
    // Check if any JSON files exist
    const filesToCheck = [
        ENDPOINTS_FILE,
        BANS_FILE,
        AUTOBAN_CONFIG_FILE,
        OAUTH_FILE,
        VPN_EVENTS_FILE,
        ADMIN_SESSIONS_FILE,
        GOV_FACILITIES_FILE
    ];
    for (const file of filesToCheck) {
        if (fs.existsSync(file)) {
            try {
                const content = fs.readFileSync(file, 'utf-8');
                const data = JSON.parse(content);
                // Check if file has actual data
                if (Array.isArray(data) && data.length > 0)
                    return true;
                if (typeof data === 'object' && Object.keys(data).length > 0)
                    return true;
            }
            catch {
                // Ignore parse errors
            }
        }
    }
    // Check for VPN violation files
    if (fs.existsSync(VPN_VIOLATIONS_DIR)) {
        const files = fs.readdirSync(VPN_VIOLATIONS_DIR).filter(f => f.endsWith('.json'));
        if (files.length > 0)
            return true;
    }
    return false;
}
/**
 * Backup JSON files before migration
 */
export function backupJsonFiles() {
    const backupDir = path.join(DATA_DIR, `backup-${Date.now()}`);
    fs.mkdirSync(backupDir, { recursive: true });
    const dirsToBackup = [
        'api-endpoints',
        'bans',
        'oauth',
        'events',
        'vpn_violations',
        'admin_sessions',
        'security'
    ];
    for (const dir of dirsToBackup) {
        const srcDir = path.join(DATA_DIR, dir);
        if (fs.existsSync(srcDir)) {
            const destDir = path.join(backupDir, dir);
            fs.mkdirSync(destDir, { recursive: true });
            // Copy files
            const files = fs.readdirSync(srcDir);
            for (const file of files) {
                fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
            }
        }
    }
    logger.info({ backupDir }, 'JSON files backed up');
    return backupDir;
}
//# sourceMappingURL=migrateJsonToPostgres.js.map