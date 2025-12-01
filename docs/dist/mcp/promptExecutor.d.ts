/**
 * promptExecutor.ts - Real Claude API Prompt Executor
 *
 * Executes prompts via direct Anthropic Claude API calls.
 * Supports multiple Claude models (3.5 Sonnet, 4.0, Opus) with UNLIMITED tokens.
 *
 * Phase 4 Implementation - Direct Claude API Integration
 *
 * TEAM_MEMBER 3 FIX: Real Claude API integration with model switching and NO TOKEN LIMITS
 */
import Anthropic from '@anthropic-ai/sdk';
export type ModelId = 'claude-3-5-sonnet' | 'claude-4' | 'opus' | 'sonnet-3.5' | 'haiku';
export declare const MODEL_MAP: Record<string, string>;
export interface PromptConfig {
    maxTokens?: number;
    intelligencePriority: number;
    speedPriority: number;
    costPriority: number;
    systemPrompt?: string;
    includeContext?: 'thisServer' | 'allServers' | 'none';
    model?: string;
    temperature?: number;
}
export interface PromptParams {
    prompt: string;
    config: PromptConfig;
    conversationHistory?: Array<{
        role: 'user' | 'assistant';
        content: string;
    }>;
}
export interface PromptResponse {
    content: string;
    tokensUsed?: number;
    model?: string;
    stopReason?: string;
}
export interface SamplingMessage {
    role: 'user' | 'assistant';
    content: {
        type: 'text';
        text: string;
    };
}
export interface SamplingRequest {
    method: 'sampling/createMessage';
    params: {
        messages: SamplingMessage[];
        modelPreferences?: {
            hints?: Array<{
                name: string;
            }>;
            intelligencePriority?: number;
            speedPriority?: number;
            costPriority?: number;
        };
        systemPrompt?: string;
        maxTokens: number;
        includeContext?: 'thisServer' | 'allServers' | 'none';
        temperature?: number;
        stopSequences?: string[];
        enableThinking?: boolean;
    };
}
export interface SamplingResponse {
    model: string;
    stopReason?: string;
    role: 'assistant';
    thinking?: string[];
    content: {
        type: 'text';
        text: string;
    };
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}
/**
 * Real Claude API Client
 * TEAM_MEMBER 3 FIX: Actually calls Claude API instead of simulating responses
 */
declare class ClaudeAPIClient {
    private anthropic;
    private isConnected;
    constructor();
    /**
     * Resolve model name to actual API model ID
     */
    private resolveModel;
    /**
     * Send a real request to Claude API - NO TOKEN LIMITS!
     */
    request(method: string, params: SamplingRequest['params']): Promise<SamplingResponse>;
    /**
     * Check if the client is connected
     */
    isReady(): boolean;
    /**
     * Disconnect the client
     */
    disconnect(): void;
}
/**
 * Get or create the Claude API client
 */
export declare function getMCPClient(): ClaudeAPIClient;
/**
 * Execute a prompt via Claude API
 * TEAM_MEMBER 3 FIX: Real Claude API calls with model selection and NO TOKEN LIMITS!
 *
 * @param params - The prompt parameters including content and configuration
 * @returns The response from Claude API
 */
export declare function executePrompt(params: PromptParams): Promise<PromptResponse>;
/**
 * Build context string from various sources
 */
export declare function buildContext(contextParams: {
    memories?: string[];
    files?: string[];
    codebase?: boolean;
}): Promise<string>;
/**
 * Stream event types for the live broadcaster
 * - claudeBrainFart: thinking block chunks (reasoning visible to user)
 * - actualWordVomit: response text chunks (actual answer)
 * - shitsDone: stream complete with final stats
 * - ohCrapError: something went wrong
 */
export type BrainDumpEventType = 'claudeBrainFart' | 'actualWordVomit' | 'shitsDone' | 'ohCrapError';
export interface BrainDumpEvent {
    type: BrainDumpEventType;
    data: {
        thinking?: string;
        text?: string;
        fullThinking?: string;
        fullResponse?: string;
        totalTokens?: number;
        inputTokens?: number;
        outputTokens?: number;
        model?: string;
        error?: string;
        code?: string;
        timestamp: string;
    };
}
export type BrainDumpCallback = (event: BrainDumpEvent) => void;
/**
 * Streaming parameters - same as PromptParams but with callback
 */
export interface LiveShitParams extends PromptParams {
    onBrainDump: BrainDumpCallback;
}
/**
 * liveShitBroadcaster - Streams Claude responses in REAL TIME!
 *
 * Uses the Anthropic SDK's messages.stream() method to get:
 * - Thinking blocks as they're generated (extended thinking)
 * - Response text chunks as they stream in
 * - Final statistics when done
 *
 * TEAM_MEMBER 2's MASTERPIECE for Team Member 1's frontend!
 */
export declare function liveShitBroadcaster(params: LiveShitParams): Promise<PromptResponse>;
/**
 * Get the raw Anthropic client for streaming
 * This is needed because messages.stream() is on the Anthropic class directly
 */
export declare function getAnthropicClient(): Anthropic | null;
/**
 * catchClaudesThoughts - Helper to extract thinking from a full response
 * Useful for non-streaming responses that include thinking blocks
 */
export declare function catchClaudesThoughts(content: any[]): {
    thinking: string[];
    text: string;
};
declare const _default: {
    executePrompt: typeof executePrompt;
    getMCPClient: typeof getMCPClient;
    buildContext: typeof buildContext;
    liveShitBroadcaster: typeof liveShitBroadcaster;
    getAnthropicClient: typeof getAnthropicClient;
    catchClaudesThoughts: typeof catchClaudesThoughts;
};
export default _default;
//# sourceMappingURL=promptExecutor.d.ts.map