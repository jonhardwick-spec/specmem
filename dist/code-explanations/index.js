/**
 * Code Explanation System - Main Index
 *
 * Active recall system for storing and retrieving code explanations.
 * Links code to prompts/conversations for contextual memory.
 */
// Schema
export { initializeCodeExplanationSchema, schemaExists, getSchemaStats } from './schema.js';
// Types
export * from './types.js';
// Tools
export { ExplainCode } from './explainCode.js';
export { RecallCodeExplanation } from './recallExplanation.js';
export { LinkCodeToPrompt } from './linkCodeToPrompt.js';
export { GetRelatedCode } from './getRelatedCode.js';
export { SemanticSearchExplanations } from './semanticSearch.js';
export { ProvideFeedback, ExplanationLearningSystem } from './feedback.js';
import { logger } from '../utils/logger.js';
import { initializeCodeExplanationSchema, schemaExists } from './schema.js';
import { ExplainCode } from './explainCode.js';
import { RecallCodeExplanation } from './recallExplanation.js';
import { LinkCodeToPrompt } from './linkCodeToPrompt.js';
import { GetRelatedCode } from './getRelatedCode.js';
import { SemanticSearchExplanations } from './semanticSearch.js';
import { ProvideFeedback, ExplanationLearningSystem } from './feedback.js';
/**
 * Initialize the Code Explanation System
 *
 * This sets up the schema and creates all tools for code explanations.
 *
 * @param db Database manager
 * @param embeddingProvider Provider for generating embeddings
 * @returns Context with tools and learning system
 */
export async function initializeCodeExplanationSystem(db, embeddingProvider) {
    logger.info('Initializing Code Explanation System...');
    // Check if schema already exists
    const exists = await schemaExists(db);
    if (!exists) {
        // Create schema
        await initializeCodeExplanationSchema(db);
        logger.info('Code explanation schema created');
    }
    else {
        logger.info('Code explanation schema already exists');
    }
    // Create tools
    const tools = [
        new ExplainCode(db, embeddingProvider),
        new RecallCodeExplanation(db, embeddingProvider),
        new LinkCodeToPrompt(db),
        new GetRelatedCode(db, embeddingProvider),
        new SemanticSearchExplanations(db, embeddingProvider),
        new ProvideFeedback(db)
    ];
    // Create learning system
    const learningSystem = new ExplanationLearningSystem(db);
    logger.info({
        toolCount: tools.length,
        toolNames: tools.map(t => t.name)
    }, 'Code Explanation System initialized');
    return {
        tools,
        learningSystem,
        initialized: true
    };
}
/**
 * Create code explanation tools without initializing schema
 * Use this when schema is already set up
 */
export function createCodeExplanationTools(db, embeddingProvider) {
    return [
        new ExplainCode(db, embeddingProvider),
        new RecallCodeExplanation(db, embeddingProvider),
        new LinkCodeToPrompt(db),
        new GetRelatedCode(db, embeddingProvider),
        new SemanticSearchExplanations(db, embeddingProvider),
        new ProvideFeedback(db)
    ];
}
/**
 * Tool API Documentation for Engineer 3
 *
 * This describes all tools provided by the Code Explanation System
 * for integration into the monitoring dashboard.
 */
export const TOOL_API_DOCUMENTATION = {
    name: 'Code Explanation System',
    version: '1.0.0',
    description: 'Active recall system for code explanations and prompt linking',
    tools: [
        {
            name: 'explain_code',
            description: 'Store an explanation for a code location',
            params: {
                filePath: 'string (required) - Path to the file',
                lineStart: 'number (optional) - Starting line',
                lineEnd: 'number (optional) - Ending line',
                explanationType: 'string (optional) - Type of explanation',
                context: 'string (optional) - Additional context',
                forceRegenerate: 'boolean (optional) - Force new explanation'
            },
            returns: {
                success: 'boolean',
                explanation: 'CodeExplanation object',
                wasReused: 'boolean',
                message: 'string'
            }
        },
        {
            name: 'recall_code_explanation',
            description: 'Retrieve stored code explanations',
            params: {
                codeId: 'string (optional) - UUID of code file',
                filePath: 'string (optional) - File path pattern',
                query: 'string (optional) - Semantic search query',
                explanationType: 'string (optional) - Filter by type',
                minQuality: 'number (optional) - Minimum quality score',
                limit: 'number (optional) - Max results'
            },
            returns: {
                success: 'boolean',
                explanations: 'Array of CodeExplanation objects',
                total: 'number',
                message: 'string'
            }
        },
        {
            name: 'link_code_to_prompt',
            description: 'Create a link between code and conversation memory',
            params: {
                codeId: 'string (optional) - UUID of code file',
                filePath: 'string (optional) - File path',
                memoryId: 'string (required) - UUID of memory',
                relationshipType: 'string (optional) - Type of relationship',
                context: 'string (optional) - Context about the link',
                strength: 'number (optional) - Link strength (0-1)'
            },
            returns: {
                success: 'boolean',
                link: 'CodePromptLink object',
                message: 'string'
            }
        },
        {
            name: 'get_related_code',
            description: 'Find code related to a conversation or topic',
            params: {
                memoryId: 'string (optional) - UUID of memory',
                query: 'string (optional) - Search query',
                relationshipTypes: 'array (optional) - Filter by types',
                minStrength: 'number (optional) - Minimum link strength',
                limit: 'number (optional) - Max results'
            },
            returns: {
                success: 'boolean',
                relatedCode: 'Array of related code items',
                total: 'number',
                message: 'string'
            }
        },
        {
            name: 'semantic_search_explanations',
            description: 'Search explanations using natural language',
            params: {
                query: 'string (required) - Natural language query',
                limit: 'number (optional) - Max results',
                threshold: 'number (optional) - Similarity threshold',
                explanationTypes: 'array (optional) - Filter by types',
                minQuality: 'number (optional) - Minimum quality'
            },
            returns: {
                success: 'boolean',
                results: 'Array of search results with similarity scores',
                total: 'number',
                message: 'string'
            }
        },
        {
            name: 'provide_explanation_feedback',
            description: 'Provide feedback to improve explanation quality',
            params: {
                explanationId: 'string (required) - UUID of explanation',
                positive: 'boolean (required) - Positive or negative feedback'
            },
            returns: {
                success: 'boolean',
                newQualityScore: 'number',
                message: 'string'
            }
        }
    ],
    tables: {
        code_explanations: {
            description: 'Stores explanations for code locations',
            columns: [
                'id UUID PRIMARY KEY',
                'code_id UUID REFERENCES codebase_files',
                'file_path TEXT',
                'line_start INTEGER',
                'line_end INTEGER',
                'code_snippet TEXT',
                'explanation_text TEXT',
                'explanation_type VARCHAR(50)',
                'embedding vector(DYNAMIC)', // Dimension auto-detected from database
                'quality_score FLOAT',
                'use_count INTEGER',
                'feedback_positive INTEGER',
                'feedback_negative INTEGER',
                'created_at TIMESTAMPTZ',
                'updated_at TIMESTAMPTZ',
                'created_by VARCHAR(100)',
                'metadata JSONB'
            ]
        },
        code_prompt_links: {
            description: 'Links code to conversation memories',
            columns: [
                'id UUID PRIMARY KEY',
                'code_id UUID REFERENCES codebase_files',
                'memory_id UUID REFERENCES memories',
                'explanation_id UUID REFERENCES code_explanations',
                'relationship_type VARCHAR(50)',
                'context TEXT',
                'strength FLOAT',
                'created_at TIMESTAMPTZ',
                'metadata JSONB'
            ]
        },
        code_access_patterns: {
            description: 'Tracks access patterns for learning',
            columns: [
                'id UUID PRIMARY KEY',
                'code_id UUID REFERENCES codebase_files',
                'access_count INTEGER',
                'last_accessed TIMESTAMPTZ',
                'common_queries TEXT[]',
                'query_embeddings JSONB',
                'access_contexts TEXT[]',
                'hourly_access_pattern INTEGER[]',
                'daily_access_pattern INTEGER[]',
                'first_accessed TIMESTAMPTZ',
                'metadata JSONB'
            ]
        }
    }
};
//# sourceMappingURL=index.js.map