/**
 * promptExecutor.ts - Real  API Prompt Executor
 *
 * Executes prompts via direct   API calls.
 * Supports multiple  models (3.5 Sonnet, 4.0, Opus) with UNLIMITED tokens.
 *
 * Phase 4 Implementation - Direct  API Integration
 *
 * TEAM_MEMBER 3 FIX: Real  API integration with model switching and NO TOKEN LIMITS
 */
import { logger } from '../utils/logger.js';
import  from '@anthropic-ai/sdk';
export const MODEL_MAP = {
    //  3.5 Sonnet - Default balanced model
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'sonnet-3.5': 'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
    //  4 Sonnet - Latest and greatest
    'claude-4': 'claude-sonnet-4-20250514',
    'claude-4-sonnet': 'claude-sonnet-4-20250514',
    'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
    // Opus 4 - Most capable
    'opus': 'claude-opus-4-20250514',
    'claude-opus-4': 'claude-opus-4-20250514',
    'claude-opus-4-20250514': 'claude-opus-4-20250514',
    // Haiku - Fast and efficient
    'haiku': 'claude-3-5-haiku-20241022',
    'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
    'claude-3-5-haiku-20241022': 'claude-3-5-haiku-20241022',
    // Legacy model names for backward compatibility
    'claude-3-opus-20240229': 'claude-opus-4-20250514',
    'claude-3-haiku-20240307': 'claude-3-5-haiku-20241022',
};
// ============================================================================
//  API Client Singleton - REAL API calls, no more simulation!
// ============================================================================
let claudeClientInstance = null;
/**
 * Real  API Client
 * TEAM_MEMBER 3 FIX: Actually calls  API instead of simulating responses
 */
class APIClient {
    anthropic = null;
    isConnected = false;
    constructor() {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
            this.anthropic = new ({ apiKey });
            this.isConnected = true;
            logger.info(' API Client initialized - REAL API calls enabled!');
        }
        else {
            logger.warn('ANTHROPIC_API_KEY not set -  API calls will fail. Set the env var!');
            this.isConnected = false;
        }
    }
    /**
     * Resolve model name to actual API model ID
     */
    resolveModel(modelName) {
        if (!modelName)
            return MODEL_MAP['claude-3-5-sonnet'];
        return MODEL_MAP[modelName] || MODEL_MAP['claude-3-5-sonnet'];
    }
    /**
     * Send a real request to  API - NO TOKEN LIMITS!
     */
    async request(method, params) {
        if (method !== 'sampling/createMessage') {
            throw new Error(`Unsupported method: ${method}`);
        }
        // Resolve the model from preferences
        const modelHint = params.modelPreferences?.hints?.[0]?.name;
        const model = this.resolveModel(modelHint);
        logger.info({
            method,
            model,
            messageCount: params.messages.length,
            maxTokens: params.maxTokens || 'UNLIMITED'
        }, 'Sending REAL request to  API');
        if (!this.anthropic) {
            throw new Error(' API client not initialized. Set ANTHROPIC_API_KEY environment variable.');
        }
        try {
            // Build messages for  API
            const messages = params.messages.map(msg => ({
                role: msg.role,
                content: msg.content.text
            }));
            // UNLIMITED tokens by default - use max allowed by API (128K for most models)
            // Team Member 3 FIX: No more artificial limits!
            const maxTokens = params.maxTokens || 128000;
            const response = await this.anthropic.messages.create({
                model,
                max_tokens: maxTokens,
                system: params.systemPrompt || 'You are a helpful AI assistant.',
                messages,
                temperature: params.temperature || 0.7,
                thinking: params.enableThinking ? {
                    type: 'enabled',
                    budget_tokens: 10000
                } : undefined,
            });
            // Extract text and thinking from response
            const textContent = response.content.find(c => c.type === 'text');
            const responseText = textContent?.type === 'text' ? textContent.text : '';
            // Extract thinking blocks if present
            const thinkingBlocks = response.content
                .filter(c => c.type === 'thinking')
                .map(c => c.type === 'thinking' ? c.thinking : '')
                .filter(Boolean);
            logger.info({
                model: response.model,
                inputTokens: response.usage?.input_tokens,
                outputTokens: response.usage?.output_tokens,
                stopReason: response.stop_reason,
                thinkingBlocks: thinkingBlocks.length
            }, ' API response received');
            return {
                model: response.model,
                stopReason: response.stop_reason === 'end_turn' ? 'end_turn' : response.stop_reason,
                role: 'assistant',
                thinking: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
                content: {
                    type: 'text',
                    text: responseText
                },
                usage: {
                    inputTokens: response.usage?.input_tokens || 0,
                    outputTokens: response.usage?.output_tokens || 0
                }
            };
        }
        catch (error) {
            logger.error({ error: error.message }, ' API request failed');
            throw error;
        }
    }
    /**
     * Check if the client is connected
     */
    isReady() {
        return this.isConnected && this.anthropic !== null;
    }
    /**
     * Disconnect the client
     */
    disconnect() {
        this.isConnected = false;
        this.anthropic = null;
        logger.info(' API Client disconnected');
    }
}
/**
 * Get or create the  API client
 */
export function getMCPClient() {
    if (!claudeClientInstance) {
        claudeClientInstance = new APIClient();
    }
    return claudeClientInstance;
}
// ============================================================================
// Main Execute Function
// ============================================================================
/**
 * Execute a prompt via  API
 * TEAM_MEMBER 3 FIX: Real  API calls with model selection and NO TOKEN LIMITS!
 *
 * @param params - The prompt parameters including content and configuration
 * @returns The response from  API
 */
export async function executePrompt(params) {
    const startTime = Date.now();
    try {
        const client = getMCPClient();
        if (!client.isReady()) {
            throw new Error(' API client not initialized. Set ANTHROPIC_API_KEY environment variable.');
        }
        // Build the sampling request
        const messages = [];
        // Add conversation history if provided
        if (params.conversationHistory) {
            for (const msg of params.conversationHistory) {
                messages.push({
                    role: msg.role,
                    content: {
                        type: 'text',
                        text: msg.content
                    }
                });
            }
        }
        // Add the current prompt
        messages.push({
            role: 'user',
            content: {
                type: 'text',
                text: params.prompt
            }
        });
        // Determine which model to use - TEAM_MEMBER 3 FIX: Support model switching!
        const modelName = params.config.model || 'claude-3-5-sonnet';
        // Build the sampling request - NO TOKEN LIMITS by default!
        const samplingRequest = {
            messages,
            modelPreferences: {
                hints: [{ name: modelName }], // Use selected model
                intelligencePriority: params.config.intelligencePriority,
                speedPriority: params.config.speedPriority,
                costPriority: params.config.costPriority
            },
            // UNLIMITED tokens - default to 128000 if not specified
            maxTokens: params.config.maxTokens || 128000,
            includeContext: params.config.includeContext || 'thisServer',
            temperature: params.config.temperature || 0.7
        };
        if (params.config.systemPrompt) {
            samplingRequest.systemPrompt = params.config.systemPrompt;
        }
        // Execute the request - REAL  API call!
        const response = await client.request('sampling/createMessage', samplingRequest);
        const duration = Date.now() - startTime;
        // Use real token counts from API response
        const tokensUsed = response.usage
            ? response.usage.inputTokens + response.usage.outputTokens
            : estimateTokens(params.prompt + response.content.text);
        logger.info({
            duration,
            model: response.model,
            stopReason: response.stopReason,
            responseLength: response.content.text.length,
            tokensUsed
        }, ' API request completed successfully');
        return {
            content: response.content.text,
            model: response.model,
            stopReason: response.stopReason,
            tokensUsed
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error({ error, duration }, ' API request failed');
        throw error;
    }
}
/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text) {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
}
/**
 * Build context string from various sources
 */
export async function buildContext(contextParams) {
    let context = '';
    // This function can be extended to fetch and format context
    // from memories, files, and codebase
    if (contextParams.memories && contextParams.memories.length > 0) {
        context += `[${contextParams.memories.length} memories included]\n`;
    }
    if (contextParams.files && contextParams.files.length > 0) {
        context += `[${contextParams.files.length} files included]\n`;
    }
    if (contextParams.codebase) {
        context += '[Codebase context enabled]\n';
    }
    return context;
}
/**
 * liveShitBroadcaster - Streams  responses in REAL TIME!
 *
 * Uses the  SDK's messages.stream() method to get:
 * - Thinking blocks as they're generated (extended thinking)
 * - Response text chunks as they stream in
 * - Final statistics when done
 *
 * TEAM_MEMBER 2's MASTERPIECE for Team Member 1's frontend!
 */
export async function liveShitBroadcaster(params) {
    const startTime = Date.now();
    const { onBrainDump } = params;
    // Accumulators for full response
    let fullThinking = '';
    let fullResponse = '';
    let finalModel = '';
    let finalUsage = { inputTokens: 0, outputTokens: 0 };
    try {
        const client = getMCPClient();
        if (!client.isReady()) {
            throw new Error(' API client not initialized. Set ANTHROPIC_API_KEY environment variable.');
        }
        // Build messages array
        const messages = [];
        // Add conversation history if provided
        if (params.conversationHistory) {
            for (const msg of params.conversationHistory) {
                messages.push({
                    role: msg.role,
                    content: msg.content
                });
            }
        }
        // Add the current prompt
        messages.push({
            role: 'user',
            content: params.prompt
        });
        // Resolve model
        const modelName = params.config.model || 'claude-3-5-sonnet';
        const resolvedModel = MODEL_MAP[modelName] || MODEL_MAP['claude-3-5-sonnet'];
        // Get the raw  client from our wrapper
        const anthropicClient = getClient();
        if (!anthropicClient) {
            throw new Error(' client not available. Check ANTHROPIC_API_KEY.');
        }
        logger.info({
            model: resolvedModel,
            messageCount: messages.length,
            maxTokens: params.config.maxTokens || 128000,
            enableThinking: true
        }, 'Starting LIVE STREAM to  API');
        // Check if this model supports extended thinking
        const supportsThinking = resolvedModel.includes('opus') ||
            resolvedModel.includes('sonnet-4') ||
            resolvedModel.includes('3-5-sonnet');
        // Use messages.stream() for real-time streaming!
        const streamOptions = {
            model: resolvedModel,
            max_tokens: params.config.maxTokens || 128000,
            system: params.config.systemPrompt || 'You are a helpful AI assistant.',
            messages,
            temperature: supportsThinking ? 1 : (params.config.temperature || 0.7), // thinking requires temp=1
        };
        // Add thinking config if supported
        if (supportsThinking) {
            streamOptions.thinking = {
                type: 'enabled',
                budget_tokens: 16000
            };
        }
        const stream = anthropicClient.messages.stream(streamOptions);
        // Process stream events
        for await (const event of stream) {
            if (event.type === 'content_block_delta') {
                // Handle thinking deltas
                if (event.delta.type === 'thinking_delta') {
                    const thinkingChunk = event.delta.thinking;
                    fullThinking += thinkingChunk;
                    onBrainDump({
                        type: 'claudeBrainFart',
                        data: {
                            thinking: thinkingChunk,
                            timestamp: new Date().toISOString()
                        }
                    });
                }
                // Handle text deltas
                else if (event.delta.type === 'text_delta') {
                    const textChunk = event.delta.text;
                    fullResponse += textChunk;
                    onBrainDump({
                        type: 'actualWordVomit',
                        data: {
                            text: textChunk,
                            timestamp: new Date().toISOString()
                        }
                    });
                }
            }
            // Capture message metadata
            else if (event.type === 'message_start') {
                finalModel = event.message.model;
            }
            else if (event.type === 'message_delta') {
                if (event.usage) {
                    finalUsage.outputTokens = event.usage.output_tokens;
                }
            }
        }
        // Get final message for complete usage stats
        const finalMessage = await stream.finalMessage();
        finalUsage.inputTokens = finalMessage.usage?.input_tokens || 0;
        finalUsage.outputTokens = finalMessage.usage?.output_tokens || 0;
        const duration = Date.now() - startTime;
        const totalTokens = finalUsage.inputTokens + finalUsage.outputTokens;
        logger.info({
            duration,
            model: finalModel,
            inputTokens: finalUsage.inputTokens,
            outputTokens: finalUsage.outputTokens,
            thinkingLength: fullThinking.length,
            responseLength: fullResponse.length
        }, 'LIVE STREAM completed successfully');
        // Send completion event
        onBrainDump({
            type: 'shitsDone',
            data: {
                fullThinking,
                fullResponse,
                totalTokens,
                inputTokens: finalUsage.inputTokens,
                outputTokens: finalUsage.outputTokens,
                model: finalModel,
                timestamp: new Date().toISOString()
            }
        });
        return {
            content: fullResponse,
            model: finalModel,
            tokensUsed: totalTokens,
            stopReason: finalMessage.stop_reason || 'end_turn'
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        logger.error({ error: error.message, duration }, 'LIVE STREAM failed');
        // Send error event
        onBrainDump({
            type: 'ohCrapError',
            data: {
                error: error.message || 'Unknown streaming error',
                code: error.status || 'STREAM_ERROR',
                timestamp: new Date().toISOString()
            }
        });
        throw error;
    }
}
/**
 * Get the raw  client for streaming
 * This is needed because messages.stream() is on the  class directly
 */
export function getClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return null;
    }
    return new ({ apiKey });
}
/**
 * catchsThoughts - Helper to extract thinking from a full response
 * Useful for non-streaming responses that include thinking blocks
 */
export function catchsThoughts(content) {
    const thinking = [];
    let text = '';
    for (const block of content) {
        if (block.type === 'thinking') {
            thinking.push(block.thinking);
        }
        else if (block.type === 'text') {
            text = block.text;
        }
    }
    return { thinking, text };
}
export default {
    executePrompt,
    getMCPClient,
    buildContext,
    liveShitBroadcaster,
    getClient,
    catchsThoughts
};
//# sourceMappingURL=promptExecutor.js.map