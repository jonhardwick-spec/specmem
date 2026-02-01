/**
 * drill_down - Camera Roll Drilldown Tool
 *
 * Enables zooming into specific memories from camera roll results.
 * Takes a numeric drilldownID and returns detailed content with
 * more exploration options (more drilldown IDs).
 *
 * Camera Roll Metaphor:
 * - find_memory({ cameraRollMode: true }) returns a "camera roll" of results
 * - Each result has a drilldownID (e.g., 123, 456, 789)
 * - drill_down(123) zooms into that specific memory
 * - Returns: full content, related memories (with their own drilldown IDs),
 *   code references, and conversation context
 *
 * Usage:
 *   drill_down({ drilldownID: 123 })
 *   drill_down({ drilldownID: 456, includeCode: true, includeContext: true })
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
interface DrillDownParams {
    drilldownID: number;
    includeCode?: boolean;
    includeContext?: boolean;
    includeRelated?: boolean;
    relatedLimit?: number;
    compress?: boolean;
}
interface DrillDownResponse {
    _REMINDER: string;
    _DRILLDOWN_HINT: string;
    fullContent: string;
    fullCR?: string;
    pairedMessage?: {
        role: 'user' | 'assistant';
        content: string;
        drilldownID: number;
        label: string;
    };
    conversationContext?: {
        before: Array<{
            drilldownID: number;
            preview: string;
            similarity: number;
        }>;
        after: Array<{
            drilldownID: number;
            preview: string;
            similarity: number;
        }>;
    };
    relatedMemories: Array<{
        drilldownID: number;
        preview: string;
        similarity: number;
    }>;
    codeReferences: Array<{
        drilldownID: number;
        filePath: string;
        preview: string;
    }>;
    memoryID: string;
    type: 'memory' | 'code' | 'context';
    originalTimestamp?: string;
    sessionID?: string;
    thisRole?: 'user' | 'assistant';
    parentDrilldownID?: number;
    childDrilldownIDs: number[];
    canDrillDeeper: boolean;
}
export declare class DrillDown implements MCPTool<DrillDownParams, DrillDownResponse> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            drilldownID: {
                type: string;
                description: string;
            };
            includeCode: {
                type: string;
                default: boolean;
                description: string;
            };
            includeContext: {
                type: string;
                default: boolean;
                description: string;
            };
            includeRelated: {
                type: string;
                default: boolean;
                description: string;
            };
            relatedLimit: {
                type: string;
                default: number;
                minimum: number;
                maximum: number;
                description: string;
            };
            compress: {
                type: string;
                default: boolean;
                description: string;
            };
        };
        required: string[];
    };
    constructor(db: DatabaseManager);
    execute(params: DrillDownParams): Promise<DrillDownResponse>;
}
export declare class GetMemoryByDrilldownID implements MCPTool<{
    drilldownID: number;
}, {
    content: string;
    memoryID: string;
} | null> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            drilldownID: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(db: DatabaseManager);
    execute(params: {
        drilldownID: number;
    }): Promise<{
        content: string;
        memoryID: string;
    } | null>;
}
export {};
//# sourceMappingURL=drillDown.d.ts.map