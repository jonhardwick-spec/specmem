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
import { compactXmlResponse, stripNewlines } from '../../utils/compactXmlResponse.js';
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
            const options = [
                {
                    mode: 'basic',
                    description: stripNewlines('Fast keyword + semantic search. Returns raw memories instantly.'),
                    speed: 'Instant (~100-500ms)',
                    bestFor: stripNewlines('Quick lookups, finding specific info, browsing history')
                },
                {
                    mode: 'gallery',
                    description: stripNewlines('Mini COT Decision Model analyzes each memory with Chain-of-Thought reasoning.'),
                    speed: 'Slower (~5-15s)',
                    bestFor: stripNewlines('Deep analysis, understanding complex topics, research synthesis'),
                    note: 'EXPERIMENTAL - requires Mini COT service running (TinyLlama)'
                }
            ];
            return compactXmlResponse({
                needsUserChoice: true,
                query: safeParams.query,
                options,
                recommendation: stripNewlines('Use BASIC for quick searches, GALLERY when you need detailed analysis of results')
            }, 'searchOptions');
        }
        // If mode is specified, return parameters for find_memory
        // Apply compact XML for token efficiency
        const galleryMode = safeParams.mode === 'gallery';
        return compactXmlResponse({
            action: 'call_find_memory',
            parameters: {
                query: safeParams.query,
                galleryMode,
                limit: safeParams.limit,
                threshold: safeParams.threshold,
                summarize: true,
                maxContentLength: 500
            },
            mode: safeParams.mode,
            message: stripNewlines(galleryMode
                ? 'Initiating Gallery Mode - Mini COT will analyze results with COT reasoning...'
                : 'Initiating Basic Search - fast semantic + keyword matching...')
        }, 'searchAction');
    }
}
//# sourceMappingURL=smartSearch.js.map