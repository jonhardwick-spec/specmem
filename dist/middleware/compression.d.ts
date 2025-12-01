/**
 * compression.ts - Response Compression Middleware
 *
 * yo this compresses responses for faster delivery
 * gzip for text, reduced bundle sizes
 * makes everything SNAPPY fr fr
 *
 * Issue #24 fix - add gzip compression middleware
 */
import { IncomingMessage, ServerResponse } from 'http';
/**
 * Compression configuration
 */
export interface CompressionConfig {
    /** Minimum size to compress (bytes) */
    threshold: number;
    /** Compression level (1-9) */
    level: number;
    /** MIME types to compress */
    compressibleTypes: RegExp;
    /** Paths to skip compression */
    skipPaths: RegExp[];
}
/**
 * Compression middleware
 */
export declare function compressionMiddleware(config?: Partial<CompressionConfig>): (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
/**
 * Minify HTML content
 */
export declare function minifyHtml(html: string): string;
/**
 * Minify inline CSS
 */
export declare function minifyCss(css: string): string;
/**
 * Minify inline JavaScript (basic)
 */
export declare function minifyJs(js: string): string;
/**
 * Process HTML and minify inline CSS/JS
 */
export declare function processHtml(html: string): string;
/**
 * Pre-compress static files
 */
export declare function preCompress(content: Buffer | string): Promise<Buffer>;
//# sourceMappingURL=compression.d.ts.map