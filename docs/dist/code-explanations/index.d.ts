/**
 * Code Explanation System - Main Index
 *
 * Active recall system for storing and retrieving code explanations.
 * Links code to prompts/conversations for contextual memory.
 */
export { initializeCodeExplanationSchema, schemaExists, getSchemaStats } from './schema.js';
export * from './types.js';
export { ExplainCode } from './explainCode.js';
export { RecallCodeExplanation } from './recallExplanation.js';
export { LinkCodeToPrompt } from './linkCodeToPrompt.js';
export { GetRelatedCode } from './getRelatedCode.js';
export { SemanticSearchExplanations } from './semanticSearch.js';
export { ProvideFeedback, ExplanationLearningSystem } from './feedback.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../types/index.js';
import { MCPTool } from '../mcp/toolRegistry.js';
import { ExplanationLearningSystem } from './feedback.js';
/**
 * Code Explanation System Context
 */
export interface CodeExplanationContext {
    tools: MCPTool[];
    learningSystem: ExplanationLearningSystem;
    initialized: boolean;
}
/**
 * Initialize the Code Explanation System
 *
 * This sets up the schema and creates all tools for code explanations.
 *
 * @param db Database manager
 * @param embeddingProvider Provider for generating embeddings
 * @returns Context with tools and learning system
 */
export declare function initializeCodeExplanationSystem(db: DatabaseManager, embeddingProvider: EmbeddingProvider): Promise<CodeExplanationContext>;
/**
 * Create code explanation tools without initializing schema
 * Use this when schema is already set up
 */
export declare function createCodeExplanationTools(db: DatabaseManager, embeddingProvider: EmbeddingProvider): MCPTool[];
/**
 * Tool API Documentation for Engineer 3
 *
 * This describes all tools provided by the Code Explanation System
 * for integration into the monitoring dashboard.
 */
export declare const TOOL_API_DOCUMENTATION: {
    name: string;
    version: string;
    description: string;
    tools: ({
        name: string;
        description: string;
        params: {
            filePath: string;
            lineStart: string;
            lineEnd: string;
            explanationType: string;
            context: string;
            forceRegenerate: string;
            codeId?: undefined;
            query?: undefined;
            minQuality?: undefined;
            limit?: undefined;
            memoryId?: undefined;
            relationshipType?: undefined;
            strength?: undefined;
            relationshipTypes?: undefined;
            minStrength?: undefined;
            threshold?: undefined;
            explanationTypes?: undefined;
            explanationId?: undefined;
            positive?: undefined;
        };
        returns: {
            success: string;
            explanation: string;
            wasReused: string;
            message: string;
            explanations?: undefined;
            total?: undefined;
            link?: undefined;
            relatedCode?: undefined;
            results?: undefined;
            newQualityScore?: undefined;
        };
    } | {
        name: string;
        description: string;
        params: {
            codeId: string;
            filePath: string;
            query: string;
            explanationType: string;
            minQuality: string;
            limit: string;
            lineStart?: undefined;
            lineEnd?: undefined;
            context?: undefined;
            forceRegenerate?: undefined;
            memoryId?: undefined;
            relationshipType?: undefined;
            strength?: undefined;
            relationshipTypes?: undefined;
            minStrength?: undefined;
            threshold?: undefined;
            explanationTypes?: undefined;
            explanationId?: undefined;
            positive?: undefined;
        };
        returns: {
            success: string;
            explanations: string;
            total: string;
            message: string;
            explanation?: undefined;
            wasReused?: undefined;
            link?: undefined;
            relatedCode?: undefined;
            results?: undefined;
            newQualityScore?: undefined;
        };
    } | {
        name: string;
        description: string;
        params: {
            codeId: string;
            filePath: string;
            memoryId: string;
            relationshipType: string;
            context: string;
            strength: string;
            lineStart?: undefined;
            lineEnd?: undefined;
            explanationType?: undefined;
            forceRegenerate?: undefined;
            query?: undefined;
            minQuality?: undefined;
            limit?: undefined;
            relationshipTypes?: undefined;
            minStrength?: undefined;
            threshold?: undefined;
            explanationTypes?: undefined;
            explanationId?: undefined;
            positive?: undefined;
        };
        returns: {
            success: string;
            link: string;
            message: string;
            explanation?: undefined;
            wasReused?: undefined;
            explanations?: undefined;
            total?: undefined;
            relatedCode?: undefined;
            results?: undefined;
            newQualityScore?: undefined;
        };
    } | {
        name: string;
        description: string;
        params: {
            memoryId: string;
            query: string;
            relationshipTypes: string;
            minStrength: string;
            limit: string;
            filePath?: undefined;
            lineStart?: undefined;
            lineEnd?: undefined;
            explanationType?: undefined;
            context?: undefined;
            forceRegenerate?: undefined;
            codeId?: undefined;
            minQuality?: undefined;
            relationshipType?: undefined;
            strength?: undefined;
            threshold?: undefined;
            explanationTypes?: undefined;
            explanationId?: undefined;
            positive?: undefined;
        };
        returns: {
            success: string;
            relatedCode: string;
            total: string;
            message: string;
            explanation?: undefined;
            wasReused?: undefined;
            explanations?: undefined;
            link?: undefined;
            results?: undefined;
            newQualityScore?: undefined;
        };
    } | {
        name: string;
        description: string;
        params: {
            query: string;
            limit: string;
            threshold: string;
            explanationTypes: string;
            minQuality: string;
            filePath?: undefined;
            lineStart?: undefined;
            lineEnd?: undefined;
            explanationType?: undefined;
            context?: undefined;
            forceRegenerate?: undefined;
            codeId?: undefined;
            memoryId?: undefined;
            relationshipType?: undefined;
            strength?: undefined;
            relationshipTypes?: undefined;
            minStrength?: undefined;
            explanationId?: undefined;
            positive?: undefined;
        };
        returns: {
            success: string;
            results: string;
            total: string;
            message: string;
            explanation?: undefined;
            wasReused?: undefined;
            explanations?: undefined;
            link?: undefined;
            relatedCode?: undefined;
            newQualityScore?: undefined;
        };
    } | {
        name: string;
        description: string;
        params: {
            explanationId: string;
            positive: string;
            filePath?: undefined;
            lineStart?: undefined;
            lineEnd?: undefined;
            explanationType?: undefined;
            context?: undefined;
            forceRegenerate?: undefined;
            codeId?: undefined;
            query?: undefined;
            minQuality?: undefined;
            limit?: undefined;
            memoryId?: undefined;
            relationshipType?: undefined;
            strength?: undefined;
            relationshipTypes?: undefined;
            minStrength?: undefined;
            threshold?: undefined;
            explanationTypes?: undefined;
        };
        returns: {
            success: string;
            newQualityScore: string;
            message: string;
            explanation?: undefined;
            wasReused?: undefined;
            explanations?: undefined;
            total?: undefined;
            link?: undefined;
            relatedCode?: undefined;
            results?: undefined;
        };
    })[];
    tables: {
        code_explanations: {
            description: string;
            columns: string[];
        };
        code_prompt_links: {
            description: string;
            columns: string[];
        };
        code_access_patterns: {
            description: string;
            columns: string[];
        };
    };
};
//# sourceMappingURL=index.d.ts.map