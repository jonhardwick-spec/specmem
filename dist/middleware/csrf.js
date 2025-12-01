/**
 * csrf.ts - CSRF Protection Middleware for SpecMem Dashboard
 *
 * yo this prevents cross-site request forgery attacks
 * tokens for state-changing operations fr fr
 * keeps the dashboard SECURE
 *
 * Issue #37 fix - CSRF protection
 */
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    tokenLength: 32,
    cookieName: '_specmem_csrf',
    headerName: 'x-csrf-token',
    fieldName: '_csrf',
    tokenValidityMs: 24 * 60 * 60 * 1000, // 24 hours
    secureCookie: false, // Set to true in production with HTTPS
    sameSite: 'lax',
    protectedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    ignorePaths: [
        /^\/api\/v\d+\/health$/,
        /^\/api\/health$/,
        /^\/metrics$/,
        /^\/api\/v\d+\/metrics$/
    ]
};
/**
 * CsrfProtection - prevents cross-site request forgery
 *
 * Features that KEEP US SAFE:
 * - Double submit cookie pattern
 * - Token validation
 * - Configurable protected methods
 * - Path exclusions
 */
export class CsrfProtection {
    config;
    tokens = new Map();
    cleanupInterval = null;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        // Start cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredTokens();
        }, 60000); // Every minute
        this.cleanupInterval.unref?.();
    }
    /**
     * Generate a new CSRF token
     */
    generateToken() {
        const secret = crypto.randomBytes(this.config.tokenLength).toString('hex');
        const token = this.createToken(secret);
        this.tokens.set(token, {
            secret,
            createdAt: Date.now()
        });
        return { token, secret };
    }
    /**
     * Create token from secret
     */
    createToken(secret) {
        const timestamp = Date.now().toString(36);
        const hash = crypto
            .createHmac('sha256', secret)
            .update(timestamp)
            .digest('hex')
            .slice(0, 32);
        return `${timestamp}.${hash}`;
    }
    /**
     * Validate a CSRF token
     */
    validateToken(token, secret) {
        if (!token || !secret)
            return false;
        // Check if token exists
        const tokenData = this.tokens.get(token);
        if (!tokenData) {
            // Try to validate against provided secret
            return this.verifyTokenSignature(token, secret);
        }
        // Check expiration
        if (Date.now() - tokenData.createdAt > this.config.tokenValidityMs) {
            this.tokens.delete(token);
            return false;
        }
        // Verify secret matches
        return tokenData.secret === secret;
    }
    /**
     * Verify token signature
     */
    verifyTokenSignature(token, secret) {
        const parts = token.split('.');
        if (parts.length !== 2)
            return false;
        const [timestamp, hash] = parts;
        if (!timestamp || !hash)
            return false;
        // Check token age
        const tokenTime = parseInt(timestamp, 36);
        if (isNaN(tokenTime) || Date.now() - tokenTime > this.config.tokenValidityMs) {
            return false;
        }
        // Verify hash
        const expectedHash = crypto
            .createHmac('sha256', secret)
            .update(timestamp)
            .digest('hex')
            .slice(0, 32);
        return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
    }
    /**
     * Check if path should be protected
     */
    shouldProtect(method, path) {
        // Check method
        if (!this.config.protectedMethods.includes(method.toUpperCase())) {
            return false;
        }
        // Check ignore paths
        for (const pattern of this.config.ignorePaths) {
            if (pattern.test(path)) {
                return false;
            }
        }
        return true;
    }
    /**
     * Express-style middleware
     */
    middleware() {
        return (req, res, next) => {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const path = url.pathname;
            const method = req.method || 'GET';
            // Add CSRF token to response for GET requests
            if (method === 'GET') {
                const { token, secret } = this.generateToken();
                this.setTokenCookie(res, secret);
                // Attach token to response for templates
                res.csrfToken = token;
            }
            // Skip validation for non-protected methods/paths
            if (!this.shouldProtect(method, path)) {
                return next();
            }
            // Get token from header or body
            const tokenFromHeader = req.headers[this.config.headerName];
            const tokenFromBody = req.body?.[this.config.fieldName];
            const token = tokenFromHeader || tokenFromBody;
            // Get secret from cookie
            const secret = this.getSecretFromCookie(req);
            if (!token || !secret) {
                logger.warn({ method, path }, 'CSRF token missing');
                res.statusCode = 403;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    error: 'CSRF token missing',
                    code: 'CSRF_MISSING'
                }));
                return;
            }
            if (!this.validateToken(token, secret)) {
                logger.warn({ method, path }, 'CSRF token invalid');
                res.statusCode = 403;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    error: 'CSRF token invalid',
                    code: 'CSRF_INVALID'
                }));
                return;
            }
            next();
        };
    }
    /**
     * Set token cookie on response
     */
    setTokenCookie(res, secret) {
        const parts = [
            `${this.config.cookieName}=${secret}`,
            'Path=/',
            'HttpOnly',
            `SameSite=${this.config.sameSite}`
        ];
        if (this.config.secureCookie) {
            parts.push('Secure');
        }
        const existing = res.getHeader('Set-Cookie');
        const cookies = existing
            ? Array.isArray(existing)
                ? existing
                : [existing.toString()]
            : [];
        cookies.push(parts.join('; '));
        res.setHeader('Set-Cookie', cookies);
    }
    /**
     * Get secret from cookie
     */
    getSecretFromCookie(req) {
        const cookies = req.headers.cookie;
        if (!cookies)
            return null;
        const prefix = `${this.config.cookieName}=`;
        const cookie = cookies.split(';')
            .map(c => c.trim())
            .find(c => c.startsWith(prefix));
        if (!cookie)
            return null;
        return cookie.slice(prefix.length);
    }
    /**
     * Clean up expired tokens
     */
    cleanupExpiredTokens() {
        const now = Date.now();
        let removed = 0;
        for (const [token, data] of this.tokens) {
            if (now - data.createdAt > this.config.tokenValidityMs) {
                this.tokens.delete(token);
                removed++;
            }
        }
        if (removed > 0) {
            logger.debug({ removed }, 'cleaned up expired CSRF tokens');
        }
    }
    /**
     * Get token count
     */
    getTokenCount() {
        return this.tokens.size;
    }
    /**
     * Shutdown
     */
    shutdown() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.tokens.clear();
    }
}
// Singleton instance
let csrfInstance = null;
/**
 * Get the global CSRF protection instance
 */
export function getCsrfProtection(config) {
    if (!csrfInstance) {
        csrfInstance = new CsrfProtection(config);
    }
    return csrfInstance;
}
/**
 * Reset the global CSRF instance
 */
export function resetCsrfProtection() {
    if (csrfInstance) {
        csrfInstance.shutdown();
    }
    csrfInstance = null;
}
/**
 * Generate HTML meta tag with CSRF token for templates
 */
export function getCsrfMetaTag(token) {
    return `<meta name="csrf-token" content="${token}">`;
}
/**
 * Generate hidden input field with CSRF token for forms
 */
export function getCsrfInputField(token, fieldName = '_csrf') {
    return `<input type="hidden" name="${fieldName}" value="${token}">`;
}
/**
 * JavaScript snippet to include CSRF token in fetch requests
 */
export const CSRF_FETCH_SCRIPT = `
// CSRF token handling
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

// Override fetch to include CSRF token
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    options.headers = options.headers || {};
    options.headers['X-CSRF-Token'] = csrfToken;
  }
  return originalFetch(url, options);
};
`;
//# sourceMappingURL=csrf.js.map