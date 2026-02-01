/**
 * ptyStreamer.ts - PTY Output Streaming System
 *
 * Captures raw terminal output from GNU Screen sessions and streams it
 * via WebSocket to the dashboard. Preserves ANSI escape sequences for colors,
 * formatting, cursor positioning, etc.
 *
 * STREAMING APPROACHES (in order of preference):
 *
 * 1. SCREEN PIPE MODE (Best - Direct PTY streaming)
 *    - Uses `screen -x session -p 0 -X hardcopy -h /dev/stdout` for snapshots
 *    - Uses hidden screen attachment for live streaming
 *    - Full ANSI support, real-time, no file I/O overhead
 *
 * 2. LOG FILE STREAMING (Fallback - Current approach)
 *    - Uses `tail -f` on screen log files
 *    - Requires screen logging to be enabled (-L flag)
 *    - Works well but depends on log file existence
 *
 * 3. HARDCOPY POLLING (Emergency fallback)
 *    - Periodically runs `screen -X hardcopy` to capture screen state
 *    - No logging required, but higher latency
 *
 * INPUT METHODS:
 * - screen -S session -X stuff "text\r" (sends text + Enter)
 * - screen -S session -X stuff "text"   (sends text only)
 * - Supports full keyboard input including special keys
 */
import { EventEmitter } from 'events';
export interface ClaudeInstance {
    pid: number;
    tty: string;
    screenName: string;
    logFile: string;
    attached: boolean;
    multiuser: boolean;
    windowCount: number;
}
export type StreamingMode = 'screen-pipe' | 'log-tail' | 'hardcopy-poll' | 'none';
export interface StreamingStatus {
    mode: StreamingMode;
    sessionName: string | null;
    isActive: boolean;
    startedAt: Date | null;
    bytesStreamed: number;
}
/**
 * PTY Streamer - Streams output from GNU Screen sessions
 *
 * Emits:
 * - 'data' (Buffer): Raw terminal output data
 * - 'error' (Error): Streaming errors
 * - 'end': Stream ended
 * - 'mode-change' (StreamingMode): Streaming mode changed
 */
export declare class PTYStreamer extends EventEmitter {
    private currentMode;
    private currentSession;
    private streamProcess;
    private pollInterval;
    private lastHardcopy;
    private bytesStreamed;
    private startedAt;
    /**
     * Find all screen sessions on the system
     */
    findAllInstances(): ClaudeInstance[];
    /**
     * Get the newest (highest PID) instance
     */
    getNewestInstance(): ClaudeInstance | null;
    /**
     * Get instance by session name or PID
     */
    getInstance(identifier: string | number): ClaudeInstance | null;
    /**
     * Start streaming from a screen session
     * Automatically selects the best available streaming mode
     */
    startStreaming(sessionOrLog?: string): boolean;
    /**
     * Mode 1: Screen Pipe Mode - Direct PTY streaming via screen
     *
     * Uses a hidden screen attachment to stream output directly.
     * This is the most efficient method as it:
     * - Reads directly from the PTY
     * - Preserves all ANSI codes
     * - Has minimal latency
     */
    private startScreenPipeMode;
    /**
     * Mode 2: Log Tail Mode - Stream from screen log file
     *
     * Uses tail -f to stream the screen session log.
     * Requires screen logging to be enabled.
     */
    private startLogTailMode;
    /**
     * Mode 3: Hardcopy Poll Mode - Periodic screen snapshots
     *
     * Uses screen -X hardcopy to capture screen state periodically.
     * Does not require logging, works with any screen session.
     * Higher latency but more compatible.
     */
    private startHardcopyPollMode;
    /**
     * Capture a hardcopy and emit changes - NON-BLOCKING
     */
    private captureHardcopy;
    /**
     * Find new content between old and new hardcopy
     */
    private findNewContent;
    /**
     * Stop all streaming
     */
    stopStreaming(): void;
    /**
     * Reset internal state
     */
    private resetState;
    /**
     * Send input to a screen session
     *
     * @param sessionName - Screen session name (e.g., "353784.pts-6.srv815833")
     * @param data - Text to send
     * @param addNewline - Whether to add a carriage return (default: false)
     */
    writeToTerminal(sessionName: string, data: string, addNewline?: boolean): boolean;
    /**
     * Send special key sequences to screen
     */
    sendSpecialKey(sessionName: string, key: string): boolean;
    /**
     * Enable multiuser mode on a session
     */
    enableMultiuser(sessionName: string): boolean;
    /**
     * Get current screen content (hardcopy)
     */
    getScreenContent(sessionName: string, includeScrollback?: boolean): string | null;
    /**
     * Enable logging for a screen session
     */
    enableLogging(sessionName: string, logFile: string): boolean;
    /**
     * Check if currently streaming
     */
    isActive(): boolean;
    /**
     * Get detailed streaming status
     */
    getStatus(): StreamingStatus;
    /**
     * Get the current streaming mode
     */
    getMode(): StreamingMode;
    /**
     * Get the currently streaming instance
     */
    getCurrentStreamingInstance(): ClaudeInstance | null;
}
export declare function getPtyStreamer(projectPath?: string): PTYStreamer;
/**
 * Stop streaming and reset the PTY streamer for current/specified project to prevent memory leaks
 */
export declare function shutdownPtyStreamer(projectPath?: string): void;
/**
 * Stop streaming and reset all PTY streamers across all projects
 */
export declare function shutdownAllPtyStreamers(): void;
export declare const ptyStreamer: PTYStreamer;
//# sourceMappingURL=ptyStreamer.d.ts.map