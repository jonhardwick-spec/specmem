/**
 * Smart Search - Interactive search mode selector
 *
 * fr fr this gives you the CHOICE between:
 * - Fast Basic Search (instant results, raw memories)
 * - Gallery Mode (Mini COT brain analyzes with reasoning)
 *
 * nah this is GENIUS - user gets to pick their vibe
 */
import { z } from 'zod';
import { MCPTool } from '../../mcp/toolRegistry.js';
declare const SmartSearchInput: z.ZodObject<{
    query: z.ZodString;
    mode: z.ZodDefault<z.ZodEnum<["basic", "gallery", "ask"]>>;
    limit: z.ZodDefault<z.ZodNumber>;
    threshold: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    query?: string;
    limit?: number;
    threshold?: number;
    mode?: "ask" | "basic" | "gallery";
}, {
    query?: string;
    limit?: number;
    threshold?: number;
    mode?: "ask" | "basic" | "gallery";
}>;
type SmartSearchParams = z.infer<typeof SmartSearchInput>;
/**
 * SmartSearch - helps Claude present search mode options to users
 */
export declare class SmartSearch implements MCPTool<SmartSearchParams, string> {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            mode: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            limit: {
                type: string;
                default: number;
                description: string;
            };
            threshold: {
                type: string;
                default: number;
                description: string;
            };
        };
        required: string[];
    };
    execute(params: SmartSearchParams): Promise<string>;
}
export {};
//# sourceMappingURL=smartSearch.d.ts.map