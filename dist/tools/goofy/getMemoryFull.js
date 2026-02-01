/**
 * getMemoryFull - Get full memory with code + conversation drill-down
 *
 * Returns:
 * - Full memory content
 * - LIVE CODE from files (actual current code!)
 * - Conversation that spawned this memory
 * - Related memories for further drill-down
 */
import { MemoryDrilldown } from '../../services/MemoryDrilldown.js';
import { compactXmlResponse, stripNewlines } from '../../utils/compactXmlResponse.js';
export class GetMemoryFull {
    db;
    name = 'getMemoryFull';
    description = `Get full memory content with drill-down context.

Returns:
- Full memory content
- Code pointers (file paths, line ranges, functions)
- LIVE CODE from files (actual current code!)
- Conversation that spawned this memory
- Related memories for further drill-down

This gives you:
1. Real live code (not just references!)
2. Conversation context (what user asked, what was discussed)
3. Related memories to explore further

Example: getMemoryFull({ id: "mem_12345" })`;
    inputSchema = {
        type: 'object',
        properties: {
            id: {
                type: 'string',
                description: 'Memory ID (from findMemoryGallery drill_hint)'
            }
        },
        required: ['id']
    };
    drilldown;
    constructor(db) {
        this.db = db;
        // Pass DatabaseManager directly
        this.drilldown = new MemoryDrilldown(db, '/server');
    }
    async execute(params) {
        const { id } = params;
        const full = await this.drilldown.getMemory(id);
        // Format as compact XML with content on single lines
        // Strip newlines from content fields to ensure single-line output
        const compactFull = {
            id: full.id,
            content: stripNewlines(full.content || ''),
            keywords: full.keywords,
            created_at: full.created_at,
            code_pointers: full.code_pointers,
            live_code: full.live_code,
            conversation: full.conversation,
            related: full.related_memories?.map((r) => ({
                id: r.id,
                preview: stripNewlines((r.content || '').substring(0, 60))
            }))
        };
        // Apply compact XML formatter for token efficiency
        return compactXmlResponse(compactFull, 'memory');
    }
}
//# sourceMappingURL=getMemoryFull.js.map