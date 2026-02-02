/**
 * compression.ts - Response Compression Middleware
 *
 * yo this compresses responses for faster delivery
 * gzip for text, reduced bundle sizes
 * makes everything SNAPPY fr fr
 *
 * Issue #24 fix - add gzip compression middleware
 */
import zlib from 'zlib';
import { logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    threshold: 1024, // 1KB
    level: 6,
    compressibleTypes: /^(text\/|application\/json|application\/javascript|application\/xml|image\/svg\+xml)/,
    skipPaths: [
        /\.(png|jpg|jpeg|gif|ico|woff|woff2|webp|avif)$/i
    ]
};
/**
 * Check if request accepts gzip encoding
 */
function acceptsGzip(req) {
    const acceptEncoding = req.headers['accept-encoding'];
    if (!acceptEncoding)
        return false;
    return acceptEncoding.includes('gzip');
}
/**
 * Check if content type is compressible
 */
function isCompressible(contentType, config) {
    if (!contentType)
        return false;
    return config.compressibleTypes.test(contentType);
}
/**
 * Check if path should skip compression
 */
function shouldSkip(path, config) {
    return config.skipPaths.some(pattern => pattern.test(path));
}
/**
 * Compression middleware
 */
export function compressionMiddleware(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    return (req, res, next) => {
        const url = req.url || '/';
        // Skip if path should not be compressed
        if (shouldSkip(url, cfg)) {
            return next();
        }
        // Skip if client doesn't accept gzip
        if (!acceptsGzip(req)) {
            return next();
        }
        // Store original methods
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        let chunks = [];
        let ended = false;
        let compressed = false;
        // Override write
        res.write = function (chunk, encodingOrCallback, callback) {
            if (ended)
                return false;
            // Handle different argument combinations
            let encoding = 'utf8';
            let cb;
            if (typeof encodingOrCallback === 'function') {
                cb = encodingOrCallback;
            }
            else if (encodingOrCallback) {
                encoding = encodingOrCallback;
                cb = callback;
            }
            const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk, encoding);
            chunks.push(buffer);
            cb?.(null);
            return true;
        };
        // Override end
        res.end = function (chunk, encodingOrCallback, callback) {
            if (ended)
                return res;
            ended = true;
            // Handle different argument combinations
            let encoding = 'utf8';
            let cb;
            if (typeof chunk === 'function') {
                cb = chunk;
                chunk = undefined;
            }
            else if (typeof encodingOrCallback === 'function') {
                cb = encodingOrCallback;
            }
            else if (encodingOrCallback) {
                encoding = encodingOrCallback;
                cb = callback;
            }
            // Add final chunk if present
            if (chunk) {
                const buffer = Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk, encoding);
                chunks.push(buffer);
            }
            // Combine all chunks
            const body = Buffer.concat(chunks);
            // Check if we should compress
            const contentType = res.getHeader('content-type');
            const shouldCompress = body.length >= cfg.threshold &&
                isCompressible(contentType, cfg) &&
                !res.getHeader('content-encoding');
            if (shouldCompress) {
                // Compress the body
                zlib.gzip(body, { level: cfg.level }, (err, compressed) => {
                    if (err) {
                        logger.warn({ error: err }, 'compression failed, sending uncompressed');
                        res.setHeader('Content-Length', body.length);
                        originalWrite(body);
                        originalEnd(cb);
                        return;
                    }
                    // Set compression headers
                    res.setHeader('Content-Encoding', 'gzip');
                    res.setHeader('Content-Length', compressed.length);
                    res.setHeader('Vary', 'Accept-Encoding');
                    originalWrite(compressed);
                    originalEnd(cb);
                    logger.debug({
                        path: url,
                        originalSize: body.length,
                        compressedSize: compressed.length,
                        ratio: ((1 - compressed.length / body.length) * 100).toFixed(1) + '%'
                    }, 'response compressed');
                });
            }
            else {
                // Send uncompressed
                if (body.length > 0) {
                    res.setHeader('Content-Length', body.length);
                }
                originalWrite(body);
                originalEnd(cb);
            }
            return res;
        };
        next();
    };
}
/**
 * Minify HTML content
 */
export function minifyHtml(html) {
    return html
        // Remove HTML comments (but keep IE conditionals)
        .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
        // Collapse whitespace between tags
        .replace(/>\s+</g, '><')
        // Remove leading/trailing whitespace per line
        .replace(/^\s+|\s+$/gm, '')
        // Collapse multiple spaces into one
        .replace(/\s{2,}/g, ' ')
        // Remove newlines
        .replace(/\n/g, '')
        // Trim
        .trim();
}
/**
 * Minify inline CSS
 */
export function minifyCss(css) {
    return css
        // Remove comments
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Remove whitespace around special characters
        .replace(/\s*([{}:;,>+~])\s*/g, '$1')
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        // Remove trailing semicolons before closing braces
        .replace(/;}/g, '}')
        // Trim
        .trim();
}
/**
 * Minify inline JavaScript (basic)
 */
export function minifyJs(js) {
    return js
        // Remove single-line comments (careful with URLs)
        .replace(/(?<!:)\/\/[^\n]*/g, '')
        // Remove multi-line comments
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Collapse whitespace (but preserve strings)
        .replace(/\s+/g, ' ')
        // Remove whitespace around operators
        .replace(/\s*([{};,=+\-*/<>!&|?:])\s*/g, '$1')
        // Restore space after keywords
        .replace(/(function|return|var|let|const|if|else|for|while|switch|case|break|continue|new|typeof|instanceof|in|of)([{(])/g, '$1 $2')
        // Trim
        .trim();
}
/**
 * Process HTML and minify inline CSS/JS
 */
export function processHtml(html) {
    // Minify inline styles
    html = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, css) => {
        return match.replace(css, minifyCss(css));
    });
    // Minify inline scripts
    html = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (match, js) => {
        // Skip external scripts or non-JS scripts
        if (match.includes('src=') || match.includes('type=') && !match.includes('javascript')) {
            return match;
        }
        return match.replace(js, minifyJs(js));
    });
    // Minify the HTML itself
    return minifyHtml(html);
}
/**
 * Pre-compress static files
 */
export async function preCompress(content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return new Promise((resolve, reject) => {
        zlib.gzip(buffer, { level: 9 }, (err, result) => {
            if (err)
                reject(err);
            else
                resolve(result);
        });
    });
}
//# sourceMappingURL=compression.js.map