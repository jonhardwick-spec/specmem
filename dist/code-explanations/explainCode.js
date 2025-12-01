/**
 * explain_code - Generate and store explanations for code
 *
 * This tool takes a code location, generates an explanation, and stores it
 * for future recall. It supports different explanation types and can
 * reuse existing high-quality explanations.
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { ExplainCodeInput } from './types.js';
/**
 * ExplainCode - Store and manage code explanations
 *
 * Features:
 * - Generate explanations for code locations
 * - Reuse existing high-quality explanations
 * - Track explanation usage
 * - Support multiple explanation types
 */
export class ExplainCode {
    db;
    embeddingProvider;
    name = 'explain_code';
    description = `Store an explanation for a code location. Supports different explanation types:
- general: What the code does
- architectural: How it fits in the system
- algorithmic: Algorithm details
- usage: How to use it
- gotchas: Pitfalls and edge cases
- performance: Performance notes
- security: Security implications
- debugging: Debug tips
- history: Why it exists
- todo: Things needing attention`;
    inputSchema = {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'Path to the file (relative to codebase root)'
            },
            lineStart: {
                type: 'number',
                description: 'Starting line number (optional - for specific code regions)'
            },
            lineEnd: {
                type: 'number',
                description: 'Ending line number (optional)'
            },
            explanationType: {
                type: 'string',
                enum: ['general', 'architectural', 'algorithmic', 'usage', 'gotchas',
                    'performance', 'security', 'debugging', 'history', 'todo'],
                default: 'general',
                description: 'Type of explanation to store'
            },
            context: {
                type: 'string',
                description: 'Additional context about why this explanation is being created'
            },
            forceRegenerate: {
                type: 'boolean',
                default: false,
                description: 'Force creation even if a similar explanation exists'
            }
        },
        required: ['filePath']
    };
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    async execute(params) {
        const validatedParams = ExplainCodeInput.parse(params);
        logger.debug({ filePath: validatedParams.filePath }, 'Creating code explanation');
        try {
            // First, check if we have an existing explanation for this location
            if (!validatedParams.forceRegenerate) {
                const existing = await this.findExistingExplanation(validatedParams.filePath, validatedParams.lineStart, validatedParams.lineEnd, validatedParams.explanationType);
                if (existing && existing.qualityScore >= 0.7) {
                    // Increment use count
                    await this.incrementUseCount(existing.id);
                    logger.debug({
                        explanationId: existing.id,
                        qualityScore: existing.qualityScore
                    }, 'Reusing existing high-quality explanation');
                    return {
                        success: true,
                        explanation: existing,
                        wasReused: true,
                        message: `Reused existing ${existing.explanationType} explanation (quality: ${existing.qualityScore.toFixed(2)})`
                    };
                }
            }
            // Look up the code file
            const codeFile = await this.findCodeFile(validatedParams.filePath);
            // Get code snippet if line range specified
            let codeSnippet;
            if (codeFile && validatedParams.lineStart && validatedParams.lineEnd) {
                codeSnippet = await this.extractCodeSnippet(codeFile.id, validatedParams.lineStart, validatedParams.lineEnd);
            }
            else if (codeFile) {
                // Get first 50 lines as snippet
                codeSnippet = await this.extractCodeSnippet(codeFile.id, 1, 50);
            }
            // For now, we store a placeholder explanation
            // In real use, Claude would provide the explanation text
            const explanationText = validatedParams.context ||
                `Explanation for ${validatedParams.filePath}` +
                    (validatedParams.lineStart ? ` (lines ${validatedParams.lineStart}-${validatedParams.lineEnd})` : '');
            // Generate embedding for the explanation
            const textForEmbedding = this.createEmbeddingText(validatedParams.filePath, explanationText, codeSnippet, validatedParams.explanationType);
            const embedding = await this.embeddingProvider.generateEmbedding(textForEmbedding);
            // Create the explanation record
            const id = uuidv4();
            const now = new Date();
            await this.db.query(`INSERT INTO code_explanations (
          id, code_id, file_path, line_start, line_end,
          code_snippet, explanation_text, explanation_type,
          embedding, quality_score, created_at, updated_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [
                id,
                codeFile?.id ?? null,
                validatedParams.filePath,
                validatedParams.lineStart ?? null,
                validatedParams.lineEnd ?? null,
                codeSnippet ?? null,
                explanationText,
                validatedParams.explanationType,
                embedding?.length > 0 ? `[${embedding.join(',')}]` : null,
                0.5, // Initial quality score
                now,
                now,
                JSON.stringify({ context: validatedParams.context })
            ]);
            // Update access patterns
            if (codeFile) {
                await this.updateAccessPattern(codeFile.id, validatedParams.context);
            }
            const explanation = {
                id,
                codeId: codeFile?.id,
                filePath: validatedParams.filePath,
                lineStart: validatedParams.lineStart,
                lineEnd: validatedParams.lineEnd,
                codeSnippet,
                explanationText,
                explanationType: validatedParams.explanationType,
                embedding,
                qualityScore: 0.5,
                useCount: 1,
                feedbackPositive: 0,
                feedbackNegative: 0,
                createdAt: now,
                updatedAt: now,
                createdBy: 'assistant',
                metadata: { context: validatedParams.context }
            };
            logger.info({
                explanationId: id,
                filePath: validatedParams.filePath,
                type: validatedParams.explanationType
            }, 'Code explanation stored');
            return {
                success: true,
                explanation,
                wasReused: false,
                message: `Stored new ${validatedParams.explanationType} explanation for ${validatedParams.filePath}`
            };
        }
        catch (error) {
            logger.error({ error, filePath: validatedParams.filePath }, 'Failed to create explanation');
            return {
                success: false,
                wasReused: false,
                message: error instanceof Error ? error.message : 'Failed to create explanation'
            };
        }
    }
    /**
     * Find existing explanation for the same location
     */
    async findExistingExplanation(filePath, lineStart, lineEnd, explanationType) {
        const result = await this.db.query(`SELECT * FROM code_explanations
       WHERE file_path = $1
       AND ($2::integer IS NULL OR line_start = $2)
       AND ($3::integer IS NULL OR line_end = $3)
       AND ($4::varchar IS NULL OR explanation_type = $4)
       ORDER BY quality_score DESC, use_count DESC
       LIMIT 1`, [filePath, lineStart ?? null, lineEnd ?? null, explanationType ?? null]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            id: row.id,
            codeId: row.code_id ?? undefined,
            filePath: row.file_path,
            lineStart: row.line_start ?? undefined,
            lineEnd: row.line_end ?? undefined,
            codeSnippet: row.code_snippet ?? undefined,
            explanationText: row.explanation_text,
            explanationType: row.explanation_type,
            qualityScore: row.quality_score,
            useCount: row.use_count,
            feedbackPositive: row.feedback_positive,
            feedbackNegative: row.feedback_negative,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            createdBy: row.created_by,
            metadata: row.metadata
        };
    }
    /**
     * Find code file by path
     */
    async findCodeFile(filePath) {
        const result = await this.db.query(`SELECT id, content FROM codebase_files
       WHERE file_path = $1 OR file_path LIKE $2
       LIMIT 1`, [filePath, `%${filePath}`]);
        return result.rows[0] ?? null;
    }
    /**
     * Extract code snippet from file
     */
    async extractCodeSnippet(codeId, lineStart, lineEnd) {
        const result = await this.db.query(`SELECT content FROM codebase_files WHERE id = $1`, [codeId]);
        if (result.rows.length === 0)
            return undefined;
        const lines = result.rows[0].content.split('\n');
        const start = Math.max(0, lineStart - 1);
        const end = Math.min(lines.length, lineEnd);
        return lines.slice(start, end).join('\n');
    }
    /**
     * Create text for embedding generation
     */
    createEmbeddingText(filePath, explanation, codeSnippet, explanationType) {
        let text = `File: ${filePath}\n`;
        if (explanationType) {
            text += `Type: ${explanationType}\n`;
        }
        text += `Explanation: ${explanation}\n`;
        if (codeSnippet) {
            text += `Code:\n${codeSnippet.slice(0, 2000)}`;
        }
        return text;
    }
    /**
     * Increment use count for an explanation
     */
    async incrementUseCount(explanationId) {
        await this.db.query(`UPDATE code_explanations
       SET use_count = use_count + 1
       WHERE id = $1`, [explanationId]);
    }
    /**
     * Update access pattern for code file
     */
    async updateAccessPattern(codeId, context) {
        const hour = new Date().getHours();
        const day = new Date().getDay();
        await this.db.query(`INSERT INTO code_access_patterns (code_id, access_count, last_accessed, access_contexts)
       VALUES ($1, 1, NOW(), $2)
       ON CONFLICT (code_id) DO UPDATE SET
         access_count = code_access_patterns.access_count + 1,
         last_accessed = NOW(),
         access_contexts = CASE
           WHEN $3::text IS NOT NULL AND $3 != ''
           THEN array_append(
             (SELECT access_contexts[array_length(access_contexts, 1) - 9:array_length(access_contexts, 1)]
              FROM code_access_patterns WHERE code_id = $1),
             $3
           )
           ELSE code_access_patterns.access_contexts
         END,
         hourly_access_pattern[$4] = code_access_patterns.hourly_access_pattern[$4] + 1,
         daily_access_pattern[$5] = code_access_patterns.daily_access_pattern[$5] + 1`, [
            codeId,
            context ? [context] : [],
            context ?? null,
            hour + 1, // PostgreSQL arrays are 1-indexed
            day + 1
        ]);
    }
}
//# sourceMappingURL=explainCode.js.map