/**
 * Team Communications Service (MCP-Based)
 *
 * Provides team-based communication for spawned team members.
 * All communication uses MCP tools (NOT HTTP/REST).
 *
 * NEW MCP-Based Features:
 * - MCP tools for all inter-team-member communication
 * - PostgreSQL-backed message storage (Slack-like)
 * - Channel/threading support via MCP
 * - Replaces HTTP-based team member communication
 *
 * Legacy Features (still supported via MCP):
 * - Auto-channel creation for parent tasks
 * - Team member ID generation and tracking
 * - Dev team pre-prompt injection
 * - Task claim/release management
 * - Completion notifications
 *
 * @author SpecMem Team
 */
import { EventEmitter } from 'events';
import { createTeamMemberChannelManager, } from './teamMemberChannels.js';
import { createSpecMemClient } from './workers/specmemClient.js';
import { logger } from '../utils/logger.js';
// ============================================================================
// Dev Team Pre-Prompt (Framing for spawned team members)
// ============================================================================
/**
 * Get the dev team framing/pre-prompt for spawned team members
 *
 * NOTE: All team communication now uses MCP tools (NOT HTTP/REST).
 * The tools below are the new MCP-based communication system.
 */
export function getDevTeamFraming() {
    return `
## Team Communication Protocol (MCP-Based)

You are a team member working on a collaborative task. You have access to MCP-based team communication tools to coordinate with other team members.

IMPORTANT: All communication uses MCP tools. DO NOT use HTTP/REST endpoints for team communication.

### Available Team Communication Tools (MCP):
- **send_team_message**: Send a message to the team channel (supports @mentions)
- **read_team_messages**: Read messages from team channels
- **broadcast_to_team**: Broadcast status/progress to all team members
- **claim_task**: Claim a subtask to work on (prevents duplicate work)
- **release_task**: Release a claimed task if you can't complete it
- **get_team_status**: Show what everyone is working on
- **request_help**: Ask for help from team members
- **respond_to_help**: Respond to help requests

### Communication Guidelines:
1. **Announce your work**: When starting a task, use send_team_message
2. **Claim before working**: Always use claim_task before starting work
3. **Update progress**: Use broadcast_to_team for periodic updates
4. **Ask for help**: Use request_help when stuck
5. **Coordinate**: Use get_team_status to avoid conflicts
6. **Complete notification**: Use broadcast_to_team when done

### Message Format:
- Use @member-id to mention specific team members
- Keep messages concise but informative
- Include relevant context (file paths, function names, etc.)

### Task Lifecycle:
1. Receive task assignment
2. Use read_team_messages to check for context
3. Use claim_task to claim your work
4. Do the work, use send_team_message for updates
5. Use broadcast_to_team for completion
6. Use release_task for any tasks you can't complete
`.trim();
}
// ============================================================================
// Team Communication Tools Definition
// ============================================================================
/**
 * Get the list of team communication tool names (MCP-based)
 *
 * These are the new MCP-based tools that REPLACE HTTP team member communication.
 */
export function getTeamCommunicationToolNames() {
    return [
        // NEW MCP-based team communication tools
        'send_team_message',
        'read_team_messages',
        'broadcast_to_team',
        'claim_task',
        'release_task',
        'get_team_status',
        'request_help',
        'respond_to_help',
    ];
}
// ============================================================================
// TeamCommsService Class
// ============================================================================
export class TeamCommsService extends EventEmitter {
    client;
    teamMemberId;
    channelManager;
    autoArchiveOnCompletion;
    // In-memory tracking (also persisted to SpecMem)
    teamMembers = new Map();
    teamChannels = new Map();
    taskToChannel = new Map(); // parentTaskId -> channelId
    claimedTasks = new Map(); // taskId -> memberId
    constructor(config = {}) {
        super();
        this.teamMemberId = config.teamMemberId || 'team-comms-service';
        this.client = config.client || createSpecMemClient({ teamMemberId: this.teamMemberId });
        this.channelManager = createTeamMemberChannelManager(this.teamMemberId, this.client);
        this.autoArchiveOnCompletion = config.autoArchiveOnCompletion ?? true;
    }
    // ============================================================================
    // Team Member ID Generation
    // ============================================================================
    /**
     * Generate a unique team member ID
     */
    generateTeamMemberId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `tm-${timestamp}-${random}`;
    }
    // ============================================================================
    // Channel Management
    // ============================================================================
    /**
     * Get or create a team channel for a parent task
     */
    async getOrCreateChannel(parentTaskId) {
        // Check cache first
        const existingChannelId = this.taskToChannel.get(parentTaskId);
        if (existingChannelId) {
            const existing = this.teamChannels.get(existingChannelId);
            if (existing && !existing.isArchived) {
                return existing;
            }
        }
        // Try to find existing channel in SpecMem
        const channelName = this.generateChannelName(parentTaskId);
        const existingChannel = await this.channelManager.getChannelByName(channelName);
        if (existingChannel) {
            const teamChannel = this.channelToTeamChannel(existingChannel, parentTaskId);
            this.teamChannels.set(teamChannel.id, teamChannel);
            this.taskToChannel.set(parentTaskId, teamChannel.id);
            return teamChannel;
        }
        // Create new channel
        const channel = await this.channelManager.createChannel(channelName, {
            description: `Team channel for task ${parentTaskId}`,
            type: 'private',
            metadata: {
                parentTaskId,
                isTeamChannel: true,
                createdAt: new Date().toISOString(),
            },
        });
        if (!channel) {
            throw new Error(`Failed to create team channel for task ${parentTaskId}`);
        }
        const teamChannel = {
            id: channel.id,
            name: channel.name,
            parentTaskId,
            members: [this.teamMemberId],
            createdAt: new Date(),
            isArchived: false,
            messageCount: 0,
        };
        this.teamChannels.set(teamChannel.id, teamChannel);
        this.taskToChannel.set(parentTaskId, teamChannel.id);
        // Persist to SpecMem
        await this.persistTeamChannel(teamChannel);
        logger.info({ parentTaskId, channelId: teamChannel.id }, '[TeamComms] Created team channel');
        this.emit('channelCreated', teamChannel);
        return teamChannel;
    }
    /**
     * Generate a channel name from parent task ID
     */
    generateChannelName(parentTaskId) {
        // Sanitize and shorten the task ID for channel name
        const sanitized = parentTaskId
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 40);
        return `team-${sanitized}`;
    }
    /**
     * Convert Channel to TeamChannel
     */
    channelToTeamChannel(channel, parentTaskId) {
        return {
            id: channel.id,
            name: channel.name,
            parentTaskId,
            members: channel.members,
            createdAt: channel.createdAt,
            isArchived: false,
            messageCount: 0,
        };
    }
    // ============================================================================
    // Team Member Management
    // ============================================================================
    /**
     * Prepare for spawning a team member
     * This sets up the channel, generates IDs, and enhances the prompt
     */
    async prepareTeamMemberSpawn(config) {
        // 1. Create or get team channel
        const channel = await this.getOrCreateChannel(config.parentTaskId);
        // 2. Generate team member ID
        const memberId = this.generateTeamMemberId();
        // 3. Create team member record
        const teamMember = {
            id: memberId,
            name: config.name || `TeamMember-${memberId.substring(0, 8)}`,
            parentTaskId: config.parentTaskId,
            channelId: channel.id,
            status: 'spawning',
            spawnedAt: new Date(),
            claimedTasks: [],
            metadata: config.metadata,
        };
        // 4. Register team member
        this.teamMembers.set(memberId, teamMember);
        channel.members.push(memberId);
        await this.persistTeamMember(teamMember);
        // 5. Inject team context into prompt
        const enhancedPrompt = this.injectTeamContext(config.prompt, {
            channelId: channel.id,
            memberId: memberId,
            teamPrePrompt: getDevTeamFraming(),
        });
        // 6. Add team tools to available tools
        const teamTools = getTeamCommunicationToolNames();
        const tools = [...(config.tools || []), ...teamTools];
        // 7. Send join message to channel
        await this.channelManager.sendToChannel(channel.id, `Team member ${teamMember.name} (${memberId}) has joined the team.`, { priority: 'medium' });
        logger.info({
            memberId,
            parentTaskId: config.parentTaskId,
            channelId: channel.id,
        }, '[TeamComms] Prepared team member spawn');
        this.emit('memberPrepared', teamMember);
        return {
            memberId,
            channelId: channel.id,
            enhancedPrompt,
            tools,
            teamMember,
        };
    }
    /**
     * Inject team context into prompt
     */
    injectTeamContext(prompt, context) {
        const teamHeader = `
# Team Member Context
- **Team Member ID**: ${context.memberId}
- **Team Channel ID**: ${context.channelId}
- **Parent Session**: Connected to team coordination

${context.teamPrePrompt}

---

# ⚡ PROGRESS OUTPUT (CRITICAL!)

**You MUST output progress using team messages!** The parent session watches for your updates.

## When Starting:
\`\`\`
send_team_message({message: "🔄 Starting: [brief description of what you're doing]"})
\`\`\`

## During Work (every few steps):
\`\`\`
send_team_message({message: "📝 Progress: [what you just completed]"})
\`\`\`

## When Done:
\`\`\`
send_team_message({message: "✅ Completed: [summary of what you accomplished]"})
\`\`\`

This is how the parent shows loading progress instead of raw tool spam!

---

# ⚠️ MANDATORY TEAM COMMS ENFORCEMENT ⚠️

**These rules are ENFORCED by the system. You WILL BE BLOCKED if you skip them.**

- Every 4 tool calls, you **WILL BE BLOCKED** until you call \`read_team_messages({include_swarms:true, limit:5})\`
- Every 5 tool calls, you **WILL BE BLOCKED** until you call \`read_team_messages({include_broadcasts:true, include_swarms:true, limit:10})\`
- Every 8 tool calls, you **WILL BE BLOCKED** until you call \`get_team_status()\` to check for help requests
- These counters apply to ALL tool calls, including memory tools, searches, reads — **no exceptions**
- If you want to complete your task, you MUST comply. There is no workaround.

**Why?** The parent session may send you instructions, redirections, or dynamic context mid-task via team messages. Skipping reads means missing critical information.

---

# Original Task

`;
        return teamHeader + prompt;
    }
    /**
     * Update team member status
     */
    async updateMemberStatus(memberId, status) {
        const member = this.teamMembers.get(memberId);
        if (!member) {
            logger.warn({ memberId }, '[TeamComms] Member not found for status update');
            return false;
        }
        const oldStatus = member.status;
        member.status = status;
        if (status === 'completed' || status === 'failed') {
            member.completedAt = new Date();
        }
        await this.persistTeamMember(member);
        logger.info({ memberId, oldStatus, newStatus: status }, '[TeamComms] Member status updated');
        this.emit('memberStatusChanged', { member, oldStatus, newStatus: status });
        // Check if all members are done
        if (status === 'completed' || status === 'failed') {
            await this.checkChannelCompletion(member.channelId);
        }
        return true;
    }
    /**
     * Get team member by ID
     */
    getTeamMember(memberId) {
        return this.teamMembers.get(memberId);
    }
    /**
     * Get all team members for a channel
     */
    getChannelMembers(channelId) {
        return Array.from(this.teamMembers.values())
            .filter(m => m.channelId === channelId);
    }
    /**
     * Get team status for a parent task
     */
    async getTeamStatus(parentTaskId) {
        const channelId = this.taskToChannel.get(parentTaskId);
        const channel = channelId ? this.teamChannels.get(channelId) : undefined;
        const members = channel ? this.getChannelMembers(channel.id) : [];
        const activeTasks = Array.from(this.claimedTasks.entries())
            .filter(([_, mid]) => members.some(m => m.id === mid))
            .map(([taskId, _]) => taskId);
        return {
            channel,
            members,
            activeTasks,
            completedCount: members.filter(m => m.status === 'completed').length,
            failedCount: members.filter(m => m.status === 'failed').length,
            workingCount: members.filter(m => m.status === 'working').length,
        };
    }
    // ============================================================================
    // Task Claim/Release
    // ============================================================================
    /**
     * Claim a task for a team member
     */
    async claimTask(memberId, taskId) {
        const member = this.teamMembers.get(memberId);
        if (!member) {
            logger.warn({ memberId }, '[TeamComms] Member not found for task claim');
            return false;
        }
        // Check if already claimed
        const currentOwner = this.claimedTasks.get(taskId);
        if (currentOwner && currentOwner !== memberId) {
            logger.warn({ memberId, taskId, currentOwner }, '[TeamComms] Task already claimed');
            return false;
        }
        this.claimedTasks.set(taskId, memberId);
        member.claimedTasks.push(taskId);
        // Persist claim
        await this.persistTaskClaim(memberId, taskId, 'claim');
        // Notify channel
        await this.channelManager.sendToChannel(member.channelId, `${member.name} claimed task: ${taskId}`, { priority: 'medium' });
        logger.info({ memberId, taskId }, '[TeamComms] Task claimed');
        this.emit('taskClaimed', { memberId, taskId });
        return true;
    }
    /**
     * Release a claimed task
     */
    async releaseTask(memberId, taskId) {
        const member = this.teamMembers.get(memberId);
        if (!member) {
            logger.warn({ memberId }, '[TeamComms] Member not found for task release');
            return false;
        }
        const currentOwner = this.claimedTasks.get(taskId);
        if (currentOwner !== memberId) {
            logger.warn({ memberId, taskId }, '[TeamComms] Cannot release task not owned');
            return false;
        }
        this.claimedTasks.delete(taskId);
        member.claimedTasks = member.claimedTasks.filter(t => t !== taskId);
        // Persist release
        await this.persistTaskClaim(memberId, taskId, 'release');
        // Notify channel
        await this.channelManager.sendToChannel(member.channelId, `${member.name} released task: ${taskId}`, { priority: 'medium' });
        logger.info({ memberId, taskId }, '[TeamComms] Task released');
        this.emit('taskReleased', { memberId, taskId });
        return true;
    }
    /**
     * Release all tasks for a member (on completion/failure)
     */
    async releaseAllTasks(memberId) {
        const member = this.teamMembers.get(memberId);
        if (!member)
            return 0;
        const tasks = [...member.claimedTasks];
        let released = 0;
        for (const taskId of tasks) {
            if (await this.releaseTask(memberId, taskId)) {
                released++;
            }
        }
        return released;
    }
    // ============================================================================
    // Task Completion
    // ============================================================================
    /**
     * Handle team member completion
     */
    async handleMemberCompletion(memberId, result) {
        const member = this.teamMembers.get(memberId);
        if (!member) {
            logger.warn({ memberId }, '[TeamComms] Member not found for completion');
            return;
        }
        // 1. Release all claimed tasks
        await this.releaseAllTasks(memberId);
        // 2. Update status
        const newStatus = result.success ? 'completed' : 'failed';
        await this.updateMemberStatus(memberId, newStatus);
        // 3. Send completion message to channel
        const message = result.success
            ? `${member.name} completed successfully: ${result.message || 'Task done'}`
            : `${member.name} failed: ${result.error || 'Unknown error'}`;
        await this.channelManager.sendToChannel(member.channelId, message, { priority: result.success ? 'medium' : 'high' });
        logger.info({
            memberId,
            success: result.success,
            message: result.message,
            error: result.error,
        }, '[TeamComms] Member completion handled');
        this.emit('memberCompleted', { member, result });
    }
    /**
     * Check if all members in a channel are done and archive if needed
     */
    async checkChannelCompletion(channelId) {
        const channel = this.teamChannels.get(channelId);
        if (!channel || channel.isArchived)
            return;
        const members = this.getChannelMembers(channelId);
        const allDone = members.every(m => m.status === 'completed' || m.status === 'failed');
        if (allDone && this.autoArchiveOnCompletion) {
            await this.archiveChannel(channelId);
        }
    }
    /**
     * Archive a team channel
     */
    async archiveChannel(channelId) {
        const channel = this.teamChannels.get(channelId);
        if (!channel) {
            logger.warn({ channelId }, '[TeamComms] Channel not found for archival');
            return false;
        }
        channel.isArchived = true;
        channel.archivedAt = new Date();
        // Send archive message
        await this.channelManager.sendToChannel(channelId, 'Team channel archived - all members have completed.', { priority: 'high' });
        // Persist
        await this.persistTeamChannel(channel);
        logger.info({ channelId }, '[TeamComms] Channel archived');
        this.emit('channelArchived', channel);
        return true;
    }
    // ============================================================================
    // Messaging
    // ============================================================================
    /**
     * Send a message to a team channel
     */
    async sendToChannel(channelId, content, options) {
        const channel = this.teamChannels.get(channelId);
        if (channel) {
            channel.messageCount++;
        }
        return this.channelManager.sendToChannel(channelId, content, options);
    }
    /**
     * Get messages from a team channel
     */
    async getChannelMessages(channelId, options) {
        return this.channelManager.getChannelMessages(channelId, options);
    }
    // ============================================================================
    // Persistence
    // ============================================================================
    async persistTeamMember(member) {
        const tags = [
            'team-member',
            `member:${member.id}`,
            `task:${member.parentTaskId}`,
            `channel:${member.channelId}`,
            `status:${member.status}`,
        ];
        await this.client.remember(JSON.stringify(member), {
            memoryType: 'episodic',
            importance: 'high',
            tags,
            metadata: {
                teamMember: member,
                timestamp: new Date().toISOString(),
            },
        });
    }
    async persistTeamChannel(channel) {
        const tags = [
            'team-channel',
            `channel:${channel.id}`,
            `task:${channel.parentTaskId}`,
            channel.isArchived ? 'archived' : 'active',
        ];
        await this.client.remember(JSON.stringify(channel), {
            memoryType: 'episodic',
            importance: 'high',
            tags,
            metadata: {
                teamChannel: channel,
                timestamp: new Date().toISOString(),
            },
        });
    }
    async persistTaskClaim(memberId, taskId, action) {
        const tags = [
            'task-claim',
            `member:${memberId}`,
            `subtask:${taskId}`,
            `action:${action}`,
        ];
        await this.client.remember(`Task ${action}: ${taskId} by ${memberId}`, {
            memoryType: 'episodic',
            importance: 'medium',
            tags,
            metadata: {
                memberId,
                taskId,
                action,
                timestamp: new Date().toISOString(),
            },
        });
    }
    // ============================================================================
    // Getters
    // ============================================================================
    getChannelManager() {
        return this.channelManager;
    }
    getClient() {
        return this.client;
    }
    getTeamMemberId() {
        return this.teamMemberId;
    }
    getAllTeamMembers() {
        return Array.from(this.teamMembers.values());
    }
    getAllTeamChannels() {
        return Array.from(this.teamChannels.values());
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a TeamCommsService instance
 */
export function createTeamCommsService(config) {
    return new TeamCommsService(config);
}
// ============================================================================
// Global Service (singleton pattern)
// ============================================================================
let globalTeamCommsService = null;
/**
 * Get the global TeamCommsService instance
 */
export function getTeamCommsService() {
    if (!globalTeamCommsService) {
        globalTeamCommsService = createTeamCommsService();
    }
    return globalTeamCommsService;
}
/**
 * Initialize the global TeamCommsService with custom config
 */
export function initializeTeamCommsService(config) {
    if (globalTeamCommsService) {
        logger.warn('[TeamComms] Re-initializing global service');
    }
    globalTeamCommsService = createTeamCommsService(config);
    return globalTeamCommsService;
}
/**
 * Shutdown the global TeamCommsService
 */
export async function shutdownTeamCommsService() {
    if (globalTeamCommsService) {
        // Archive any active channels
        const channels = globalTeamCommsService.getAllTeamChannels();
        for (const channel of channels) {
            if (!channel.isArchived) {
                await globalTeamCommsService.archiveChannel(channel.id);
            }
        }
        globalTeamCommsService = null;
    }
}
//# sourceMappingURL=teamCommsService.js.map