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
import { logger, serializeError } from '../../utils/logger.js';
import { extractAllContextRestorations } from '../../claude-sessions/contextRestorationParser.js';
const ExtractContextRestorationsInputSchema = z.object({
    dryRun: z.boolean().default(false).describe('Preview what would be extracted without actually storing memories'),
    limit: z.number().min(1).max(10000).default(1000).describe('Maximum number of context restorations to process'),
    reprocess: z.boolean().default(false).describe('Reprocess already-processed context restorations (default: skip them)')
});
/**
 * ExtractContextRestorations - parse context restorations and extract individual interactions
 */
export class ExtractContextRestorations {
    name = 'extract-context-restorations';
    description = 'Extract individual user prompts and claude responses from context restoration summaries. Stores them as separate memories with proper project_path and timestamps for accurate pairing.';
    inputSchema = {
        type: 'object',
        properties: {
            dryRun: {
                type: 'boolean',
                default: false,
                description: 'Preview what would be extracted without actually storing memories'
            },
            limit: {
                type: 'number',
                default: 1000,
                description: 'Maximum number of context restorations to process'
            },
            reprocess: {
                type: 'boolean',
                default: false,
                description: 'Reprocess already-processed context restorations'
            }
        }
    };
    db;
    embeddingProvider;
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    async execute(args) {
        try {
            logger.info('[ExtractContextRestorations] Starting extraction...', {
                dryRun: args.dryRun,
                limit: args.limit,
                reprocess: args.reprocess
            });
            // Pass embeddingProvider so extracted memories have embeddings for semantic search
            const result = await extractAllContextRestorations(this.db, this.embeddingProvider, {
                dryRun: args.dryRun,
                limit: args.limit,
                skipAlreadyProcessed: !args.reprocess
            });
            const message = args.dryRun
                ? `[DRY RUN] Would extract ${result.extracted} individual interactions from ${result.processed} context restorations`
                : `Extracted ${result.extracted} individual interactions from ${result.processed} context restorations (${result.skipped} already processed)`;
            logger.info('[ExtractContextRestorations] Complete', {
                processed: result.processed,
                extracted: result.extracted,
                skipped: result.skipped,
                errors: result.errors.length
            });
            return {
                success: result.errors.length === 0,
                message,
                stats: {
                    contextRestorationsFound: result.processed,
                    interactionsExtracted: result.extracted,
                    skipped: result.skipped
                },
                errors: result.errors.length > 0 ? result.errors : undefined
            };
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error('[ExtractContextRestorations] Failed', { error: serializeError(error) });
            return {
                success: false,
                message: `Failed to extract context restorations: ${errMsg}`,
                stats: {
                    contextRestorationsFound: 0,
                    interactionsExtracted: 0,
                    skipped: 0
                },
                errors: [errMsg]
            };
        }
    }
}
//# sourceMappingURL=extractContextRestorations.js.map