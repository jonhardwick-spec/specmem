/**
 * middleware/index.ts - Middleware Module Exports
 *
 * yo this exports ALL the fire middleware
 * rate limiting, CSRF, compression, API versioning fr fr
 *
 * Production readiness middleware for SpecMem Dashboard
 */
export { WsRateLimiter, WsRateLimiterConfig, RateLimitResult, getWsRateLimiter, resetWsRateLimiter, extractClientIp } from './wsRateLimiter.js';
export { CsrfProtection, CsrfConfig, getCsrfProtection, resetCsrfProtection, getCsrfMetaTag, getCsrfInputField, CSRF_FETCH_SCRIPT } from './csrf.js';
export { compressionMiddleware, CompressionConfig, minifyHtml, minifyCss, minifyJs, processHtml, preCompress } from './compression.js';
export { createApiVersionMiddleware, createVersionedRouter, createHealthHandler, createApiInfoHandler, deprecatedEndpoint, versionedPath, ApiVersionConfig, VersionedHealthResponse, ApiInfoResponse } from './apiVersioning.js';
//# sourceMappingURL=index.d.ts.map