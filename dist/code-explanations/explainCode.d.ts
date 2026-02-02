/**
 * explain_code - Generate and store explanations for code
 *
 * This tool takes a code location, generates an explanation, and stores it
 * for future recall. It supports different explanation types and can
 * reuse existing high-quality explanations.
 */
import { MCPTool } from '../mcp/toolRegistry.js';
import { DatabaseManager } from '../database.js';
import { EmbeddingProvider } from '../types/index.js';
import { ExplainCodeParams, ExplainCodeResult } from './types.js';
/**
 * ExplainCode - Store and manage code explanations
 *
 * Features:
 * - Generate explanations for code locations
 * - Reuse existing high-quality explanations
 * - Track explanation usage
 * - Support multiple explanation types
 */
export declare class ExplainCode implements MCPTool<ExplainCodeParams, ExplainCodeResult> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            filePath: {
                type: string;
                description: string;
            };
            lineStart: {
                type: string;
                description: string;
            };
            lineEnd: {
                type: string;
                description: string;
            };
            explanationType: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            context: {
                type: string;
                description: string;
            };
            forceRegenerate: {
                type: string;
                default: boolean;
                description: string;
            };
        };
        required: string[];
    };
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(params: ExplainCodeParams): Promise<ExplainCodeResult>;
    /**
     * Find existing explanation for the same location
     */
    private findExistingExplanation;
    /**
     * Find code file by path
     */
    private findCodeFile;
    /**
     * Extract code snippet from file
     */
    private extractCodeSnippet;
    /**
     * Create text for embedding generation
     */
    private createEmbeddingText;
    /**
     * Increment use count for an explanation
     */
    private incrementUseCount;
    /**
     * Update access pattern for code file
     */
    private updateAccessPattern;
}
//# sourceMappingURL=explainCode.d.ts.map