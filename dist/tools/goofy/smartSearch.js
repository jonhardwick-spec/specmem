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
import { logger } from '../../utils/logger.js';
import { formatHumanReadableStatus } from '../../utils/humanReadableOutput.js';
const SmartSearchInput = z.object({
    query: z.string().describe('What you looking for fr'),
    mode: z.enum(['basic', 'gallery', 'ask']).default('ask').describe('"basic" = fast af, "gallery" = Mini COT analysis, "ask" = let me choose'),
    limit: z.number().int().min(1).max(100).default(10).describe('How many results'),
    threshold: z.number().min(0).max(1).default(0.25).describe('Similarity threshold (0-1). Default 0.25 filters garbage.')
});
/**
 * SmartSearch - helps  present search mode options to users
 */
export class SmartSearch {
    name = 'smart_search';
    description = 'Interactive search mode selector - choose between fast basic search or detailed gallery mode with Mini COT analysis. Returns guidance for presenting options or parameters for find_memory.';
    inputSchema = {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'What you looking for fr'
            },
            mode: {
                type: 'string',
                enum: ['basic', 'gallery', 'ask'],
                default: 'ask',
                description: '"basic" = fast af, "gallery" = Mini COT analysis, "ask" = let me choose'
            },
            limit: {
                type: 'number',
                default: 10,
                description: 'How many results (1-100)'
            },
            threshold: {
                type: 'number',
                default: 0.25,
                description: 'Similarity threshold (0-1). Default 0.25 filters garbage.'
            }
        },
        required: ['query']
    };
    async execute(params) {
        const safeParams = SmartSearchInput.parse(params);
        logger.info({
            query: safeParams.query,
            mode: safeParams.mode
        }, 'Smart search initiated - user choosing their vibe');
        // If mode is 'ask', return options for  to present
        // Apply compact XML for token efficiency
        if (safeParams.mode === 'ask') {
            const message = `Query: "${safeParams.query}"

Choose search mode:
1. BASIC - Fast semantic search (~100-500ms)
   Best for: Quick lookups, finding specific info

2. GALLERY - Mini COT analysis (~5-15s)
   Best for: Deep analysis, research synthesis
   Note: Experimental - requires TinyLlama

Recommendation: Use BASIC for quick searches, GALLERY for detailed analysis`;
            return formatHumanReadableStatus('smart_search', message);
        }
        // If mode is specified, return parameters for find_memory
        const galleryMode = safeParams.mode === 'gallery';
        const modeMsg = galleryMode
            ? 'Gallery Mode - Mini COT will analyze with reasoning...'
            : 'Basic Search - fast semantic + keyword matching...';
        const message = `Mode: ${safeParams.mode.toUpperCase()}
${modeMsg}

→ Call find_memory with:
  query: "${safeParams.query}"
  galleryMode: ${galleryMode}
  limit: ${safeParams.limit}
  threshold: ${safeParams.threshold}`;
        return formatHumanReadableStatus('smart_search', message);
    }
}
//# sourceMappingURL=smartSearch.js.map