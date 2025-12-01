/**
 * extractClaudeSessions.ts - Manual Claude Session Extraction Tool
 *
 * yo fr fr manually trigger Claude session extraction
 * extracts ALL sessions or just new ones since last check
 *
 * This is the MCP tool that lets you manually extract sessions
 * perfect for initial setup or when you want to force an update
 */
import { z } from 'zod';
import { MCPTool } from '../../mcp/toolRegistry.js';
import { EmbeddingProvider } from '../index.js';
import { DatabaseManager } from '../../database.js';
declare const ExtractClaudeSessionsInputSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<["all", "new"]>>;
    importance: z.ZodDefault<z.ZodEnum<["critical", "high", "medium", "low", "trivial"]>>;
    additionalTags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    claudeDir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    importance?: "critical" | "high" | "medium" | "low" | "trivial";
    mode?: "all" | "new";
    additionalTags?: string[];
    claudeDir?: string;
}, {
    importance?: "critical" | "high" | "medium" | "low" | "trivial";
    mode?: "all" | "new";
    additionalTags?: string[];
    claudeDir?: string;
}>;
type ExtractClaudeSessionsInput = z.infer<typeof ExtractClaudeSessionsInputSchema>;
/**
 * ExtractClaudeSessions - manually extracts Claude Code sessions
 *
 * nah bruh this is the manual extraction tool
 * perfect for when you first set this up or want to refresh
 */
export declare class ExtractClaudeSessions implements MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            mode: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            importance: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            additionalTags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            claudeDir: {
                type: string;
                description: string;
            };
        };
    };
    private embeddingProvider;
    private db;
    constructor(embeddingProvider: EmbeddingProvider, db: DatabaseManager);
    execute(args: ExtractClaudeSessionsInput): Promise<{
        success: boolean;
        extracted: number;
        stored: number;
        failed: number;
        oversizedSkipped?: number;
        mode: string;
        stats?: {
            oldestEntry: string | null;
            newestEntry: string | null;
            uniqueSessions: number;
            projectsFound: string[];
        };
        errorBreakdown?: Record<string, number>;
        message: string;
        errorDetails?: Record<string, unknown>;
    }>;
}
export {};
//# sourceMappingURL=extractClaudeSessions.d.ts.map