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
// MCP server reference for sendLoggingMessage
let mcpServer = null;
// Rate limiting for MCP messages (don't spam Claude Code terminal)
let lastMcpMessageTime = 0;
const MCP_MIN_INTERVAL_MS = 500; // Max 2 messages per second
// ANSI escape codes
const ANSI = {
    CLEAR_LINE: '\x1b[2K\r',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    RED: '\x1b[31m',
    CYAN: '\x1b[36m',
    DIM: '\x1b[2m',
    RESET: '\x1b[0m',
    BOLD: '\x1b[1m',
};
// Braille spinner frames (smooth 10-frame animation)
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
// Status icons
const ICONS = {
    SUCCESS: '✓',
    ERROR: '✗',
    WARNING: '⚠',
    INFO: 'ℹ',
    SPINNER: SPINNER_FRAMES[0],
};
class ProgressReporter {
    prefix;
    minUpdateIntervalMs;
    enableSpinner;
    enableColors;
    clearLine;
    lastUpdateTime = 0;
    spinnerIndex = 0;
    spinnerInterval = null;
    currentMessage = '';
    isTTY;
    constructor(options = {}) {
        this.isTTY = process.stderr.isTTY ?? false;
        this.prefix = options.prefix ?? '[SPECMEM]';
        this.minUpdateIntervalMs = options.minUpdateIntervalMs ?? 250;
        this.enableSpinner = options.enableSpinner ?? true;
        this.enableColors = options.enableColors ?? this.isTTY;
        this.clearLine = options.clearLine ?? this.isTTY;
    }
    /**
     * Report a progress event
     * Rate-limited to prevent spam
     */
    report(event) {
        const now = Date.now();
        // Rate limit progress updates (but always show start/complete/error)
        if (event.phase === 'progress' && now - this.lastUpdateTime < this.minUpdateIntervalMs) {
            return;
        }
        this.lastUpdateTime = now;
        const line = this.formatEvent(event);
        this.writeLine(line, event.phase);
        // Stop spinner on terminal phases
        if (event.phase === 'complete' || event.phase === 'error') {
            this.stopSpinner();
        }
    }
    /**
     * Start a spinner animation for long-running operations
     */
    startSpinner(message) {
        if (!this.enableSpinner || !this.isTTY)
            return;
        this.stopSpinner(); // Clear any existing
        this.currentMessage = message;
        this.spinnerIndex = 0;
        this.spinnerInterval = setInterval(() => {
            this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
            const frame = SPINNER_FRAMES[this.spinnerIndex];
            const line = `${this.prefix} ${this.color(frame, 'cyan')} ${this.currentMessage}`;
            process.stderr.write(ANSI.CLEAR_LINE + line);
        }, 80);
    }
    /**
     * Stop the spinner animation
     */
    stopSpinner() {
        if (this.spinnerInterval) {
            clearInterval(this.spinnerInterval);
            this.spinnerInterval = null;
            if (this.isTTY) {
                process.stderr.write(ANSI.CLEAR_LINE);
            }
        }
    }
    /**
     * Format a progress event into a display line
     */
    formatEvent(event) {
        const { operation, phase, current, total, message, percent, durationMs, attempt, maxAttempts } = event;
        // Build the status icon
        let icon;
        let iconColor = 'cyan';
        switch (phase) {
            case 'start':
                icon = SPINNER_FRAMES[this.spinnerIndex];
                iconColor = 'cyan';
                break;
            case 'progress':
                icon = SPINNER_FRAMES[this.spinnerIndex];
                this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
                iconColor = 'cyan';
                break;
            case 'retry':
                icon = ICONS.WARNING;
                iconColor = 'yellow';
                break;
            case 'complete':
                icon = ICONS.SUCCESS;
                iconColor = 'green';
                break;
            case 'error':
                icon = ICONS.ERROR;
                iconColor = 'red';
                break;
            case 'info':
            default:
                icon = ICONS.INFO;
                iconColor = 'cyan';
                break;
        }
        // Build the main message
        let mainMsg = message ?? this.defaultMessage(operation, phase);
        // Add retry info
        if (phase === 'retry' && attempt !== undefined) {
            const max = maxAttempts ?? '?';
            mainMsg += ` ${this.dim(`(retry ${attempt}/${max})`)}`;
        }
        // Add progress stats
        let stats = '';
        if (current !== undefined && total !== undefined) {
            const pct = Math.round((current / total) * 100);
            stats = ` ${this.dim(`(${current}/${total}, ${pct}%)`)}`;
        }
        else if (percent !== undefined) {
            stats = ` ${this.dim(`(${Math.round(percent)}%)`)}`;
        }
        // Add duration for complete/error
        let duration = '';
        if ((phase === 'complete' || phase === 'error') && durationMs !== undefined) {
            duration = ` ${this.dim(`(${this.formatDuration(durationMs)})`)}`;
        }
        return `${this.prefix} ${this.color(icon, iconColor)} ${mainMsg}${stats}${duration}`;
    }
    /**
     * Write a line - uses MCP sendLoggingMessage if available, else stderr
     */
    writeLine(line, phase) {
        // Strip ANSI codes for MCP logging (Claude Code handles formatting)
        const plainLine = line.replace(/\x1b\[[0-9;]*m/g, '');
        // Try MCP sendLoggingMessage first (visible in Claude Code terminal!)
        if (mcpServer) {
            const now = Date.now();
            // Rate limit: skip 'start' phase if too frequent, always show complete/error/retry
            if (phase === 'start' && now - lastMcpMessageTime < MCP_MIN_INTERVAL_MS) {
                return; // Skip spammy start messages
            }
            // Only show complete for slow operations (>500ms)
            if (phase === 'complete') {
                // Skip fast tool completions to reduce noise
                return;
            }
            lastMcpMessageTime = now;
            // Map phase to MCP log level (all at 'info' or higher to be visible)
            const level = phase === 'error' ? 'error' :
                phase === 'retry' ? 'warning' : 'info';
            // Fire and forget - don't await in sync context
            mcpServer.sendLoggingMessage({
                level: level,
                logger: 'specmem-progress',
                data: plainLine,
            }).catch(() => {
                // Fallback to stderr if MCP fails
                process.stderr.write(line + '\n');
            });
            return;
        }
        // Fallback to stderr (bootstrap, pre-MCP)
        if (this.clearLine && phase === 'progress') {
            // Overwrite current line for progress updates
            process.stderr.write(ANSI.CLEAR_LINE + line);
        }
        else {
            // New line for start/complete/error/retry
            process.stderr.write(line + '\n');
        }
    }
    /**
     * Apply ANSI color if enabled
     */
    color(text, color) {
        if (!this.enableColors)
            return text;
        const codes = {
            green: ANSI.GREEN,
            yellow: ANSI.YELLOW,
            red: ANSI.RED,
            cyan: ANSI.CYAN,
        };
        return `${codes[color]}${text}${ANSI.RESET}`;
    }
    /**
     * Apply dim styling
     */
    dim(text) {
        if (!this.enableColors)
            return text;
        return `${ANSI.DIM}${text}${ANSI.RESET}`;
    }
    /**
     * Format milliseconds to human-readable duration
     */
    formatDuration(ms) {
        if (ms < 1000)
            return `${ms}ms`;
        if (ms < 60000)
            return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    }
    /**
     * Generate default message for operation/phase
     */
    defaultMessage(operation, phase) {
        const opName = operation.charAt(0).toUpperCase() + operation.slice(1);
        switch (phase) {
            case 'start':
                return `${opName} starting...`;
            case 'progress':
                return `${opName} in progress...`;
            case 'retry':
                return `${opName} retrying...`;
            case 'complete':
                return `${opName} complete`;
            case 'error':
                return `${opName} failed`;
            case 'info':
            default:
                return opName;
        }
    }
    /**
     * Cleanup resources
     */
    destroy() {
        this.stopSpinner();
    }
}
// Singleton instance
let reporterInstance = null;
/**
 * Get the global ProgressReporter instance
 */
export function getProgressReporter(options) {
    if (!reporterInstance) {
        reporterInstance = new ProgressReporter(options);
    }
    return reporterInstance;
}
/**
 * Reset the global ProgressReporter (for testing)
 */
export function resetProgressReporter() {
    if (reporterInstance) {
        reporterInstance.destroy();
        reporterInstance = null;
    }
}
/**
 * Convenience function: report a progress event
 */
export function reportProgress(event) {
    getProgressReporter().report(event);
}
/**
 * Convenience: report start of operation
 */
export function reportStart(operation, message) {
    reportProgress({ operation, phase: 'start', message });
}
/**
 * Convenience: report progress update
 */
export function reportUpdate(operation, current, total, message) {
    reportProgress({ operation, phase: 'progress', current, total, message });
}
/**
 * Convenience: report operation complete
 */
export function reportComplete(operation, durationMs, message) {
    reportProgress({ operation, phase: 'complete', durationMs, message });
}
/**
 * Convenience: report error
 */
export function reportError(operation, message) {
    reportProgress({ operation, phase: 'error', message });
}
/**
 * Convenience: report retry attempt
 */
export function reportRetry(operation, attempt, maxAttempts) {
    reportProgress({ operation, phase: 'retry', attempt, maxAttempts });
}
/**
 * Set the MCP server for sendLoggingMessage output
 * Call this once the MCP server is initialized to enable visible progress in Claude Code
 */
export function setMcpServer(server) {
    mcpServer = server;
}
/**
 * Clear the MCP server reference (for cleanup/shutdown)
 */
export function clearMcpServer() {
    mcpServer = null;
}
/**
 * Check if MCP server is configured
 */
export function hasMcpServer() {
    return mcpServer !== null;
}
// Export the class for direct instantiation if needed
export { ProgressReporter };
//# sourceMappingURL=progressReporter.js.map