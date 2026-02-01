/**
 * extractContextRestorations.ts - Extract individual interactions from context restorations
 *
 * Context restorations are summaries of previous conversations that got truncated.
 * This tool parses them and extracts the individual user prompts and claude responses
 * mentioned within, storing them as separate memories with proper project_path and timestamps.
 *
 * INPUT: Large context restoration like "User's First Request: 'fix the bug'..."
 * OUTPUT: Individual memories for each extracted interaction
 */
import { z } from 'zod';
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { EmbeddingProvider } from '../index.js';
declare const ExtractContextRestorationsInputSchema: z.ZodObject<{
    dryRun: z.ZodDefault<z.ZodBoolean>;
    limit: z.ZodDefault<z.ZodNumber>;
    reprocess: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    limit?: number;
    dryRun?: boolean;
    reprocess?: boolean;
}, {
    limit?: number;
    dryRun?: boolean;
    reprocess?: boolean;
}>;
type ExtractContextRestorationsInput = z.infer<typeof ExtractContextRestorationsInputSchema>;
/**
 * ExtractContextRestorations - parse context restorations and extract individual interactions
 */
export declare class ExtractContextRestorations implements MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            dryRun: {
                type: string;
                default: boolean;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
            reprocess: {
                type: string;
                default: boolean;
                description: string;
            };
        };
    };
    private db;
    private embeddingProvider;
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(args: ExtractContextRestorationsInput): Promise<{
        success: boolean;
        message: string;
        stats: {
            contextRestorationsFound: number;
            interactionsExtracted: number;
            skipped: number;
        };
        errors?: string[];
    }>;
}
export {};
//# sourceMappingURL=extractContextRestorations.d.ts.map