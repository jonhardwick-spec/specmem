/**
 * apiVersioning.ts - API Versioning Middleware
 *
 * yo this adds proper API versioning to all endpoints
 * /api/v1/* is the new hotness, /api/* redirects for backwards compat
 * deprecation warnings for the old heads fr fr
 *
 * Issue #23 fix - API versioning for dashboard endpoints
 */
import { Request, Response, NextFunction, Router, Application } from 'express';
/**
 * API version configuration
 */
export interface ApiVersionConfig {
    /** Current API version */
    currentVersion: string;
    /** Supported versions */
    supportedVersions: string[];
    /** Deprecated versions (still work but warn) */
    deprecatedVersions: string[];
    /** Whether to add deprecation warnings */
    warnDeprecated: boolean;
}
/**
 * API versioning middleware factory
 *
 * Creates middleware that:
 * - Redirects /api/* to /api/v1/*
 * - Adds version headers to responses
 * - Logs deprecation warnings
 */
export declare function createApiVersionMiddleware(config?: Partial<ApiVersionConfig>): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Create versioned router that aliases all routes
 *
 * Use this to register routes at both /api/v1/* and /api/*
 */
export declare function createVersionedRouter(app: Application, setupRoutes: (router: Router) => void, version?: string): void;
/**
 * Route registration helper that adds version prefix
 */
export declare function versionedPath(path: string, version?: string): string;
/**
 * Health endpoint response with version info
 */
export interface VersionedHealthResponse {
    status: 'healthy' | 'degraded' | 'unhealthy';
    version: string;
    apiVersion: string;
    uptime: number;
    timestamp: string;
    deprecatedEndpointsUsed?: boolean;
}
/**
 * Create versioned health check handler
 */
export declare function createHealthHandler(getUptime: () => number, config?: Partial<ApiVersionConfig>): (_req: Request, res: Response) => void;
/**
 * Deprecation notice middleware for specific endpoints
 */
export declare function deprecatedEndpoint(message: string, successorPath?: string): (_req: Request, res: Response, next: NextFunction) => void;
/**
 * API info response schema
 */
export interface ApiInfoResponse {
    name: string;
    description: string;
    version: string;
    apiVersion: string;
    supportedVersions: string[];
    deprecatedVersions: string[];
    documentation: string;
    endpoints: {
        health: string;
        docs: string;
        metrics: string;
    };
}
/**
 * Create API info handler
 */
export declare function createApiInfoHandler(config?: Partial<ApiVersionConfig>): (_req: Request, res: Response) => void;
//# sourceMappingURL=apiVersioning.d.ts.map