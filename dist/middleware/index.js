/**
 * middleware/index.ts - Middleware Module Exports
 *
 * yo this exports ALL the fire middleware
 * rate limiting, CSRF, compression, API versioning fr fr
 *
 * Production readiness middleware for SpecMem Dashboard
 */
// WebSocket Rate Limiter - Issue #25
export { WsRateLimiter, getWsRateLimiter, resetWsRateLimiter, extractClientIp } from './wsRateLimiter.js';
// CSRF Protection - Issue #37
export { CsrfProtection, getCsrfProtection, resetCsrfProtection, getCsrfMetaTag, getCsrfInputField, CSRF_FETCH_SCRIPT } from './csrf.js';
// Response Compression - Issue #24
export { compressionMiddleware, minifyHtml, minifyCss, minifyJs, processHtml, preCompress } from './compression.js';
// API Versioning - Issue #23
export { createApiVersionMiddleware, createVersionedRouter, createHealthHandler, createApiInfoHandler, deprecatedEndpoint, versionedPath } from './apiVersioning.js';
//# sourceMappingURL=index.js.map