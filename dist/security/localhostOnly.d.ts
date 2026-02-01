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
export declare function enforceLocalhostOnly(host: string): boolean;
/**
 * validateConnectionOrigin - validates connection origin from request-like objects
 *
 * checks both Host header and actual socket address
 * double verification prevents header spoofing
 */
export declare function validateConnectionOrigin(headers: Record<string, string | undefined>, remoteAddress?: string): boolean;
/**
 * isLocalhostAddress - non-throwing version that returns boolean
 * useful for conditional checks without try-catch
 */
export declare function isLocalhostAddress(host: string): boolean;
/**
 * getSecurityHeaders - returns security headers for localhost-only server
 *
 * these headers prevent various attacks even though we're localhost-only
 * defense in depth approach - multiple layers of security
 */
export declare function getSecurityHeaders(): Record<string, string>;
//# sourceMappingURL=localhostOnly.d.ts.map