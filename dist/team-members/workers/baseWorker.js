/**
 * Base TeamMember Worker - Lightweight process for team member tasks
 *
 * This runs as a separate Node process with memory limits.
 * Communicates via stdin/stdout with the main specmem process.
 *
 * Enhanced with SpecMem HTTP client integration for inter-team member communication.
 *
 * RAM usage: ~10-30MB per worker (vs 800MB+ for full  instance)
 */
import { stdin, stdout } from 'process';
import readline from 'readline';
import { createSpecMemClient } from './specmemClient.js';
import { createTeamMemberCommunicator } from '../communication.js';
import { getPassword } from '../../config/password.js';
export class BaseWorker {
    config;
    tokensUsed = 0;
    taskProgress = 0;
    rl;
    heartbeatInterval;
    // SpecMem integration
    specmemClient;
    communicator;
    constructor(config) {
        this.config = config;
        this.rl = readline.createInterface({
            input: stdin,
            output: stdout,
            terminal: false
        });
        // Initialize SpecMem client and communicator
        // Use centralized password module for consistent password resolution
        const password = config.specmemPassword || getPassword();
        this.specmemClient = createSpecMemClient({
            baseUrl: config.specmemUrl || process.env.SPECMEM_API_URL || 'http://127.0.0.1:8595',
            password,
            teamMemberId: config.teamMemberId,
        });
        this.communicator = createTeamMemberCommunicator(config.teamMemberId, this.specmemClient);
        this.setupInputListener();
        this.startHeartbeat();
    }
    setupInputListener() {
        this.rl.on('line', async (line) => {
            try {
                // Handle commands with COMMAND: prefix (from teamMemberDeployment.sendCommand)
                let commandStr = line;
                if (line.startsWith('COMMAND:')) {
                    commandStr = line.substring(8); // Remove 'COMMAND:' prefix
                }
                // Parse and handle if it looks like a JSON command
                if (commandStr.startsWith('{') && commandStr.includes('"type"')) {
                    const msg = JSON.parse(commandStr);
                    await this.handleCommand(msg);
                }
            }
            catch (err) {
                this.logError(`Failed to parse command: ${err}`);
            }
        });
    }
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, 10000); // Every 10 seconds
    }
    // Communication protocol methods
    log(message) {
        console.log(message);
    }
    logError(message) {
        console.error(message);
    }
    reportTokens(tokens) {
        this.tokensUsed += tokens;
        console.log(`TOKENS:${this.tokensUsed}`);
    }
    reportProgress(progress) {
        this.taskProgress = progress;
        console.log(`PROGRESS:${progress}`);
    }
    reportTask(task) {
        console.log(`TASK:${JSON.stringify(task)}`);
    }
    sendHeartbeat() {
        console.log('HEARTBEAT');
    }
    shareCode(code) {
        console.log(`SHARE_CODE:${JSON.stringify(code)}`);
    }
    giveFeedback(feedback) {
        console.log(`FEEDBACK:${JSON.stringify(feedback)}`);
    }
    sendMessage(message) {
        console.log(`MESSAGE:${JSON.stringify(message)}`);
    }
    requestReview(request) {
        console.log(`REQUEST_REVIEW:${JSON.stringify(request)}`);
    }
    reportFilesProcessed(count) {
        console.log(`FILES_PROCESSED:${count}`);
    }
    reportMemoryUsage() {
        const memUsage = process.memoryUsage();
        console.log(`MEMORY_USAGE:${memUsage.heapUsed}`);
    }
    acknowledgeLimitWarning(type, action) {
        console.log(`LIMIT_ACK:${JSON.stringify({ type, action })}`);
    }
    async start() {
        this.log(`TeamMember ${this.config.teamMemberName} (${this.config.teamMemberId}) started`);
        this.log(`Type: ${this.config.teamMemberType} | Tokens Limit: ${this.config.tokensLimit || 'unlimited'}`);
        // Report initial memory
        this.reportMemoryUsage();
        await this.initialize();
    }
    async shutdown() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.rl.close();
        await this.cleanup();
    }
    // ============================================================================
    // SpecMem Integration Methods
    // ============================================================================
    /**
     * Store a memory in SpecMem
     */
    async remember(content, tags = []) {
        return this.specmemClient.remember(content, {
            memoryType: 'episodic',
            importance: 'medium',
            tags,
            metadata: {
                teamMemberId: this.config.teamMemberId,
                teamMemberName: this.config.teamMemberName,
            },
        });
    }
    /**
     * Search for memories in SpecMem
     */
    async find(query, limit = 10) {
        return this.specmemClient.find(query, { limit });
    }
    /**
     * Broadcast a message to all team members via SpecMem
     */
    async say(message, to = 'all') {
        return this.communicator.say(message, to);
    }
    /**
     * Listen for messages from other team members
     */
    async listen() {
        return this.communicator.listen();
    }
    /**
     * Get list of active team members
     */
    async getActiveTeamMembers() {
        return this.communicator.getActiveTeamMembers();
    }
    /**
     * Register this team member and send initial heartbeat via SpecMem
     */
    async registerWithSpecMem() {
        return this.communicator.registerTeamMember(this.config.teamMemberName, this.config.teamMemberType);
    }
    /**
     * Send heartbeat to SpecMem (for team member discovery)
     */
    async sendSpecMemHeartbeat(status = 'active') {
        return this.communicator.sendHeartbeat(status);
    }
}
//# sourceMappingURL=baseWorker.js.map