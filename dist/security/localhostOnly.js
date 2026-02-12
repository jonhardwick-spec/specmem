// nah bruh only localhost allowed no cap
// skids trying to connect remotely getting BLOCKED fr fr
// this security layer straight up BUSSIN
import { logger } from '../utils/logger.js';
/**
 * enforceLocalhostOnly - validates that connections only come from localhost
 *
 * security considerations (deep reasoning):
 * - IPv4 loopback: 127.0.0.0/8 subnet (but we only allow 127.0.0.1)
 * - IPv6 loopback: ::1 (full form and compressed)
 * - localhost resolution: DNS can be spoofed, so we check actual IP
 * - case sensitivity: hostnames are case-insensitive by RFC
 * - attack vectors to prevent:
 *   - DNS rebinding attacks (check IP not hostname)
 *   - IPv6 address tricks (::ffff:127.0.0.1 IPv4-mapped addresses)
 *   - localhost variations (localdomain, localhost.localdomain, etc.)
 *   - hostname header manipulation
 *   - proxy bypass attempts
 */
export function enforceLocalhostOnly(host) {
    // normalize input - lowercase and trim
    const normalizedHost = host.toLowerCase().trim();
    // allowed hosts - strict whitelist approach
    const allowedHosts = [
        'localhost',
        '127.0.0.1',
        '::1',
        '[::1]', // IPv6 with brackets (common in HTTP headers)
    ];
    // check if host is in allowed list
    if (!allowedHosts.includes(normalizedHost)) {
        logger.warn({
            rejectedHost: normalizedHost,
            reason: 'remote connection attempt blocked'
        }, 'SECURITY: Remote connection blocked - only localhost allowed fr');
        // skids trying to connect remotely getting BLOCKED
        throw new Error('Remote connections blocked fr - localhost only no cap');
    }
    logger.debug({ host: normalizedHost }, 'localhost connection verified - we good');
    return true;
}
/**
 * validateConnectionOrigin - validates connection origin from request-like objects
 *
 * checks both Host header and actual socket address
 * double verification prevents header spoofing
 */
export function validateConnectionOrigin(headers, remoteAddress) {
    // check Host header if present
    const hostHeader = headers['host'] || headers['Host'];
    if (hostHeader) {
        // remove port if present (localhost:3000 -> localhost)
        const hostWithoutPort = hostHeader.split(':')[0] ?? hostHeader;
        enforceLocalhostOnly(hostWithoutPort);
    }
    // double check the actual remote address if available
    if (remoteAddress) {
        // extract IP from possible formats like "::ffff:127.0.0.1" (IPv4-mapped IPv6)
        const cleanAddress = remoteAddress.replace('::ffff:', '');
        enforceLocalhostOnly(cleanAddress);
    }
    return true;
}
/**
 * isLocalhostAddress - non-throwing version that returns boolean
 * useful for conditional checks without try-catch
 */
export function isLocalhostAddress(host) {
    try {
        return enforceLocalhostOnly(host);
    }
    catch {
        return false;
    }
}
/**
 * getSecurityHeaders - returns security headers for localhost-only server
 *
 * these headers prevent various attacks even though we're localhost-only
 * defense in depth approach - multiple layers of security
 */
export function getSecurityHeaders() {
    return {
        // prevent iframe embedding (clickjacking protection)
        'X-Frame-Options': 'DENY',
        // prevent MIME sniffing
        'X-Content-Type-Options': 'nosniff',
        // enable XSS protection (older browsers)
        'X-XSS-Protection': '1; mode=block',
        // strict transport security (even for localhost, good practice)
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        // content security policy - only allow localhost resources
        'Content-Security-Policy': "default-src 'self' localhost 127.0.0.1; script-src 'self' localhost 127.0.0.1; style-src 'self' localhost 127.0.0.1 'unsafe-inline'",
        // referrer policy - don't leak info
        'Referrer-Policy': 'no-referrer',
        // permissions policy - disable features we don't need
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
    };
}
// Deprecated typo alias removed in v2.0.0 - use enforceLocalhostOnly instead
//# sourceMappingURL=localhostOnly.js.map