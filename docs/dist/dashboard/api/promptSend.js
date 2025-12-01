/**
 * promptSend.ts - Direct Prompting API for SpecMem Dashboard
 *
 * Provides endpoints for sending prompts to Claude via MCP sampling,
 * with support for context injection (memories, files, codebase).
 *
 * Phase 4 Implementation - Direct Prompting Interface
 */
// @ts-ignore - express types
import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
import { executePrompt, liveShitBroadcaster } from '../../mcp/promptExecutor.js';
// ============================================================================
// Zod Validation Schemas
// ============================================================================
const PromptContextSchema = z.object({
    memories: z.array(z.string().uuid()).optional(),
    files: z.array(z.string()).optional(),
    codebase: z.boolean().optional()
});
// TEAM_MEMBER 3 FIX: Remove token limits - make everything UNLIMITED!
const PromptConfigSchema = z.object({
    maxTokens: z.number().int().min(100).optional(), // No max limit - UNLIMITED by default
    intelligencePriority: z.number().min(0).max(1).optional().default(0.8),
    speedPriority: z.number().min(0).max(1).optional().default(0.5),
    costPriority: z.number().min(0).max(1).optional().default(0.3),
    // TEAM_MEMBER 3 FIX: Add model selection support
    model: z.string().optional(), // e.g., 'claude-3-5-sonnet', 'claude-4', 'opus', 'haiku'
    temperature: z.number().min(0).max(1).optional().default(0.7),
    systemPrompt: z.string().optional()
});
const SendPromptSchema = z.object({
    prompt: z.string().min(1).max(100000),
    context: PromptContextSchema.optional(),
    config: PromptConfigSchema.optional()
});
const PromptHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0)
});
// ============================================================================
// PROJECT-SCOPED In-Memory Conversation History
// Prevents cross-project history pollution
// ============================================================================
const conversationHistoryByProject = new Map();
const MAX_HISTORY_SIZE = 100;
/**
 * Get current project path for cache scoping
 */
function getPromptProjectPath() {
    return process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
}
/**
 * Get project-scoped conversation history map
 */
function getConversationHistory() {
    const projectPath = getPromptProjectPath();
    if (!conversationHistoryByProject.has(projectPath)) {
        conversationHistoryByProject.set(projectPath, new Map());
    }
    return conversationHistoryByProject.get(projectPath);
}
// Legacy reference for backwards compatibility
const conversationHistory = {
    get(key) { return getConversationHistory().get(key); },
    set(key, value) { getConversationHistory().set(key, value); },
    has(key) { return getConversationHistory().has(key); },
    values() { return getConversationHistory().values(); }
};
// ============================================================================
// Prompt Send Router
// ============================================================================
export function createPromptSendRouter(db, requireAuth) {
    const router = Router();
    /**
     * POST /api/prompt/send - Send a prompt to Claude via MCP sampling
     */
    router.post('/send', requireAuth, async (req, res) => {
        const startTime = Date.now();
        try {
            // Validate request body
            const parseResult = SendPromptSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message
                    }))
                });
                return;
            }
            const { prompt, context, config } = parseResult.data;
            const historyId = uuidv4();
            // Create history entry
            const historyEntry = {
                id: historyId,
                prompt,
                response: '',
                context: context ? {
                    memoryIds: context.memories,
                    filePaths: context.files,
                    includeCodebase: context.codebase
                } : undefined,
                config: config ? {
                    maxTokens: config.maxTokens,
                    intelligencePriority: config.intelligencePriority,
                    speedPriority: config.speedPriority
                } : undefined,
                status: 'pending',
                createdAt: new Date()
            };
            // Add to history
            const sessionId = req.session?.id || 'default';
            if (!conversationHistory.has(sessionId)) {
                conversationHistory.set(sessionId, []);
            }
            const history = conversationHistory.get(sessionId);
            history.unshift(historyEntry);
            // Trim history if too large
            if (history.length > MAX_HISTORY_SIZE) {
                history.splice(MAX_HISTORY_SIZE);
            }
            logger.info({ historyId, promptLength: prompt.length }, 'Processing prompt request');
            // Build context from memories, files, and codebase
            let contextContent = '';
            // Fetch memories if specified
            // PROJECT ISOLATION: Only fetch memories from current project
            if (context?.memories && context.memories.length > 0 && db) {
                try {
                    const projectPath = getProjectPathForInsert();
                    const memoryResults = await db.query('SELECT id, content, memory_type, importance, tags FROM memories WHERE id = ANY($1) AND project_path = $2', [context.memories, projectPath]);
                    if (memoryResults.rows.length > 0) {
                        contextContent += '\n\n## Relevant Memories:\n';
                        for (const mem of memoryResults.rows) {
                            contextContent += `\n### Memory (${mem.memory_type}, ${mem.importance}):\n`;
                            contextContent += `Tags: ${mem.tags?.join(', ') || 'none'}\n`;
                            contextContent += `${mem.content}\n`;
                        }
                    }
                }
                catch (error) {
                    logger.warn({ error, memoryIds: context.memories }, 'Failed to fetch memories for context');
                }
            }
            // Fetch file contents if specified
            if (context?.files && context.files.length > 0) {
                const fs = await import('fs/promises');
                contextContent += '\n\n## File Contents:\n';
                for (const filePath of context.files) {
                    try {
                        // Security: Only allow files within the project directory
                        const resolvedPath = require('path').resolve(filePath);
                        if (!resolvedPath.startsWith(process.cwd())) {
                            logger.warn({ filePath }, 'Attempted to access file outside project directory');
                            continue;
                        }
                        const content = await fs.readFile(resolvedPath, 'utf-8');
                        const truncatedContent = content.length > 10000
                            ? content.substring(0, 10000) + '\n... (truncated)'
                            : content;
                        contextContent += `\n### File: ${filePath}\n\`\`\`\n${truncatedContent}\n\`\`\`\n`;
                    }
                    catch (error) {
                        logger.warn({ error, filePath }, 'Failed to read file for context');
                    }
                }
            }
            // Add codebase context if requested
            if (context?.codebase) {
                contextContent += '\n\n## Codebase Context:\n';
                contextContent += 'You have access to the SpecMem MCP Server codebase. ';
                contextContent += 'This is a PostgreSQL-backed memory system with semantic search capabilities.\n';
            }
            // Execute the prompt via Claude API - TEAM_MEMBER 3 FIX: Real API with model support!
            const promptParams = {
                prompt: contextContent ? `${contextContent}\n\n---\n\n${prompt}` : prompt,
                config: {
                    // UNLIMITED tokens by default - no more artificial restrictions!
                    maxTokens: config?.maxTokens || 128000,
                    intelligencePriority: config?.intelligencePriority || 0.8,
                    speedPriority: config?.speedPriority || 0.5,
                    costPriority: config?.costPriority || 0.3,
                    // TEAM_MEMBER 3 FIX: Model selection support
                    model: config?.model || 'claude-3-5-sonnet',
                    temperature: config?.temperature || 0.7,
                    systemPrompt: config?.systemPrompt
                }
            };
            const result = await executePrompt(promptParams);
            const duration = Date.now() - startTime;
            // Update history entry
            historyEntry.response = result.content;
            historyEntry.tokensUsed = result.tokensUsed;
            historyEntry.duration = duration;
            historyEntry.status = 'success';
            // Persist to database if available
            if (db) {
                try {
                    const projectPath = getProjectPathForInsert();
                    await db.query(`INSERT INTO prompt_history (id, session_id, prompt, response, context, config, tokens_used, duration_ms, status, project_path)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                        historyId,
                        sessionId,
                        prompt,
                        result.content,
                        JSON.stringify(historyEntry.context || {}),
                        JSON.stringify(historyEntry.config || {}),
                        result.tokensUsed || 0,
                        duration,
                        'success',
                        projectPath
                    ]);
                }
                catch (dbError) {
                    logger.warn({ dbError }, 'Failed to persist prompt history to database');
                }
            }
            logger.info({ historyId, duration, tokensUsed: result.tokensUsed }, 'Prompt executed successfully');
            res.json({
                success: true,
                id: historyId,
                response: result.content,
                tokensUsed: result.tokensUsed,
                duration,
                model: result.model
            });
        }
        catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            logger.error({ error, duration }, 'Error executing prompt');
            res.status(500).json({
                success: false,
                error: 'Failed to execute prompt',
                message: errorMessage,
                duration
            });
        }
    });
    // ============================================================================
    // TEAM_MEMBER 2's SSE STREAMING ENDPOINT - blastThisShitLive()
    // Real-time streaming of Claude responses with thinking blocks!
    // ============================================================================
    /**
     * POST /api/prompt/streamLive - Stream Claude response via SSE
     *
     * TEAM_MEMBER 2's MASTERPIECE! Streams Claude responses in real-time using
     * Server-Sent Events (SSE). Frontend can listen for:
     * - claudeBrainFart: thinking chunks
     * - actualWordVomit: response text chunks
     * - shitsDone: completion with full response
     * - ohCrapError: error occurred
     */
    router.post('/streamLive', requireAuth, async (req, res) => {
        const startTime = Date.now();
        try {
            // Validate request body
            const parseResult = SendPromptSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid request body',
                    details: parseResult.error.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message
                    }))
                });
                return;
            }
            const { prompt, context, config } = parseResult.data;
            const streamId = uuidv4();
            logger.info({ streamId, promptLength: prompt.length }, 'Starting LIVE STREAM request');
            // Set SSE headers - THIS IS THE MAGIC!
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
            res.flushHeaders();
            // Helper to blast SSE events - yeetTheEvent()
            const yeetTheEvent = (eventType, data) => {
                res.write(`event: ${eventType}\n`);
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            };
            // Send initial connection event
            yeetTheEvent('connected', {
                streamId,
                message: 'Stream connected, waiting for Claude...',
                timestamp: new Date().toISOString()
            });
            // Build context from memories, files, and codebase (same as /send)
            let contextContent = '';
            // Fetch memories if specified
            // PROJECT ISOLATION: Only fetch memories from current project
            if (context?.memories && context.memories.length > 0 && db) {
                try {
                    const projectPath = getProjectPathForInsert();
                    const memoryResults = await db.query('SELECT id, content, memory_type, importance, tags FROM memories WHERE id = ANY($1) AND project_path = $2', [context.memories, projectPath]);
                    if (memoryResults.rows.length > 0) {
                        contextContent += '\n\n## Relevant Memories:\n';
                        for (const mem of memoryResults.rows) {
                            contextContent += `\n### Memory (${mem.memory_type}, ${mem.importance}):\n`;
                            contextContent += `Tags: ${mem.tags?.join(', ') || 'none'}\n`;
                            contextContent += `${mem.content}\n`;
                        }
                    }
                }
                catch (error) {
                    logger.warn({ error, memoryIds: context.memories }, 'Failed to fetch memories for stream context');
                }
            }
            // Fetch file contents if specified
            if (context?.files && context.files.length > 0) {
                const fs = await import('fs/promises');
                contextContent += '\n\n## File Contents:\n';
                for (const filePath of context.files) {
                    try {
                        const resolvedPath = require('path').resolve(filePath);
                        if (!resolvedPath.startsWith(process.cwd())) {
                            logger.warn({ filePath }, 'Attempted to access file outside project directory');
                            continue;
                        }
                        const content = await fs.readFile(resolvedPath, 'utf-8');
                        const truncatedContent = content.length > 10000
                            ? content.substring(0, 10000) + '\n... (truncated)'
                            : content;
                        contextContent += `\n### File: ${filePath}\n\`\`\`\n${truncatedContent}\n\`\`\`\n`;
                    }
                    catch (error) {
                        logger.warn({ error, filePath }, 'Failed to read file for stream context');
                    }
                }
            }
            // Add codebase context if requested
            if (context?.codebase) {
                contextContent += '\n\n## Codebase Context:\n';
                contextContent += 'You have access to the SpecMem MCP Server codebase. ';
                contextContent += 'This is a PostgreSQL-backed memory system with semantic search capabilities.\n';
            }
            // Build streaming params
            const streamParams = {
                prompt: contextContent ? `${contextContent}\n\n---\n\n${prompt}` : prompt,
                config: {
                    maxTokens: config?.maxTokens || 128000,
                    intelligencePriority: config?.intelligencePriority || 0.8,
                    speedPriority: config?.speedPriority || 0.5,
                    costPriority: config?.costPriority || 0.3,
                    model: config?.model || 'claude-3-5-sonnet',
                    temperature: config?.temperature || 0.7,
                    systemPrompt: config?.systemPrompt
                },
                // THE CALLBACK - blastEventsToFrontend()
                onBrainDump: (event) => {
                    // Translate our internal events to SSE events
                    yeetTheEvent(event.type, event.data);
                }
            };
            // Start the LIVE STREAM! This is where the magic happens!
            await liveShitBroadcaster(streamParams);
            const duration = Date.now() - startTime;
            logger.info({ streamId, duration }, 'LIVE STREAM completed successfully');
            // Close the SSE stream
            res.end();
        }
        catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            logger.error({ error, duration }, 'LIVE STREAM failed');
            // Try to send error event if headers not sent
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to start stream',
                    message: errorMessage,
                    duration
                });
            }
            else {
                // Headers already sent (stream started), send error event
                try {
                    res.write(`event: ohCrapError\n`);
                    res.write(`data: ${JSON.stringify({
                        error: errorMessage,
                        code: 'STREAM_ERROR',
                        timestamp: new Date().toISOString()
                    })}\n\n`);
                    res.end();
                }
                catch (e) {
                    // Client probably disconnected, nothing we can do
                }
            }
        }
    });
    /**
     * GET /api/prompt/history - Get conversation history
     */
    router.get('/history', requireAuth, async (req, res) => {
        try {
            const parseResult = PromptHistoryQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid query parameters',
                    details: parseResult.error.issues.map(i => ({
                        path: i.path.join('.'),
                        message: i.message
                    }))
                });
                return;
            }
            const { limit, offset } = parseResult.data;
            const sessionId = req.session?.id || 'default';
            // Try database first
            if (db) {
                try {
                    const projectPath = getProjectPathForInsert();
                    const result = await db.query(`SELECT id, prompt, response, context, config, tokens_used, duration_ms as duration, status, error_message, created_at
             FROM prompt_history
             WHERE session_id = $1 AND project_path = $2
             ORDER BY created_at DESC
             LIMIT $3 OFFSET $4`, [sessionId, projectPath, limit, offset]);
                    const countResult = await db.query('SELECT COUNT(*) as total FROM prompt_history WHERE session_id = $1 AND project_path = $2', [sessionId, projectPath]);
                    res.json({
                        success: true,
                        history: result.rows.map((row) => ({
                            id: row.id,
                            prompt: row.prompt,
                            response: row.response,
                            context: row.context,
                            config: row.config,
                            tokensUsed: row.tokens_used,
                            duration: row.duration,
                            status: row.status,
                            errorMessage: row.error_message,
                            createdAt: row.created_at
                        })),
                        total: parseInt(countResult.rows[0]?.total || '0', 10),
                        limit,
                        offset
                    });
                    return;
                }
                catch (dbError) {
                    logger.warn({ dbError }, 'Failed to fetch history from database, using in-memory');
                }
            }
            // Fall back to in-memory history
            const history = conversationHistory.get(sessionId) || [];
            const paginatedHistory = history.slice(offset, offset + limit);
            res.json({
                success: true,
                history: paginatedHistory,
                total: history.length,
                limit,
                offset
            });
        }
        catch (error) {
            logger.error({ error }, 'Error fetching prompt history');
            res.status(500).json({
                success: false,
                error: 'Failed to fetch prompt history'
            });
        }
    });
    /**
     * DELETE /api/prompt/history/:id - Delete a specific conversation entry
     */
    router.delete('/history/:id', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const sessionId = req.session?.id || 'default';
            // Delete from database if available
            if (db) {
                try {
                    const projectPath = getProjectPathForInsert();
                    await db.query('DELETE FROM prompt_history WHERE id = $1 AND session_id = $2 AND project_path = $3', [id, sessionId, projectPath]);
                }
                catch (dbError) {
                    logger.warn({ dbError, id }, 'Failed to delete from database');
                }
            }
            // Also delete from in-memory
            const history = conversationHistory.get(sessionId);
            if (history) {
                const index = history.findIndex(h => h.id === id);
                if (index >= 0) {
                    history.splice(index, 1);
                }
            }
            res.json({
                success: true,
                message: 'Conversation entry deleted'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error deleting conversation entry');
            res.status(500).json({
                success: false,
                error: 'Failed to delete conversation entry'
            });
        }
    });
    /**
     * DELETE /api/prompt/history - Clear all conversation history
     */
    router.delete('/history', requireAuth, async (req, res) => {
        try {
            const sessionId = req.session?.id || 'default';
            // Clear from database if available
            if (db) {
                try {
                    const projectPath = getProjectPathForInsert();
                    const result = await db.query('DELETE FROM prompt_history WHERE session_id = $1 AND project_path = $2', [sessionId, projectPath]);
                    logger.info({ sessionId, deleted: result.rowCount }, 'Cleared prompt history from database');
                }
                catch (dbError) {
                    logger.warn({ dbError }, 'Failed to clear history from database');
                }
            }
            // Clear in-memory history
            conversationHistory.set(sessionId, []);
            res.json({
                success: true,
                message: 'Conversation history cleared'
            });
        }
        catch (error) {
            logger.error({ error }, 'Error clearing conversation history');
            res.status(500).json({
                success: false,
                error: 'Failed to clear conversation history'
            });
        }
    });
    return router;
}
export default createPromptSendRouter;
//# sourceMappingURL=promptSend.js.map