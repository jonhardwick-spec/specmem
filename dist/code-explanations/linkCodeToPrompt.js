/**
 * link_code_to_prompt - Associate code with conversation context
 *
 * Creates relationships between code files and memories/prompts
 * to enable active recall of relevant code during conversations.
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { LinkCodeToPromptInput } from './types.js';
/**
 * LinkCodeToPrompt - Create code-to-conversation links
 *
 * Features:
 * - Multiple relationship types
 * - Strength scoring
 * - Context preservation
 * - Duplicate prevention
 */
export class LinkCodeToPrompt {
    db;
    name = 'link_code_to_prompt';
    description = `Create a link between code and a conversation memory. Relationship types:
- referenced: Code was referenced in the conversation
- explained: Code was explained to user
- modified: User asked to modify this code
- debugged: Code was debugged in conversation
- created: Code was created in conversation
- related: Code relates to conversation topic
- imported: Code imports from this file
- depends_on: Code depends on this file
- tested: Code was tested or tests written`;
    inputSchema = {
        type: 'object',
        properties: {
            codeId: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the code file (provide either this or filePath)'
            },
            filePath: {
                type: 'string',
                description: 'File path to link (provide either this or codeId)'
            },
            memoryId: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the memory/prompt to link to'
            },
            relationshipType: {
                type: 'string',
                enum: ['referenced', 'explained', 'modified', 'debugged', 'created',
                    'related', 'imported', 'depends_on', 'tested'],
                default: 'referenced',
                description: 'Type of relationship between code and prompt'
            },
            context: {
                type: 'string',
                description: 'Additional context about the relationship'
            },
            strength: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 1,
                description: 'Strength of the relationship (0-1)'
            }
        },
        required: ['memoryId']
    };
    constructor(db) {
        this.db = db;
    }
    async execute(params) {
        const validatedParams = LinkCodeToPromptInput.parse(params);
        logger.debug({
            codeId: validatedParams.codeId,
            filePath: validatedParams.filePath,
            memoryId: validatedParams.memoryId
        }, 'Creating code-prompt link');
        try {
            // Resolve codeId if only filePath provided
            let codeId = validatedParams.codeId;
            if (!codeId && validatedParams.filePath) {
                const codeFile = await this.findCodeFileByPath(validatedParams.filePath);
                if (codeFile) {
                    codeId = codeFile.id;
                }
            }
            // Verify memory exists
            const memoryExists = await this.verifyMemoryExists(validatedParams.memoryId);
            if (!memoryExists) {
                return {
                    success: false,
                    message: `Memory ${validatedParams.memoryId} not found`
                };
            }
            // Check for existing link
            const existingLink = await this.findExistingLink(codeId, validatedParams.memoryId, validatedParams.relationshipType);
            if (existingLink) {
                // Update strength if existing link found
                await this.updateLinkStrength(existingLink.id, validatedParams.strength, validatedParams.context);
                logger.debug({ linkId: existingLink.id }, 'Updated existing link strength');
                return {
                    success: true,
                    link: {
                        ...existingLink,
                        strength: validatedParams.strength,
                        context: validatedParams.context ?? existingLink.context
                    },
                    message: `Updated existing ${validatedParams.relationshipType} link`
                };
            }
            // Create new link
            const id = uuidv4();
            const now = new Date();
            await this.db.query(`INSERT INTO code_prompt_links (
          id, code_id, memory_id, relationship_type,
          context, strength, created_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
                id,
                codeId ?? null,
                validatedParams.memoryId,
                validatedParams.relationshipType,
                validatedParams.context ?? null,
                validatedParams.strength,
                now,
                JSON.stringify({ filePath: validatedParams.filePath })
            ]);
            const link = {
                id,
                codeId: codeId ?? undefined,
                memoryId: validatedParams.memoryId,
                relationshipType: validatedParams.relationshipType,
                context: validatedParams.context,
                strength: validatedParams.strength,
                createdAt: now,
                metadata: { filePath: validatedParams.filePath }
            };
            logger.info({
                linkId: id,
                codeId,
                memoryId: validatedParams.memoryId,
                relationshipType: validatedParams.relationshipType
            }, 'Code-prompt link created');
            return {
                success: true,
                link,
                message: `Created ${validatedParams.relationshipType} link between code and prompt`
            };
        }
        catch (error) {
            logger.error({
                error,
                codeId: validatedParams.codeId,
                filePath: validatedParams.filePath
            }, 'Failed to create code-prompt link');
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Failed to create link'
            };
        }
    }
    /**
     * Find code file by path
     */
    async findCodeFileByPath(filePath) {
        const result = await this.db.query(`SELECT id FROM codebase_files
       WHERE file_path = $1 OR file_path LIKE $2
       LIMIT 1`, [filePath, `%${filePath}`]);
        return result.rows[0] ?? null;
    }
    /**
     * Verify memory exists
     */
    async verifyMemoryExists(memoryId) {
        const result = await this.db.query(`SELECT EXISTS(SELECT 1 FROM memories WHERE id = $1) as exists`, [memoryId]);
        return result.rows[0]?.exists ?? false;
    }
    /**
     * Find existing link
     */
    async findExistingLink(codeId, memoryId, relationshipType) {
        const result = await this.db.query(`SELECT * FROM code_prompt_links
       WHERE ($1::uuid IS NULL OR code_id = $1)
       AND memory_id = $2
       AND relationship_type = $3
       LIMIT 1`, [codeId ?? null, memoryId, relationshipType]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            id: row.id,
            codeId: row.code_id ?? undefined,
            memoryId: row.memory_id,
            explanationId: row.explanation_id ?? undefined,
            relationshipType: row.relationship_type,
            context: row.context ?? undefined,
            strength: row.strength,
            createdAt: row.created_at,
            metadata: row.metadata
        };
    }
    /**
     * Update existing link strength
     */
    async updateLinkStrength(linkId, strength, context) {
        await this.db.query(`UPDATE code_prompt_links
       SET strength = $2,
           context = COALESCE($3, context)
       WHERE id = $1`, [linkId, strength, context ?? null]);
    }
}
//# sourceMappingURL=linkCodeToPrompt.js.map