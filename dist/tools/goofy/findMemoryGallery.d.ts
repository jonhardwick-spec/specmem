/**
 * findMemoryGallery - Search memories with drill-down gallery view
 *
 * Returns thumbnails with:
 * - Short preview
 * - Keywords
 * - Relevance score
 * - Drill hint: getMemoryFull({id: 'XXX'})
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
interface FindMemoryGalleryInput {
    query: string;
    limit?: number;
}
export declare class FindMemoryGallery implements MCPTool<FindMemoryGalleryInput, any> {
    private db;
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
                default: number;
            };
        };
        required: "query"[];
    };
    private drilldown;
    constructor(db: DatabaseManager);
    execute(params: FindMemoryGalleryInput): Promise<any>;
}
export {};
//# sourceMappingURL=findMemoryGallery.d.ts.map