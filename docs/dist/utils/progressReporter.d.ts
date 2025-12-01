/**
 * progressReporter.ts - Unified Progress/Loading Bar System
 *
 * MCP-safe progress reporting with TWO output modes:
 * 1. stderr (fallback) - for bootstrap/pre-MCP
 * 2. MCP sendLoggingMessage - for visible output in Claude Code terminal
 *
 * Features:
 * - ANSI spinner animation for in-progress states
 * - Rate-limited output (max 4 updates/second to avoid spam)
 * - Clear phase indicators: start, progress, retry, complete, error
 * - Item counts and percentages for batch operations
 * - MCP protocol integration for VISIBLE progress in Claude Code
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
export type ProgressPhase = 'start' | 'progress' | 'retry' | 'complete' | 'error' | 'info';
export interface ProgressEvent {
    /** Operation category: embedding, batch, startup, tool, codebase */
    operation: string;
    /** Current phase of the operation */
    phase: ProgressPhase;
    /** Current item number (for batch operations) */
    current?: number;
    /** Total items (for batch operations) */
    total?: number;
    /** Human-readable message */
    message?: string;
    /** Percentage complete (0-100) */
    percent?: number;
    /** Duration in milliseconds */
    durationMs?: number;
    /** Retry attempt number */
    attempt?: number;
    /** Max retry attempts */
    maxAttempts?: number;
    /** Additional context data */
    context?: Record<string, unknown>;
}
export interface ProgressReporterOptions {
    /** Prefix for all output (default: [SPECMEM]) */
    prefix?: string;
    /** Minimum ms between updates (default: 250ms = 4/sec) */
    minUpdateIntervalMs?: number;
    /** Enable spinner animation (default: true) */
    enableSpinner?: boolean;
    /** Enable colors (default: true, auto-detected) */
    enableColors?: boolean;
    /** Clear previous line on update (default: true for TTY) */
    clearLine?: boolean;
}
declare class ProgressReporter {
    private prefix;
    private minUpdateIntervalMs;
    private enableSpinner;
    private enableColors;
    private clearLine;
    private lastUpdateTime;
    private spinnerIndex;
    private spinnerInterval;
    private currentMessage;
    private isTTY;
    constructor(options?: ProgressReporterOptions);
    /**
     * Report a progress event
     * Rate-limited to prevent spam
     */
    report(event: ProgressEvent): void;
    /**
     * Start a spinner animation for long-running operations
     */
    startSpinner(message: string): void;
    /**
     * Stop the spinner animation
     */
    stopSpinner(): void;
    /**
     * Format a progress event into a display line
     */
    private formatEvent;
    /**
     * Write a line - uses MCP sendLoggingMessage if available, else stderr
     */
    private writeLine;
    /**
     * Apply ANSI color if enabled
     */
    private color;
    /**
     * Apply dim styling
     */
    private dim;
    /**
     * Format milliseconds to human-readable duration
     */
    private formatDuration;
    /**
     * Generate default message for operation/phase
     */
    private defaultMessage;
    /**
     * Cleanup resources
     */
    destroy(): void;
}
/**
 * Get the global ProgressReporter instance
 */
export declare function getProgressReporter(options?: ProgressReporterOptions): ProgressReporter;
/**
 * Reset the global ProgressReporter (for testing)
 */
export declare function resetProgressReporter(): void;
/**
 * Convenience function: report a progress event
 */
export declare function reportProgress(event: ProgressEvent): void;
/**
 * Convenience: report start of operation
 */
export declare function reportStart(operation: string, message?: string): void;
/**
 * Convenience: report progress update
 */
export declare function reportUpdate(operation: string, current: number, total: number, message?: string): void;
/**
 * Convenience: report operation complete
 */
export declare function reportComplete(operation: string, durationMs?: number, message?: string): void;
/**
 * Convenience: report error
 */
export declare function reportError(operation: string, message?: string): void;
/**
 * Convenience: report retry attempt
 */
export declare function reportRetry(operation: string, attempt: number, maxAttempts?: number): void;
/**
 * Set the MCP server for sendLoggingMessage output
 * Call this once the MCP server is initialized to enable visible progress in Claude Code
 */
export declare function setMcpServer(server: Server): void;
/**
 * Clear the MCP server reference (for cleanup/shutdown)
 */
export declare function clearMcpServer(): void;
/**
 * Check if MCP server is configured
 */
export declare function hasMcpServer(): boolean;
export { ProgressReporter };
//# sourceMappingURL=progressReporter.d.ts.map