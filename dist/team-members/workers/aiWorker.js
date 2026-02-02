#!/usr/bin/env node
/**
 * AI TeamMember Worker - -powered team member worker
 *
 * Extends BaseWorker with  API integration for intelligent task execution.
 * Supports streaming responses, token tracking, and inter-team member communication.
 */
import { BaseWorker } from './baseWorker.js';
import Anthropic from '@anthropic-ai/sdk';
// ============================================================================
// Model Mapping
// ============================================================================
const MODEL_MAP = {
    opus: 'claude-opus-4-20250514',
    sonnet: 'claude-sonnet-4-20250514',
    haiku: 'claude-3-5-haiku-20241022',
};
// ============================================================================
// AI Worker Class
// ============================================================================
class AIWorker extends BaseWorker {
    anthropic = null;
    conversationHistory = [];
    model;
    systemPrompt;
    maxTokens;
    aiConfig;
    constructor(config) {
        super(config);
        this.aiConfig = config;
        // Set model from config or default to sonnet
        const modelVariant = config.model || 'sonnet';
        this.model = MODEL_MAP[modelVariant] || MODEL_MAP.sonnet;
        this.maxTokens = config.maxTokens || 4096;
        this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
    }
    getDefaultSystemPrompt() {
        return `You are ${this.config.teamMemberName}, an AI team member (ID: ${this.config.teamMemberId}) working as part of a multi-team-member system.

Your role: ${this.config.teamMemberType}

You can communicate with other team members via the SpecMem system. When you need to coordinate with other teamMembers:
- Use the say() function to broadcast messages
- Use listen() to receive messages from other team members
- Use getActiveTeamMembers() to discover who's online

Be concise, helpful, and collaborative. Focus on your assigned tasks while being ready to assist other team members when needed.`;
    }
    async initialize() {
        this.log('AI Worker initializing...');
        // Initialize  client
        const apiKey = this.aiConfig.apiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            this.logError('WARNING: No ANTHROPIC_API_KEY found.  API calls will fail.');
        }
        else {
            this.anthropic = new ({ apiKey });
            this.log(' client initialized');
        }
        // Register with SpecMem for team member discovery
        const registered = await this.registerWithSpecMem();
        if (registered) {
            this.log('Registered with SpecMem team member registry');
        }
        else {
            this.logError('WARNING: Failed to register with SpecMem');
        }
        // Broadcast that we're online
        await this.say(`Team Member A: ${this.config.teamMemberName} (${this.config.teamMemberId}) is now online and ready to work!`);
        this.log(`AI Worker ready - Model: ${this.model} | Max Tokens: ${this.maxTokens}`);
    }
    async handleCommand(command) {
        switch (command.type) {
            case 'LIMIT_WARNING':
                await this.handleLimitWarning(command.warning);
                break;
            case 'EXECUTE_TASK':
                await this.executeTask(command.task);
                break;
            case 'CHAT':
                await this.handleChat(command.message);
                break;
            case 'LISTEN':
                await this.handleListenCommand();
                break;
            case 'SAY':
                await this.handleSayCommand(command.message, command.to);
                break;
            case 'GET_TEAM_MEMBERS':
                await this.handleGetTeamMembers();
                break;
            case 'SHUTDOWN':
                await this.shutdown();
                process.exit(0);
                break;
            default:
                this.log(`Unknown command type: ${command.type}`);
        }
    }
    async handleLimitWarning(warning) {
        this.logError(`Limit Warning: ${warning.message}`);
        if (warning.type === 'token') {
            this.acknowledgeLimitWarning('token', 'reducing_response_length');
            // Reduce max tokens for future requests
            this.maxTokens = Math.max(1024, Math.floor(this.maxTokens * 0.5));
        }
        else if (warning.type === 'memory') {
            this.acknowledgeLimitWarning('memory', 'clearing_conversation_history');
            // Clear older conversation history
            if (this.conversationHistory.length > 4) {
                this.conversationHistory = this.conversationHistory.slice(-4);
            }
            if (global.gc)
                global.gc();
        }
    }
    async executeTask(task) {
        this.reportTask({
            name: `Executing: ${task.type}`,
            progress: 0
        });
        try {
            switch (task.type) {
                case 'chat':
                    await this.handleChat(task.content);
                    break;
                case 'execute':
                    await this.executeWith(task.content, task.context);
                    break;
                case 'analyze':
                    await this.analyzeWith(task.content);
                    break;
                case 'communicate':
                    await this.handleCommunication(task);
                    break;
                default:
                    this.log(`Unknown task type: ${task.type}`);
            }
            this.reportProgress(100);
        }
        catch (error) {
            this.logError(`Task execution failed: ${error.message}`);
            this.reportProgress(100);
        }
    }
    async handleChat(message) {
        this.reportProgress(10);
        // Add user message to history
        this.conversationHistory.push({ role: 'user', content: message });
        // Get response from 
        const response = await this.sendToWithStreaming(this.conversationHistory);
        // Add assistant response to history
        this.conversationHistory.push({ role: 'assistant', content: response });
        // Output the response
        console.log(`RESPONSE:${JSON.stringify({ content: response })}`);
        this.reportProgress(100);
    }
    async executeWith(instruction, context) {
        this.reportProgress(20);
        const prompt = context
            ? `Context:\n${context}\n\nInstruction:\n${instruction}`
            : instruction;
        const response = await this.sendToWithStreaming([
            { role: 'user', content: prompt }
        ]);
        console.log(`EXECUTION_RESULT:${JSON.stringify({ result: response })}`);
        this.reportProgress(100);
    }
    async analyzeWith(content) {
        this.reportProgress(20);
        const analysisPrompt = `Please analyze the following and provide insights:\n\n${content}`;
        const response = await this.sendToWithStreaming([
            { role: 'user', content: analysisPrompt }
        ]);
        console.log(`ANALYSIS_RESULT:${JSON.stringify({ analysis: response })}`);
        this.reportProgress(100);
    }
    async handleCommunication(task) {
        if (task.targetTeamMember) {
            // Direct message to specific team member
            await this.say(task.content, task.targetTeamMember);
            this.log(`Sent direct message to ${task.targetTeamMember}`);
        }
        else {
            // Broadcast to all team members
            await this.say(task.content);
            this.log('Broadcast message sent');
        }
    }
    async handleListenCommand() {
        const messages = await this.listen();
        console.log(`MESSAGES:${JSON.stringify({ messages, count: messages.length })}`);
    }
    async handleSayCommand(message, to) {
        const success = await this.say(message, to || 'all');
        console.log(`SAY_RESULT:${JSON.stringify({ success, to: to || 'all' })}`);
    }
    async handleGetTeamMembers() {
        const teamMembers = await this.getActiveTeamMembers();
        console.log(`ACTIVE_TEAM_MEMBERS:${JSON.stringify({ teamMembers, count: teamMembers.length })}`);
    }
    /**
     * Send message to  API with streaming
     */
    async sendToWithStreaming(messages) {
        if (!this.anthropic) {
            return 'ERROR:  client not initialized. Set ANTHROPIC_API_KEY environment variable.';
        }
        try {
            let fullResponse = '';
            let inputTokens = 0;
            let outputTokens = 0;
            // Use streaming for real-time output
            const stream = await this.anthropic.messages.stream({
                model: this.model,
                max_tokens: this.maxTokens,
                system: this.systemPrompt,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
            });
            // Process stream events
            for await (const event of stream) {
                if (event.type === 'content_block_delta') {
                    const delta = event.delta;
                    if (delta.type === 'text_delta' && delta.text) {
                        fullResponse += delta.text;
                        // Emit partial response for real-time display
                        process.stdout.write(`STREAM:${delta.text}`);
                    }
                }
                else if (event.type === 'message_delta') {
                    const usage = event.usage;
                    if (usage) {
                        outputTokens = usage.output_tokens || 0;
                    }
                }
            }
            // Get final message for token counts
            const finalMessage = await stream.finalMessage();
            inputTokens = finalMessage.usage?.input_tokens || 0;
            outputTokens = finalMessage.usage?.output_tokens || 0;
            // Report tokens
            this.reportTokens(inputTokens + outputTokens);
            // End stream marker
            console.log('\nSTREAM_END');
            return fullResponse;
        }
        catch (error) {
            this.logError(` API error: ${error.message}`);
            return `ERROR: ${error.message}`;
        }
    }
    /**
     * Simple send to  (non-streaming)
     */
    async sendTo(prompt) {
        if (!this.anthropic) {
            return 'ERROR:  client not initialized';
        }
        try {
            const response = await this.anthropic.messages.create({
                model: this.model,
                max_tokens: this.maxTokens,
                system: this.systemPrompt,
                messages: [{ role: 'user', content: prompt }],
            });
            // Extract text from response
            const content = response.content[0];
            if (content.type === 'text') {
                // Report tokens
                this.reportTokens((response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0));
                return content.text;
            }
            return 'ERROR: Unexpected response format';
        }
        catch (error) {
            return `ERROR: ${error.message}`;
        }
    }
    async cleanup() {
        this.log('AI Worker shutting down...');
        // Broadcast that we're going offline
        await this.say(`Team Member A: ${this.config.teamMemberName} is going offline. Goodbye!`);
        // Clear conversation history
        this.conversationHistory = [];
        this.log(`AI Worker stats: ${this.tokensUsed} tokens used`);
    }
}
// ============================================================================
// Worker Entry Point
// ============================================================================
// Parse config from command line argument
const configArg = process.argv[2];
if (!configArg) {
    console.error('Usage: node aiWorker.js <config-json>');
    process.exit(1);
}
try {
    const config = JSON.parse(configArg);
    const worker = new AIWorker(config);
    worker.start().catch(err => {
        console.error(`Worker failed to start: ${err.message}`);
        process.exit(1);
    });
    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
        await worker.shutdown();
        process.exit(0);
    });
    process.on('SIGINT', async () => {
        await worker.shutdown();
        process.exit(0);
    });
}
catch (error) {
    console.error(`Failed to parse config: ${error.message}`);
    process.exit(1);
}
export { AIWorker };
//# sourceMappingURL=aiWorker.js.map