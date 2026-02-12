/**
 * getMemoryFull - Get full memory with code + conversation drill-down
 *
 * Returns:
 * - Full memory content
 * - LIVE CODE from files (actual current code!)
 * - Conversation that spawned this memory
 * - Related memories for further drill-down
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
interface GetMemoryFullInput {
    id: string;
}
export declare class GetMemoryFull implements MCPTool<GetMemoryFullInput, any> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            id: {
                type: string;
                description: string;
            };
        };
        required: "id"[];
    };
    private drilldown;
    constructor(db: DatabaseManager);
    execute(params: GetMemoryFullInput): Promise<any>;
}
export {};
//# sourceMappingURL=getMemoryFull.d.ts.map