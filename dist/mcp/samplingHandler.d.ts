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
export interface SamplingMessage {
    role: 'user' | 'assistant';
    content: string | ContentPart[];
}
export interface ContentPart {
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
}
export interface ModelPreferences {
    hints?: string[];
    costPriority?: number;
    speedPriority?: number;
    intelligencePriority?: number;
}
export interface SamplingRequest {
    messages: SamplingMessage[];
    modelPreferences?: ModelPreferences;
    systemPrompt?: string;
    includeContext?: 'none' | 'thisServer' | 'allServers';
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    metadata?: Record<string, unknown>;
}
export interface SamplingResponse {
    model: string;
    stopReason?: 'endTurn' | 'stopSequence' | 'maxTokens';
    role: 'assistant';
    content: ContentPart[];
}
export interface TeamMemberConfig {
    teamMemberType: 'worker' | 'overseer' | 'qa';
    task: string;
    intelligencePriority?: number;
    speedPriority?: number;
    maxTokens?: number;
    systemPromptOverride?: string;
}
export declare class SamplingHandler {
    private pendingRequests;
    private requestCounter;
    private readonly defaultTimeout;
    /**
     * Create a sampling request for deploying a team member
     */
    createTeamMemberDeploymentRequest(config: TeamMemberConfig): SamplingRequest;
    /**
     * Get the appropriate system prompt for a team member type
     */
    getSystemPromptForTeamMember(teamMemberType: 'worker' | 'overseer' | 'qa'): string;
    /**
     * Get model hints based on intelligence priority
     */
    private getModelHints;
    /**
     * Create a generic sampling request
     */
    createSamplingRequest(messages: SamplingMessage[], options?: {
        systemPrompt?: string;
        maxTokens?: number;
        temperature?: number;
        modelPreferences?: ModelPreferences;
        includeContext?: 'none' | 'thisServer' | 'allServers';
    }): SamplingRequest;
    /**
     * Generate a unique request ID
     */
    generateRequestId(): string;
    /**
     * Register a pending sampling request (for async response handling)
     */
    registerRequest(requestId: string, timeout?: number): Promise<SamplingResponse>;
    /**
     * Resolve a pending sampling request
     */
    resolveRequest(requestId: string, response: SamplingResponse): boolean;
    /**
     * Reject a pending sampling request
     */
    rejectRequest(requestId: string, error: Error): boolean;
    /**
     * Get count of pending requests
     */
    getPendingCount(): number;
    /**
     * Cancel all pending requests
     */
    cancelAllPending(): void;
    /**
     * Validate a sampling response
     */
    validateResponse(response: unknown): response is SamplingResponse;
    /**
     * Extract text content from a sampling response
     */
    extractTextContent(response: SamplingResponse): string;
}
export declare function getSamplingHandler(): SamplingHandler;
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
export declare function handleSamplingRequest(request: {
    params: {
        teamMemberType?: string;
        task?: string;
        config?: Record<string, unknown>;
    };
}): Promise<SamplingRequest>;
//# sourceMappingURL=samplingHandler.d.ts.map