/**
 * samplingHandler.ts - MCP Sampling Handler
 *
 * Phase 3: Team Member Deployment System - MCP Sampling Implementation
 *
 * Implements the MCP sampling/createMessage handler for requesting
 * LLM completions from clients ( Code, etc.)
 *
 * Reference: https://modelcontextprotocol.io/specification/2025-06-18/client/sampling
 */
import { logger } from '../utils/logger.js';
// ============================================================================
// System Prompts for Different TeamMember Types
// ============================================================================
const TEAM_MEMBER_SYSTEM_PROMPTS = {
    worker: `You are a Worker TeamMember in the SpecMem multi-team-member system.

Your role is to:
- Execute assigned tasks precisely and efficiently
- Write clean, well-documented code
- Report progress using structured output formats
- Communicate with other team members when you need help or have questions

Output formats you should use:
- PROGRESS:<0-100> - Report task progress percentage
- TASK:{"name":"...", "status":"...","progress":N} - Report task updates
- SHARE_CODE:{"title":"...", "code":"...", "language":"..."} - Share code with team
- MESSAGE:{"to":"<team_member_id>", "message":"..."} - Send message to another team member
- TOKENS:<number> - Report token usage
- HEARTBEAT - Keep connection alive

Always explain your reasoning and approach before writing code.
Be thorough but efficient. Ask for clarification if the task is ambiguous.`,
    overseer: `You are an Overseer TeamMember in the SpecMem multi-team-member system.

Your role is to:
- Coordinate and manage Worker team members
- Break down complex tasks into subtasks for workers
- Monitor progress and ensure quality
- Resolve conflicts and prioritize work
- Make high-level architectural decisions

Output formats you should use:
- DEPLOY_WORKER:{"name":"...", "task":"...", "type":"test|repair|custom"}
- ASSIGN_TASK:{"worker_id":"...", "task":"..."}
- MESSAGE:{"to":"<team_member_id>", "message":"..."} - Communicate with team members
- DECISION:{"type":"...", "reasoning":"...", "action":"..."}
- PROGRESS:<0-100> - Overall project progress
- TOKENS:<number> - Report token usage
- HEARTBEAT - Keep connection alive

You should delegate implementation work to Workers while focusing on coordination.
Think strategically about task decomposition and team member assignment.`,
    qa: `You are a QA TeamMember in the SpecMem multi-team-member system.

Your role is to:
- Review code produced by Worker team members
- Test implementations for correctness and edge cases
- Provide constructive feedback to improve code quality
- Identify bugs, security issues, and performance problems
- Verify that tasks meet their requirements

Output formats you should use:
- REVIEW:{"code_id":"...", "status":"approved|needs_work|rejected", "feedback":"..."}
- FEEDBACK:{"code_id":"...", "type":"bug|style|perf|security", "message":"..."}
- TEST_RESULT:{"test":"...", "passed":true|false, "details":"..."}
- MESSAGE:{"to":"<team_member_id>", "message":"..."} - Communicate feedback
- TOKENS:<number> - Report token usage
- HEARTBEAT - Keep connection alive

Be thorough but constructive in your reviews. Focus on actionable feedback.
Prioritize critical issues over minor style concerns.`
};
// ============================================================================
// Sampling Handler Class
// ============================================================================
export class SamplingHandler {
    pendingRequests = new Map();
    requestCounter = 0;
    defaultTimeout = 60000; // 60 seconds
    /**
     * Create a sampling request for deploying a team member
     */
    createTeamMemberDeploymentRequest(config) {
        const systemPrompt = config.systemPromptOverride ||
            this.getSystemPromptForTeamMember(config.teamMemberType);
        const modelHints = this.getModelHints(config.intelligencePriority || 0.9);
        return {
            messages: [
                {
                    role: 'user',
                    content: config.task
                }
            ],
            modelPreferences: {
                hints: modelHints,
                intelligencePriority: config.intelligencePriority || 0.9,
                speedPriority: config.speedPriority || 0.5
            },
            systemPrompt,
            maxTokens: config.maxTokens || 4096,
            includeContext: 'thisServer',
            metadata: {
                teamMemberType: config.teamMemberType,
                deployedAt: new Date().toISOString()
            }
        };
    }
    /**
     * Get the appropriate system prompt for a team member type
     */
    getSystemPromptForTeamMember(teamMemberType) {
        return TEAM_MEMBER_SYSTEM_PROMPTS[teamMemberType] || TEAM_MEMBER_SYSTEM_PROMPTS.worker;
    }
    /**
     * Get model hints based on intelligence priority
     */
    getModelHints(intelligencePriority) {
        if (intelligencePriority >= 0.9) {
            return ['claude-opus-4-5-20251101', 'claude-3-5-sonnet-20241022'];
        }
        else if (intelligencePriority >= 0.7) {
            return ['claude-3-5-sonnet-20241022', 'claude-sonnet-4-20250514'];
        }
        else {
            return ['claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'];
        }
    }
    /**
     * Create a generic sampling request
     */
    createSamplingRequest(messages, options) {
        return {
            messages,
            systemPrompt: options?.systemPrompt,
            maxTokens: options?.maxTokens || 4096,
            temperature: options?.temperature,
            modelPreferences: options?.modelPreferences || {
                intelligencePriority: 0.8,
                speedPriority: 0.5
            },
            includeContext: options?.includeContext || 'thisServer'
        };
    }
    /**
     * Generate a unique request ID
     */
    generateRequestId() {
        return `sampling_${Date.now()}_${++this.requestCounter}`;
    }
    /**
     * Register a pending sampling request (for async response handling)
     */
    registerRequest(requestId, timeout = this.defaultTimeout) {
        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Sampling request ${requestId} timed out after ${timeout}ms`));
            }, timeout);
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timeout: timeoutHandle
            });
        });
    }
    /**
     * Resolve a pending sampling request
     */
    resolveRequest(requestId, response) {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            logger.warn({ requestId }, 'No pending request found to resolve');
            return false;
        }
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        pending.resolve(response);
        return true;
    }
    /**
     * Reject a pending sampling request
     */
    rejectRequest(requestId, error) {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            logger.warn({ requestId }, 'No pending request found to reject');
            return false;
        }
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        pending.reject(error);
        return true;
    }
    /**
     * Get count of pending requests
     */
    getPendingCount() {
        return this.pendingRequests.size;
    }
    /**
     * Cancel all pending requests
     */
    cancelAllPending() {
        for (const [requestId, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Sampling handler shutting down'));
        }
        this.pendingRequests.clear();
        logger.info('All pending sampling requests cancelled');
    }
    /**
     * Validate a sampling response
     */
    validateResponse(response) {
        if (!response || typeof response !== 'object')
            return false;
        const r = response;
        if (typeof r.model !== 'string')
            return false;
        if (r.role !== 'assistant')
            return false;
        if (!Array.isArray(r.content))
            return false;
        return true;
    }
    /**
     * Extract text content from a sampling response
     */
    extractTextContent(response) {
        return response.content
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map(part => part.text)
            .join('\n');
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let globalSamplingHandler = null;
export function getSamplingHandler() {
    if (!globalSamplingHandler) {
        globalSamplingHandler = new SamplingHandler();
    }
    return globalSamplingHandler;
}
/**
 * MCP Server integration helper
 *
 * Example usage in MCP server setup:
 *
 * ```typescript
 * import { handleSamplingRequest } from './samplingHandler.js';
 *
 * server.setRequestHandler(SamplingRequestSchema, handleSamplingRequest);
 * ```
 */
export async function handleSamplingRequest(request) {
    const handler = getSamplingHandler();
    const { teamMemberType, task, config } = request.params;
    if (teamMemberType && task) {
        // TeamMember deployment request
        return handler.createTeamMemberDeploymentRequest({
            teamMemberType: teamMemberType,
            task,
            intelligencePriority: config?.intelligencePriority || 0.9,
            speedPriority: config?.speedPriority || 0.5,
            maxTokens: config?.maxTokens || 4096
        });
    }
    // Generic sampling request
    return handler.createSamplingRequest([{ role: 'user', content: task || 'Hello' }], {
        maxTokens: config?.maxTokens || 4096
    });
}
//# sourceMappingURL=samplingHandler.js.map