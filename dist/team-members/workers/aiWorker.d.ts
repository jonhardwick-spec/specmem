#!/usr/bin/env node
/**
 * AI TeamMember Worker - Claude-powered team member worker
 *
 * Extends BaseWorker with Claude API integration for intelligent task execution.
 * Supports streaming responses, token tracking, and inter-team member communication.
 */
import { BaseWorker, WorkerConfig } from './baseWorker.js';
type ModelVariant = 'opus' | 'sonnet' | 'haiku';
interface AIWorkerConfig extends WorkerConfig {
    model?: ModelVariant;
    apiKey?: string;
    systemPrompt?: string;
    maxTokens?: number;
}
interface AITask {
    type: 'chat' | 'execute' | 'analyze' | 'communicate';
    content: string;
    context?: string;
    targetTeamMember?: string;
}
declare class AIWorker extends BaseWorker {
    private anthropic;
    private conversationHistory;
    private model;
    private systemPrompt;
    private maxTokens;
    private aiConfig;
    constructor(config: AIWorkerConfig);
    private getDefaultSystemPrompt;
    protected initialize(): Promise<void>;
    protected handleCommand(command: any): Promise<void>;
    private handleLimitWarning;
    protected executeTask(task: AITask): Promise<void>;
    private handleChat;
    private executeWithClaude;
    private analyzeWithClaude;
    private handleCommunication;
    private handleListenCommand;
    private handleSayCommand;
    private handleGetTeamMembers;
    /**
     * Send message to Claude API with streaming
     */
    private sendToClaudeWithStreaming;
    /**
     * Simple send to Claude (non-streaming)
     */
    sendToClaude(prompt: string): Promise<string>;
    protected cleanup(): Promise<void>;
}
export { AIWorker, AIWorkerConfig, AITask };
//# sourceMappingURL=aiWorker.d.ts.map