import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { getTeamMemberTracker } from './teamMemberTracker.js';
import { getTeamMemberLimitsMonitor } from './teamMemberLimits.js';
import { getSpecmemRoot } from '../config.js';
import { getSpawnEnv } from '../utils/index.js';
// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class TeamMemberDeployment extends EventEmitter {
    tracker;
    limitsMonitor;
    processes = new Map();
    shutdownInProgress = false;
    constructor() {
        super();
        this.tracker = getTeamMemberTracker();
        this.limitsMonitor = getTeamMemberLimitsMonitor();
        this.setupLimitsListener();
    }
    setupLimitsListener() {
        this.limitsMonitor.on('limit:warning', ({ teamMemberId, warning }) => {
            this.sendLimitWarning(teamMemberId, warning);
        });
    }
    async sendLimitWarning(teamMemberId, warning) {
        const runningProc = this.processes.get(teamMemberId);
        if (!runningProc || !runningProc.process.stdin) {
            return;
        }
        const warningJson = this.limitsMonitor.formatWarningForTeamMember(warning);
        runningProc.process.stdin.write(warningJson + '\n');
        await this.tracker.addLog(teamMemberId, 'warn', `Limit warning: ${warning.message} - ${warning.suggestion}`);
        this.emit('teamMember:limit_warning', { teamMemberId, warning });
    }
    getTeamMemberLimits(teamMemberId) {
        return this.limitsMonitor.getLimits(teamMemberId);
    }
    getTeamMemberLimitStatus(teamMemberId) {
        return this.limitsMonitor.getLimitStatus(teamMemberId);
    }
    async deploy(config) {
        const teamMemberId = crypto.randomUUID();
        this.limitsMonitor.initializeTeamMember(teamMemberId, {
            tokensLimit: config.tokensLimit,
            memoryLimit: config.memoryLimit,
            filesLimit: config.filesLimit,
            outputLimit: config.outputLimit
        });
        // Token limit: Use configured value or reasonable default (100M tokens is effectively unlimited but avoids overflow issues)
        const DEFAULT_TOKENS_LIMIT = 100_000_000; // 100M tokens - reasonable "unlimited" default
        const tokensLimit = config.tokensLimit ?? DEFAULT_TOKENS_LIMIT;
        const teamMember = await this.tracker.registerTeamMember({
            id: teamMemberId,
            name: config.name,
            type: config.type,
            status: 'pending',
            tokensLimit, // Configurable token limit with reasonable default
            metadata: {
                command: config.command,
                args: config.args,
                autoRestart: config.autoRestart
            }
        });
        await this.startProcess(teamMemberId, config);
        return teamMember;
    }
    async startProcess(teamMemberId, config) {
        const existingProcess = this.processes.get(teamMemberId);
        const restartCount = existingProcess?.restartCount || 0;
        if (config.maxRestarts && restartCount >= config.maxRestarts) {
            await this.tracker.updateTeamMemberStatus(teamMemberId, 'failed', { reason: 'max_restarts_exceeded' });
            await this.tracker.addLog(teamMemberId, 'error', `TeamMember exceeded max restarts (${config.maxRestarts})`);
            return;
        }
        // Determine command and args
        let command;
        let args;
        if (config.command) {
            // Custom command
            command = config.command;
            args = config.args || [];
        }
        else if (config.workerType === 'ai' && config.aiConfig) {
            // REAL FIX: Inject prompt into current  session to deploy team member via Task tool!
            // This triggers the overseer  to deploy a background team member
            const model = config.aiConfig.model || 'sonnet';
            const skillsPath = path.join(getSpecmemRoot(), 'skills/teammemberskills');
            let systemPrompt = config.aiConfig.systemPrompt || `You are ${config.name} - a background teamMember.`;
            systemPrompt += `\n\nIMPORTANT: You MUST read and follow ALL skills in ${skillsPath}/ especially:`;
            systemPrompt += '\n- ANTI_COMMENTATION.md - Use YN street slang, flame professional comments';
            systemPrompt += '\n- CODE_PATTERNS.md - Follow code patterns';
            systemPrompt += '\n- COMMUNICATION_STYLE.md - Unprofessional communication';
            systemPrompt += `\n\nTeam Member ID: ${teamMemberId}`;
            systemPrompt += `\nTeam Member Name: ${config.name}`;
            systemPrompt += '\n\nFirst action: Use the terminal injection API at http://localhost:8595/api/terminal-inject/inject to inject "Hello from team member 1" into the overseer terminal.';
            // Inject prompt into current  session to trigger Task tool deployment
            const prompt = `Deploy a ${model} background team member named "${config.name}" with the following instructions:\n\n${systemPrompt}\n\nUse the Task tool to deploy this teamMember. The team member should immediately inject "Hello from ${config.name}" into the terminal via the injection API.`;
            // Use terminal injection to trigger team member deployment in current session
            // MED-12 FIX: Use execFileSync with explicit args array instead of shell string
            // to prevent command injection via shell metacharacters in prompt/config.name
            // Previously: shell string interpolation allowed injection via backticks, $(), etc.
            try {
                const { execFileSync } = await import('child_process');
                // Build request body as JSON object - shell metacharacters are safely serialized
                const requestBody = JSON.stringify({ prompt });
                // execFileSync bypasses shell - args passed directly to curl binary
                execFileSync('curl', [
                    '-s',
                    '-b', '/tmp/cookies.txt',
                    '-X', 'POST',
                    'http://localhost:8595/api/terminal-inject/inject',
                    '-H', 'Content-Type: application/json',
                    '-d', requestBody
                ], {
                    encoding: 'utf-8'
                });
                await this.tracker.updateTeamMemberStatus(teamMemberId, 'running');
                await this.tracker.addLog(teamMemberId, 'info', `TeamMember deployment prompt injected into overseer terminal`);
                // Don't spawn a process - the team member runs via Task tool in overseer session
                return;
            }
            catch (error) {
                logger.error({ error }, 'Failed to inject team member deployment prompt');
                throw error;
            }
        }
        else {
            // Legacy: Use built-in worker script for non-AI workers
            command = 'node';
            args = [];
            // Add memory limit if specified (default 50MB for workers)
            const memLimit = config.memoryLimit || 50;
            args.push(`--max-old-space-size=${memLimit}`);
            // Enable manual GC for memory management
            args.push('--expose-gc');
            // Worker script path
            const workerPath = `${__dirname}/workers/${config.workerType}Worker.js`;
            args.push(workerPath);
            // Worker config as JSON argument
            const workerConfig = {
                teamMemberId,
                teamMemberName: config.name,
                teamMemberType: config.type,
                tokensLimit: config.tokensLimit,
                memoryLimit: config.memoryLimit
            };
            args.push(JSON.stringify(workerConfig));
        }
        // bruh ALWAYS use getSpawnEnv for project isolation - team members inherit parent project context
        // CRITICAL: detached: true prevents SIGINT propagation when user presses ESC in terminal
        const proc = spawn(command, args, {
            cwd: config.cwd || process.cwd(),
            env: { ...getSpawnEnv(), ...config.env, TEAM_MEMBER_ID: teamMemberId },
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: true // Isolate from parent process group - prevents ESC killing all agents
        });
        // Unref so parent doesn't wait for child, but we still track via this.processes Map
        proc.unref();
        this.processes.set(teamMemberId, {
            process: proc,
            config,
            restartCount,
            teamMemberId
        });
        await this.tracker.updateTeamMemberStatus(teamMemberId, 'running');
        await this.tracker.addLog(teamMemberId, 'info', `TeamMember started with PID ${proc.pid}`);
        proc.stdout?.on('data', async (data) => {
            const outputSize = data.length;
            this.limitsMonitor.updateOutputSize(teamMemberId, outputSize);
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                await this.tracker.addLog(teamMemberId, 'info', line);
                this.parseTeamMemberOutput(teamMemberId, line);
            }
        });
        proc.stderr?.on('data', async (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                await this.tracker.addLog(teamMemberId, 'error', line);
            }
        });
        proc.on('close', async (code) => {
            if (this.shutdownInProgress)
                return;
            const runningProc = this.processes.get(teamMemberId);
            if (!runningProc)
                return;
            this.processes.delete(teamMemberId);
            if (code === 0) {
                await this.tracker.updateTeamMemberStatus(teamMemberId, 'completed');
                await this.tracker.addLog(teamMemberId, 'info', 'Team Member completed successfully');
            }
            else {
                await this.tracker.addLog(teamMemberId, 'error', `TeamMember exited with code ${code}`);
                if (config.autoRestart) {
                    await this.tracker.addLog(teamMemberId, 'info', `Auto-restarting team member (attempt ${restartCount + 1})`);
                    runningProc.restartCount++;
                    this.processes.set(teamMemberId, runningProc);
                    setTimeout(() => this.startProcess(teamMemberId, config), 2000);
                }
                else {
                    await this.tracker.updateTeamMemberStatus(teamMemberId, 'failed', { exitCode: code });
                }
            }
            this.emit('teamMember:exit', { teamMemberId, code });
        });
        proc.on('error', async (err) => {
            await this.tracker.addLog(teamMemberId, 'error', `Process error: ${err.message}`);
            await this.tracker.updateTeamMemberStatus(teamMemberId, 'failed', { error: err.message });
            this.processes.delete(teamMemberId);
        });
    }
    parseTeamMemberOutput(teamMemberId, line) {
        if (line.startsWith('TOKENS:')) {
            const tokens = parseInt(line.replace('TOKENS:', '').trim(), 10);
            if (!isNaN(tokens)) {
                this.tracker.addTokenUsage(teamMemberId, tokens);
                this.limitsMonitor.updateTokens(teamMemberId, tokens);
            }
        }
        if (line.startsWith('PROGRESS:')) {
            const progress = parseInt(line.replace('PROGRESS:', '').trim(), 10);
            if (!isNaN(progress)) {
                this.tracker.updateTaskProgress(teamMemberId, { progress });
            }
        }
        if (line.startsWith('TASK:')) {
            try {
                const task = JSON.parse(line.replace('TASK:', '').trim());
                this.tracker.updateTaskProgress(teamMemberId, task);
            }
            catch {
                // ignore parse errors
            }
        }
        if (line.startsWith('HEARTBEAT')) {
            this.tracker.heartbeat(teamMemberId);
        }
        if (line.startsWith('LIMIT_ACK:')) {
            const ack = this.limitsMonitor.parseAcknowledgment(line);
            if (ack) {
                this.limitsMonitor.acknowledgeWarning(teamMemberId, ack.type, ack.action);
                this.emit('teamMember:limit_acknowledged', { teamMemberId, ...ack });
            }
        }
        if (line.startsWith('FILES_PROCESSED:')) {
            const count = parseInt(line.replace('FILES_PROCESSED:', '').trim(), 10);
            if (!isNaN(count)) {
                this.limitsMonitor.updateFilesProcessed(teamMemberId, count);
            }
        }
        if (line.startsWith('MEMORY_USAGE:')) {
            const bytes = parseInt(line.replace('MEMORY_USAGE:', '').trim(), 10);
            if (!isNaN(bytes)) {
                this.limitsMonitor.updateMemory(teamMemberId, bytes);
            }
        }
        if (line.startsWith('SHARE_CODE:')) {
            try {
                const data = JSON.parse(line.replace('SHARE_CODE:', '').trim());
                this.tracker.shareCode(teamMemberId, {
                    title: data.title || 'Untitled',
                    description: data.description || '',
                    code: data.code || '',
                    filePath: data.file || data.filePath,
                    language: data.language,
                    tags: data.tags
                }).catch(err => logger.error({ err, teamMemberId }, 'Failed to share code from team member output'));
            }
            catch {
                logger.debug({ teamMemberId, line }, 'Failed to parse SHARE_CODE output');
            }
        }
        if (line.startsWith('FEEDBACK:')) {
            try {
                const data = JSON.parse(line.replace('FEEDBACK:', '').trim());
                if (data.code_id && data.type && data.message) {
                    this.tracker.giveFeedback(teamMemberId, data.code_id, data.type, data.message)
                        .catch(err => logger.error({ err, teamMemberId }, 'Failed to give feedback from team member output'));
                }
            }
            catch {
                logger.debug({ teamMemberId, line }, 'Failed to parse FEEDBACK output');
            }
        }
        if (line.startsWith('MESSAGE:')) {
            try {
                const data = JSON.parse(line.replace('MESSAGE:', '').trim());
                if (data.to && data.message) {
                    this.tracker.sendMessage(teamMemberId, data.to, data.message, data.metadata)
                        .catch(err => logger.error({ err, teamMemberId }, 'Failed to send message from team member output'));
                }
            }
            catch {
                logger.debug({ teamMemberId, line }, 'Failed to parse MESSAGE output');
            }
        }
        if (line.startsWith('REQUEST_REVIEW:')) {
            try {
                const data = JSON.parse(line.replace('REQUEST_REVIEW:', '').trim());
                if (data.code_id && data.to) {
                    const reviewerIds = Array.isArray(data.to) ? data.to : [data.to];
                    for (const reviewerId of reviewerIds) {
                        this.tracker.sendMessage(teamMemberId, reviewerId, `Please review my code: ${data.code_id}`, {
                            type: 'review_request',
                            codeId: data.code_id
                        }).catch(err => logger.error({ err, teamMemberId }, 'Failed to send review request'));
                    }
                }
            }
            catch {
                logger.debug({ teamMemberId, line }, 'Failed to parse REQUEST_REVIEW output');
            }
        }
        // Handle RESPONSE: prefix for command responses from team member
        if (line.startsWith('RESPONSE:')) {
            try {
                const response = JSON.parse(line.replace('RESPONSE:', '').trim());
                this.emit('teamMember:response', { teamMemberId, response });
                this.tracker.addLog(teamMemberId, 'info', `Response: ${JSON.stringify(response).substring(0, 100)}`);
            }
            catch {
                logger.debug({ teamMemberId, line }, 'Failed to parse RESPONSE output');
            }
        }
    }
    async stop(teamMemberId, force = false) {
        const runningProc = this.processes.get(teamMemberId);
        if (!runningProc) {
            logger.warn({ teamMemberId }, 'No running process found for team member');
            return false;
        }
        const { process: proc, config } = runningProc;
        config.autoRestart = false;
        await this.tracker.addLog(teamMemberId, 'info', force ? 'Force stopping team member' : 'Stopping team member');
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                proc.kill('SIGKILL');
                this.limitsMonitor.removeTeamMember(teamMemberId);
                resolve(true);
            }, force ? 0 : 5000);
            proc.once('close', () => {
                clearTimeout(timeout);
                this.limitsMonitor.removeTeamMember(teamMemberId);
                resolve(true);
            });
            proc.kill(force ? 'SIGKILL' : 'SIGTERM');
        });
    }
    async restart(teamMemberId) {
        const runningProc = this.processes.get(teamMemberId);
        if (!runningProc) {
            logger.warn({ teamMemberId }, 'No process found for restart');
            return false;
        }
        const { config } = runningProc;
        await this.stop(teamMemberId, false);
        await new Promise(r => setTimeout(r, 1000));
        this.limitsMonitor.resetLimits(teamMemberId);
        await this.startProcess(teamMemberId, config);
        return true;
    }
    async sendInput(teamMemberId, input) {
        const runningProc = this.processes.get(teamMemberId);
        if (!runningProc || !runningProc.process.stdin) {
            return false;
        }
        runningProc.process.stdin.write(input + '\n');
        return true;
    }
    /**
     * Send a JSON command to a team member via stdin and optionally wait for response.
     * Commands are formatted as JSON and sent via stdin.
     * The team member can respond via stdout with RESPONSE: prefix.
     */
    async sendCommand(teamMemberId, command) {
        const runningProc = this.processes.get(teamMemberId);
        if (!runningProc || !runningProc.process.stdin) {
            logger.warn({ teamMemberId }, 'Cannot send command - team member not running or stdin not available');
            return { success: false };
        }
        try {
            // Format the command as JSON with a COMMAND: prefix for team member parsing
            const commandStr = 'COMMAND:' + JSON.stringify(command);
            runningProc.process.stdin.write(commandStr + '\n');
            const cmdType = typeof command.type === 'string' ? command.type : 'unknown';
            await this.tracker.addLog(teamMemberId, 'info', `Command sent: ${cmdType}`);
            // Emit event for WebSocket broadcasts
            this.emit('teamMember:command_sent', { teamMemberId, command });
            // For certain command types, we can return immediately
            if (command.type === 'stop') {
                // Handle stop command by actually stopping the team member
                await this.stop(teamMemberId, false);
                return { success: true, response: { status: 'stopping' } };
            }
            // For other commands, the response will come async via stdout
            return { success: true, queued: true };
        }
        catch (err) {
            logger.error({ err, teamMemberId }, 'Failed to send command to team member');
            return { success: false };
        }
    }
    getRunningTeamMemberIds() {
        return Array.from(this.processes.keys());
    }
    isRunning(teamMemberId) {
        return this.processes.has(teamMemberId);
    }
    async shutdown() {
        this.shutdownInProgress = true;
        const teamMemberIds = Array.from(this.processes.keys());
        await Promise.all(teamMemberIds.map(id => this.stop(id, true)));
        await this.tracker.shutdown();
        logger.info('TeamMemberDeployment shutdown complete');
    }
}
let globalDeployment = null;
export function getTeamMemberDeployment() {
    if (!globalDeployment) {
        globalDeployment = new TeamMemberDeployment();
    }
    return globalDeployment;
}
//# sourceMappingURL=teamMemberDeployment.js.map