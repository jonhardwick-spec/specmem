/**
 * findMemoryGallery - Search memories with drill-down gallery view
 *
 * Returns thumbnails with:
 * - Short preview
 * - Keywords
 * - Relevance score
 * - Drill hint: getMemoryFull({id: 'XXX'})
 */
import { MemoryDrilldown } from '../../services/MemoryDrilldown.js';
import { formatHumanReadable } from '../../utils/humanReadableOutput.js';
export class FindMemoryGallery {
    db;
    name = 'findMemoryGallery';
    description = `Search memories and get a gallery of drill-down-able snippets.

Returns thumbnails with:
- Short preview (80 chars)
- Keywords
- Relevance score
- Drill hint: getMemoryFull({id: 'XXX'}) to get full content + code + conversation

Use this when you need to:
- Search for memories about a topic
- Find code-related memories
- Get conversation context about past work

Example: findMemoryGallery({ query: "authentication system" })`;
    inputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query (keywords or semantic search)'
            },
            limit: {
                type: 'number',
                description: 'Max results to return (default: 20)',
                default: 20
            }
        },
        required: ['query']
    };
    drilldown;
    constructor(db) {
        this.db = db;
        // Pass DatabaseManager directly
        this.drilldown = new MemoryDrilldown(db, '/server');
    }
    async execute(params) {
        const { query, limit = 20 } = params;
        const gallery = await this.drilldown.findMemory(query, limit);
        // Convert gallery items to human-readable format
        const humanReadableData = gallery.map((item, idx) => ({
            id: item.drilldownID || item.id || `gallery-${idx}`,
            similarity: item.similarity || item.score || 0.5,
            content: `[GALLERY] ${item.preview || item.content_preview || (item.content || '').substring(0, 80)}`,
        }));
        return formatHumanReadable('find_memory_gallery', humanReadableData, {
            grey: true,
            showSimilarity: true,
            maxContentLength: 300
        });
    }
}
//# sourceMappingURL=findMemoryGallery.js.map