/**
 * terminalStream.ts - WebSocket Server for Terminal Output Streaming
 *
 * Watches the Claude Code output log file and broadcasts changes
 * to connected WebSocket clients in real-time.
 *
 * Phase 5 Implementation - Live Terminal Output Streaming
 */
import { WebSocket, WebSocketServer } from 'ws';
export interface TerminalMessage {
    type: 'terminal_output' | 'terminal_history' | 'terminal_status' | 'terminal_error';
    timestamp: string;
    line?: string;
    lines?: string[];
    status?: string;
    error?: string;
}
export interface TerminalStreamConfig {
    logFilePath?: string;
    maxHistoryLines?: number;
    broadcastDebounceMs?: number;
}
export declare class TerminalStreamManager {
    private logFilePath;
    private maxHistoryLines;
    private broadcastDebounceMs;
    private connectedClients;
    private lastPosition;
    private fileWatcher;
    private checkInterval;
    private broadcastTimeout;
    private pendingLines;
    private isRunning;
    private isRestartingWatcher;
    private pendingRestartTimeout;
    constructor(config?: TerminalStreamConfig);
    /**
     * Start the terminal stream manager
     */
    start(): void;
    /**
     * Stop the terminal stream manager
     */
    stop(): void;
    /**
     * Add a WebSocket client to the broadcast list
     */
    addClient(ws: WebSocket): void;
    /**
     * Handle incoming client messages
     */
    private handleClientMessage;
    /**
     * Ensure the log file exists
     */
    private ensureLogFile;
    /**
     * Start watching the log file for changes
     */
    private startFileWatching;
    /**
     * Restart file watching (e.g., after file rotation)
     * MED-33 FIX: Added debounce and lock to prevent race conditions from rapid restarts
     */
    private restartFileWatching;
    /**
     * Read new content from the log file
     */
    private readNewContent;
    /**
     * Schedule a debounced broadcast
     */
    private scheduleBroadcast;
    /**
     * Sanitize a line for safe display
     */
    private sanitizeLine;
    /**
     * Broadcast a message to all connected clients
     */
    private broadcast;
    /**
     * Send history to a specific client
     */
    private sendHistory;
    /**
     * Send current status to a client
     */
    private sendStatus;
    /**
     * Get the last N lines from the log file
     */
    private getLastNLines;
    /**
     * Clear the log file
     */
    clearLog(): void;
    /**
     * Get the number of connected clients
     */
    getClientCount(): number;
    /**
     * Get the log file path
     */
    getLogFilePath(): string;
}
/**
 * Get or create the terminal stream manager for current/specified project
 */
export declare function getTerminalStreamManager(config?: TerminalStreamConfig, projectPath?: string): TerminalStreamManager;
/**
 * Reset the terminal stream manager for current/specified project (for testing)
 */
export declare function resetTerminalStreamManager(projectPath?: string): void;
/**
 * Reset all terminal stream managers across all projects
 */
export declare function resetAllTerminalStreamManagers(): void;
/**
 * Integration function for WebSocket server
 */
export declare function setupTerminalWebSocket(wss: WebSocketServer, path?: string): TerminalStreamManager;
declare const _default: {
    TerminalStreamManager: typeof TerminalStreamManager;
    getTerminalStreamManager: typeof getTerminalStreamManager;
    resetTerminalStreamManager: typeof resetTerminalStreamManager;
    setupTerminalWebSocket: typeof setupTerminalWebSocket;
};
export default _default;
//# sourceMappingURL=terminalStream.d.ts.map