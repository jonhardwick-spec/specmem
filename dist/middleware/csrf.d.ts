/**
 * csrf.ts - CSRF Protection Middleware for SpecMem Dashboard
 *
 * yo this prevents cross-site request forgery attacks
 * tokens for state-changing operations fr fr
 * keeps the dashboard SECURE
 *
 * Issue #37 fix - CSRF protection
 */
import { IncomingMessage, ServerResponse } from 'http';
/**
 * CSRF configuration
 */
export interface CsrfConfig {
    /** Token length in bytes */
    tokenLength: number;
    /** Cookie name for the secret */
    cookieName: string;
    /** Header name for the token */
    headerName: string;
    /** Form field name for the token */
    fieldName: string;
    /** Token validity in ms */
    tokenValidityMs: number;
    /** Secure cookie (HTTPS only) */
    secureCookie: boolean;
    /** SameSite cookie attribute */
    sameSite: 'strict' | 'lax' | 'none';
    /** Methods that require CSRF validation */
    protectedMethods: string[];
    /** Paths to skip CSRF validation */
    ignorePaths: RegExp[];
}
/**
 * CsrfProtection - prevents cross-site request forgery
 *
 * Features that KEEP US SAFE:
 * - Double submit cookie pattern
 * - Token validation
 * - Configurable protected methods
 * - Path exclusions
 */
export declare class CsrfProtection {
    private config;
    private tokens;
    private cleanupInterval;
    constructor(config?: Partial<CsrfConfig>);
    /**
     * Generate a new CSRF token
     */
    generateToken(): {
        token: string;
        secret: string;
    };
    /**
     * Create token from secret
     */
    private createToken;
    /**
     * Validate a CSRF token
     */
    validateToken(token: string, secret: string): boolean;
    /**
     * Verify token signature
     */
    private verifyTokenSignature;
    /**
     * Check if path should be protected
     */
    shouldProtect(method: string, path: string): boolean;
    /**
     * Express-style middleware
     */
    middleware(): (req: IncomingMessage & {
        body?: Record<string, unknown>;
    }, res: ServerResponse, next: () => void) => void;
    /**
     * Set token cookie on response
     */
    setTokenCookie(res: ServerResponse, secret: string): void;
    /**
     * Get secret from cookie
     */
    getSecretFromCookie(req: IncomingMessage): string | null;
    /**
     * Clean up expired tokens
     */
    private cleanupExpiredTokens;
    /**
     * Get token count
     */
    getTokenCount(): number;
    /**
     * Shutdown
     */
    shutdown(): void;
}
/**
 * Get the global CSRF protection instance
 */
export declare function getCsrfProtection(config?: Partial<CsrfConfig>): CsrfProtection;
/**
 * Reset the global CSRF instance
 */
export declare function resetCsrfProtection(): void;
/**
 * Generate HTML meta tag with CSRF token for templates
 */
export declare function getCsrfMetaTag(token: string): string;
/**
 * Generate hidden input field with CSRF token for forms
 */
export declare function getCsrfInputField(token: string, fieldName?: string): string;
/**
 * JavaScript snippet to include CSRF token in fetch requests
 */
export declare const CSRF_FETCH_SCRIPT = "\n// CSRF token handling\nconst csrfToken = document.querySelector('meta[name=\"csrf-token\"]')?.content;\n\n// Override fetch to include CSRF token\nconst originalFetch = window.fetch;\nwindow.fetch = function(url, options = {}) {\n  const method = (options.method || 'GET').toUpperCase();\n  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {\n    options.headers = options.headers || {};\n    options.headers['X-CSRF-Token'] = csrfToken;\n  }\n  return originalFetch(url, options);\n};\n";
//# sourceMappingURL=csrf.d.ts.map