/**
 * apiVersioning.ts - API Versioning Middleware
 *
 * yo this adds proper API versioning to all endpoints
 * /api/v1/* is the new hotness, /api/* redirects for backwards compat
 * deprecation warnings for the old heads fr fr
 *
 * Issue #23 fix - API versioning for dashboard endpoints
 */
// @ts-ignore - express types not installed
import { Router } from 'express';
import { logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    currentVersion: 'v1',
    supportedVersions: ['v1'],
    deprecatedVersions: [],
    warnDeprecated: true
};
/**
 * API versioning middleware factory
 *
 * Creates middleware that:
 * - Redirects /api/* to /api/v1/*
 * - Adds version headers to responses
 * - Logs deprecation warnings
 */
export function createApiVersionMiddleware(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    return (req, res, next) => {
        // Add API version header to all responses
        res.setHeader('X-API-Version', cfg.currentVersion);
        // Check if request is to legacy /api/ endpoint (not /api/v*)
        const path = req.path;
        if (path.startsWith('/api/') && !path.match(/^\/api\/v\d+\//)) {
            // This is a legacy endpoint - add deprecation warning
            if (cfg.warnDeprecated) {
                res.setHeader('Deprecation', 'true');
                res.setHeader('Sunset', getSunsetDate());
                res.setHeader('Link', `</api/${cfg.currentVersion}${path.replace('/api', '')}>; rel="successor-version"`);
                logger.debug({
                    path,
                    clientIp: req.ip,
                    userAgent: req.get('user-agent')?.slice(0, 50)
                }, 'legacy API endpoint used - deprecation warning sent');
            }
        }
        // Extract version from path if present
        const versionMatch = path.match(/^\/api\/(v\d+)\//);
        if (versionMatch) {
            const version = versionMatch[1];
            if (version && !cfg.supportedVersions.includes(version)) {
                res.status(400).json({
                    error: 'Unsupported API version',
                    requestedVersion: version,
                    supportedVersions: cfg.supportedVersions,
                    currentVersion: cfg.currentVersion
                });
                return;
            }
            if (version && cfg.deprecatedVersions.includes(version)) {
                res.setHeader('Deprecation', 'true');
                res.setHeader('Sunset', getSunsetDate());
            }
        }
        next();
    };
}
/**
 * Get sunset date (3 months from now)
 */
function getSunsetDate() {
    const sunset = new Date();
    sunset.setMonth(sunset.getMonth() + 3);
    return sunset.toUTCString();
}
/**
 * Create versioned router that aliases all routes
 *
 * Use this to register routes at both /api/v1/* and /api/*
 */
export function createVersionedRouter(app, setupRoutes, version = 'v1') {
    const router = Router();
    // Setup routes on the router
    setupRoutes(router);
    // Mount at versioned path (primary)
    app.use(`/api/${version}`, router);
    // Create alias router for legacy /api/* paths
    const aliasRouter = Router();
    setupRoutes(aliasRouter);
    app.use('/api', aliasRouter);
    logger.debug({ version }, 'API routes mounted with versioning');
}
/**
 * Route registration helper that adds version prefix
 */
export function versionedPath(path, version = 'v1') {
    return `/api/${version}${path}`;
}
/**
 * Create versioned health check handler
 */
export function createHealthHandler(getUptime, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    return (_req, res) => {
        const response = {
            status: 'healthy',
            version: '1.0.0', // Replace with actual version
            apiVersion: cfg.currentVersion,
            uptime: getUptime(),
            timestamp: new Date().toISOString()
        };
        res.json(response);
    };
}
/**
 * Deprecation notice middleware for specific endpoints
 */
export function deprecatedEndpoint(message, successorPath) {
    return (_req, res, next) => {
        res.setHeader('Deprecation', 'true');
        res.setHeader('Sunset', getSunsetDate());
        res.setHeader('X-Deprecation-Notice', message);
        if (successorPath) {
            res.setHeader('Link', `<${successorPath}>; rel="successor-version"`);
        }
        next();
    };
}
/**
 * Create API info handler
 */
export function createApiInfoHandler(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    return (_req, res) => {
        const response = {
            name: 'SpecMem Dashboard API',
            description: 'REST API for managing SpecMem memories, codebase, and team members',
            version: '1.0.0',
            apiVersion: cfg.currentVersion,
            supportedVersions: cfg.supportedVersions,
            deprecatedVersions: cfg.deprecatedVersions,
            documentation: `/api/${cfg.currentVersion}/docs`,
            endpoints: {
                health: `/api/${cfg.currentVersion}/health`,
                docs: `/api/${cfg.currentVersion}/docs`,
                metrics: `/api/${cfg.currentVersion}/metrics`
            }
        };
        res.json(response);
    };
}
//# sourceMappingURL=apiVersioning.js.map