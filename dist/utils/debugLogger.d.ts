/**
 * Debug Logger - Unprofessional Anticommentation Skill Debugging
 *
 * bruh this thing logs everything with STYLE fr fr
 * - 30-minute auto-clearing cuz we ain't hoarding logs like boomers
 * - category filtering via SPECMEM_DEBUG env var
 * - funny messages cuz debugging should be fun no cap
 *
 * Usage:
 *   SPECMEM_DEBUG=* (all categories)
 *   SPECMEM_DEBUG=database,mcp (specific categories)
 */
export type DebugLevel = 'debug' | 'info' | 'warn' | 'error' | 'yeet';
export type DebugCategory = 'memory' | 'database' | 'mcp' | 'dashboard' | 'skills' | 'codebase' | 'coordination' | 'embedding' | 'watcher' | 'socket' | 'search';
declare class DebugLogger {
    private logDir;
    private enabledCategories;
    private clearIntervalMs;
    private clearInterval;
    private currentLogFile;
    private isEnabled;
    constructor();
    private parseDebugEnv;
    private parseCategories;
    private ensureLogDir;
    private startClearInterval;
    private clearOldLogs;
    private getLogFilePath;
    private isEnabled4Category;
    private getFunnyMessage;
    private writeLog;
    /**
     * Main log function - call this fr fr
     */
    log(category: DebugCategory, level: DebugLevel, message: string, data?: Record<string, unknown>, valueForFunny?: string | number): void;
    /**
     * Convenience methods for different levels
     */
    debug(category: DebugCategory, message: string, data?: Record<string, unknown>): void;
    info(category: DebugCategory, message: string, data?: Record<string, unknown>, value?: string | number): void;
    warn(category: DebugCategory, message: string, data?: Record<string, unknown>): void;
    error(category: DebugCategory, message: string, data?: Record<string, unknown>): void;
    yeet(category: DebugCategory, message: string, data?: Record<string, unknown>): void;
    /**
     * Category-specific helpers for common operations
     */
    dbQuery(query: string, durationMs: number, success: boolean): void;
    memoryUsage(usagePercent: number, heapUsedMB: number): void;
    mcpRequest(tool: string, durationMs: number, success: boolean): void;
    fileIndexed(filePath: string, chunkCount: number): void;
    skillLoaded(skillName: string, success: boolean): void;
    /**
     * Socket connection logging - includes socket path for debugging
     */
    socketConnection(socketPath: string, state: 'connecting' | 'connected' | 'disconnected' | 'error', error?: Error): void;
    /**
     * Search operation logging with full context
     */
    searchOperation(query: string, phase: 'start' | 'embedding' | 'search' | 'complete' | 'error', data?: {
        durationMs?: number;
        resultCount?: number;
        error?: Error;
        socketPath?: string;
    }): void;
    /**
     * Embedding generation logging with socket info
     */
    embeddingGeneration(text: string, socketPath: string, phase: 'start' | 'complete' | 'timeout' | 'error', data?: {
        durationMs?: number;
        dimension?: number;
        error?: Error;
    }): void;
    /**
     * Stop the auto-clear interval (call on shutdown)
     */
    shutdown(): void;
    /**
     * Force clear all debug logs (for testing)
     */
    forceClear(): void;
    /**
     * Get debug status info
     */
    getStatus(): {
        enabled: boolean;
        categories: string[];
        logDir: string;
    };
}
export declare function getDebugLogger(): DebugLogger;
export declare function resetDebugLogger(): void;
export declare function debugLog(category: DebugCategory, level: DebugLevel, message: string, data?: Record<string, unknown>): void;
export declare const dLog: DebugLogger;
export {};
//# sourceMappingURL=debugLogger.d.ts.map