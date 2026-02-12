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
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
// createHash no longer needed - using readable project dir name instead
import { logger } from '../utils/logger.js';
// ============================================================================
// CONSTANTS - Project-isolated paths (READABLE!)
// ============================================================================
// Compute project directory name for path isolation (human readable!)
const _projectPath = process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
const _projectDirName = process.env['SPECMEM_PROJECT_DIR_NAME'] ||
    basename(_projectPath)
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'default';
const DEFAULT_COMMS_PATH = `/tmp/specmem-${_projectDirName}/comms/comms.txt`;
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
// ============================================================================
// FILE COMMS TRANSPORT
// ============================================================================
export class FileCommsTransport {
    commsPath;
    statePath;
    memberId;
    state;
    constructor(memberId, commsPath) {
        this.memberId = memberId || process.env.SPECMEM_MEMBER_ID || `member-${process.pid}`;
        this.commsPath = commsPath || process.env.SPECMEM_COMMS_PATH || DEFAULT_COMMS_PATH;
        this.statePath = join(dirname(this.commsPath), `.comms-state-${this.memberId}.json`);
        this.state = this.loadState();
        this.ensureCommsFile();
    }
    /**
     * Ensure comms directory and file exist
     */
    ensureCommsFile() {
        const dir = dirname(this.commsPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true, mode: 0o777 });
        }
        if (!existsSync(this.commsPath)) {
            const header = `=== SPECMEM FILE-BASED COMMS ===
[EPOCH] ${new Date().toISOString()}
[VERSION] 1.0

`;
            writeFileSync(this.commsPath, header, { mode: 0o666 });
        }
    }
    /**
     * Load state from file
     */
    loadState() {
        try {
            if (existsSync(this.statePath)) {
                const data = readFileSync(this.statePath, 'utf-8');
                return JSON.parse(data);
            }
        }
        catch {
            // State file corrupted, start fresh
        }
        return {
            lastReadAt: new Date(0).toISOString(),
            lastReadLine: 0,
            memberId: this.memberId
        };
    }
    /**
     * Save state to file
     */
    saveState() {
        try {
            writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), { mode: 0o666 });
        }
        catch (error) {
            logger.warn({ error }, '[FileComms] Failed to save state');
        }
    }
    /**
     * Send a message to the comms file
     */
    send(recipient, content, options) {
        try {
            const timestamp = new Date().toISOString();
            const priority = options?.priority || 'medium';
            const type = options?.type || 'message';
            // Escape pipe characters in content
            const escapedContent = content.replace(/\|/g, '\\|').replace(/\n/g, '\\n');
            const line = `${timestamp}|${this.memberId}|${recipient}|${priority}|${type}|${escapedContent}\n`;
            appendFileSync(this.commsPath, line, { mode: 0o666 });
            logger.debug({ recipient, type, priority }, '[FileComms] Message sent');
            return true;
        }
        catch (error) {
            logger.error({ error }, '[FileComms] Failed to send message');
            return false;
        }
    }
    /**
     * Broadcast a status message to all team members
     */
    broadcast(content, priority = 'medium') {
        return this.send('all', content, { priority, type: 'broadcast' });
    }
    /**
     * Send a heartbeat
     */
    heartbeat(status = 'alive') {
        return this.send('all', status, { priority: 'low', type: 'heartbeat' });
    }
    /**
     * Read new messages since last read
     */
    readNew(recipient) {
        try {
            if (!existsSync(this.commsPath)) {
                return [];
            }
            const content = readFileSync(this.commsPath, 'utf-8');
            const lines = content.split('\n');
            const messages = [];
            const targetRecipient = recipient || this.memberId;
            const cutoff = new Date(Date.now() - MAX_MESSAGE_AGE_MS).toISOString();
            for (let i = this.state.lastReadLine; i < lines.length; i++) {
                const line = lines[i].trim();
                // Skip header lines and empty lines
                if (!line || line.startsWith('===') || line.startsWith('['))
                    continue;
                const parsed = this.parseLine(line);
                if (!parsed)
                    continue;
                // Skip old messages
                if (parsed.timestamp < cutoff)
                    continue;
                // Skip messages not for us (unless broadcast)
                if (parsed.recipient !== 'all' && parsed.recipient !== targetRecipient)
                    continue;
                // Skip our own messages
                if (parsed.sender === this.memberId)
                    continue;
                messages.push(parsed);
            }
            // Update state
            this.state.lastReadLine = lines.length;
            this.state.lastReadAt = new Date().toISOString();
            this.saveState();
            return messages;
        }
        catch (error) {
            logger.error({ error }, '[FileComms] Failed to read messages');
            return [];
        }
    }
    /**
     * Parse a message line
     */
    parseLine(line) {
        try {
            // Handle escaped pipes
            const parts = line.split(/(?<!\\)\|/).map(p => p.replace(/\\\|/g, '|').replace(/\\n/g, '\n'));
            if (parts.length < 6)
                return null;
            return {
                timestamp: parts[0],
                sender: parts[1],
                recipient: parts[2],
                priority: parts[3],
                type: parts[4],
                content: parts.slice(5).join('|') // Rejoin in case content had pipes
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Get all messages (for debugging)
     */
    readAll() {
        const oldLine = this.state.lastReadLine;
        this.state.lastReadLine = 0;
        const messages = this.readNew('all');
        this.state.lastReadLine = oldLine; // Restore
        return messages;
    }
    /**
     * Check if file comms is available
     */
    isAvailable() {
        try {
            this.ensureCommsFile();
            return existsSync(this.commsPath);
        }
        catch {
            return false;
        }
    }
}
// ============================================================================
// SINGLETON & HELPERS
// ============================================================================
let transportInstance = null;
/**
 * Get or create the file comms transport
 */
export function getFileCommsTransport(memberId) {
    if (!transportInstance) {
        transportInstance = new FileCommsTransport(memberId);
    }
    return transportInstance;
}
/**
 * Send a message with fallback (try MCP first, then file)
 */
export function sendWithFallback(recipient, content, mcpSuccess, options) {
    // If MCP succeeded, optionally still write to file for visibility
    if (mcpSuccess) {
        return true;
    }
    // MCP failed, use file fallback
    const transport = getFileCommsTransport();
    return transport.send(recipient, content, options);
}
/**
 * Quick broadcast helper
 */
export function fileBroadcast(content, priority = 'medium') {
    const transport = getFileCommsTransport();
    return transport.broadcast(content, priority);
}
//# sourceMappingURL=fileCommsTransport.js.map