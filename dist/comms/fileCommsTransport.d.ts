/**
 * File-Based Communication Transport
 *
 * Provides a simple file-based fallback for team member communication
 * when MCP/database tools fail. Uses /tmp/specmem-${PROJECT_HASH}/comms/comms.txt
 *
 * Protocol format:
 *   TIMESTAMP|SENDER|RECIPIENT|PRIORITY|TYPE|MESSAGE
 *
 * Example:
 *   2026-01-03T01:15:30.123Z|tm-abc-001|all|high|status|Starting phase 1
 */
export interface FileMessage {
    timestamp: string;
    sender: string;
    recipient: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    type: 'status' | 'message' | 'heartbeat' | 'claim' | 'release' | 'broadcast';
    content: string;
}
export interface FileCommsState {
    lastReadAt: string;
    lastReadLine: number;
    memberId: string;
}
export declare class FileCommsTransport {
    private commsPath;
    private statePath;
    private memberId;
    private state;
    constructor(memberId?: string, commsPath?: string);
    /**
     * Ensure comms directory and file exist
     */
    private ensureCommsFile;
    /**
     * Load state from file
     */
    private loadState;
    /**
     * Save state to file
     */
    private saveState;
    /**
     * Send a message to the comms file
     */
    send(recipient: string, content: string, options?: {
        priority?: 'low' | 'medium' | 'high' | 'urgent';
        type?: 'status' | 'message' | 'heartbeat' | 'claim' | 'release' | 'broadcast';
    }): boolean;
    /**
     * Broadcast a status message to all team members
     */
    broadcast(content: string, priority?: 'low' | 'medium' | 'high' | 'urgent'): boolean;
    /**
     * Send a heartbeat
     */
    heartbeat(status?: string): boolean;
    /**
     * Read new messages since last read
     */
    readNew(recipient?: string): FileMessage[];
    /**
     * Parse a message line
     */
    private parseLine;
    /**
     * Get all messages (for debugging)
     */
    readAll(): FileMessage[];
    /**
     * Check if file comms is available
     */
    isAvailable(): boolean;
}
/**
 * Get or create the file comms transport
 */
export declare function getFileCommsTransport(memberId?: string): FileCommsTransport;
/**
 * Send a message with fallback (try MCP first, then file)
 */
export declare function sendWithFallback(recipient: string, content: string, mcpSuccess: boolean, options?: {
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    type?: 'status' | 'message' | 'heartbeat' | 'claim' | 'release' | 'broadcast';
}): boolean;
/**
 * Quick broadcast helper
 */
export declare function fileBroadcast(content: string, priority?: 'low' | 'medium' | 'high' | 'urgent'): boolean;
//# sourceMappingURL=fileCommsTransport.d.ts.map