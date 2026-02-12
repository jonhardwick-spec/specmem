/**
 * rememberThisShit - store a memory that actually matters fr
 *
 * this is where memories go to live
 * supports auto-splitting for unlimited content length like doobidoo
 * also handles images because we fancy like that
 *
 * Now integrated with LWJEB event bus for memory:stored events
 */
import { v4 as uuidv4 } from 'uuid';
import { splitContent } from '../../mcp/mcpProtocolHandler.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { getCoordinator } from '../../coordination/integration.js';
import { getProjectPathForInsert } from '../../services/ProjectContext.js';
import { TEXT_LIMITS } from '../../constants.js';
// fr fr we track how many memories we storing
let _storeCount = 0;
/**
 * RememberThisShit - the memory storage tool
 *
 * yooo storing this memory lets goooo
 * handles everything from simple notes to massive codebases
 *
 * Emits LWJEB events: memory:stored
 */
export class RememberThisShit {
    db;
    embeddingProvider;
    name = 'save_memory';
    description = 'Store a memory - supports unlimited content with auto-splitting and images';
    coordinator = getCoordinator();
    inputSchema = {
        type: 'object',
        properties: {
            content: {
                type: 'string',
                description: 'the memory content to store - can be any length, we auto-split if needed'
            },
            memoryType: {
                type: 'string',
                enum: ['episodic', 'semantic', 'procedural', 'working'],
                default: 'semantic',
                description: 'type of memory: episodic (events), semantic (facts), procedural (how-to), working (temporary)'
            },
            importance: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low', 'trivial'],
                default: 'medium',
                description: 'how important is this memory fr'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                default: [],
                description: 'tags for categorization - helps find stuff later'
            },
            metadata: {
                type: 'object',
                description: 'extra data you wanna attach'
            },
            imageBase64: {
                type: 'string',
                description: 'base64-encoded image data if you got one'
            },
            imageMimeType: {
                type: 'string',
                description: 'MIME type of the image (e.g., image/png)'
            },
            expiresAt: {
                type: 'string',
                format: 'date-time',
                description: 'when should this memory expire (optional)'
            }
        },
        required: ['content']
    };
    constructor(db, embeddingProvider) {
        this.db = db;
        this.embeddingProvider = embeddingProvider;
    }
    async execute(params) {
        _storeCount++;
        const startTime = Date.now();
        logger.debug({ contentLength: params.content.length, tags: params.tags }, 'storing memory fr');
        try {
            // validate image if present
            if (params.imageBase64) {
                this.validateImage(params.imageBase64, params.imageMimeType);
            }
            // check if we need to split the content - doobidoo style
            const chunks = params.content.length > TEXT_LIMITS.MEMORY_STORAGE_MAX
                ? splitContent(params.content, TEXT_LIMITS.MEMORY_STORAGE_MAX, TEXT_LIMITS.CHUNK_OVERLAP)
                : [params.content];
            // single memory - easy mode
            if (chunks.length === 1) {
                const memory = await this.storeSingleMemory(params);
                const duration = Date.now() - startTime;
                // Emit memory:stored event via LWJEB
                this.coordinator.emitMemoryStored(memory.id, params.content, params.tags || [], params.importance || 'medium');
                logger.info({ memoryId: memory.id, duration }, 'memory stored successfully fr');
                // COMPACT XML - minimal token usage
                return `<saved id="${memory.id}" ok="true"/>`;
            }
            // multiple chunks - we go crazy
            const storedChunks = await this.storeChunkedMemory(params, chunks);
            const duration = Date.now() - startTime;
            // Emit memory:stored event for each chunk via LWJEB
            for (const chunk of storedChunks) {
                this.coordinator.emitMemoryStored(chunk.id, chunk.content, chunk.tags || [], chunk.importance || 'medium');
            }
            logger.info({ chunkCount: storedChunks.length, duration }, 'chunked memory stored');
            // COMPACT XML - chunked response (use first chunk ID as parent)
            return `<saved id="${storedChunks[0].id}" ok="true" chunks="${storedChunks.length}"/>`;
        }
        catch (error) {
            logger.error({ error }, 'memory storage failed fr');
            const errMsg = error instanceof Error ? error.message : 'storage failed for unknown reason';
            return `<saved ok="false" error="${errMsg.replace(/"/g, '&quot;')}"/>`;
        }
    }
    async storeSingleMemory(params) {
        const id = uuidv4();
        const now = new Date();
        // generate embedding - this is where the magic happens
        const embedding = await this.cookTheEmbeddings(params.content);
        await this.yeetMemoryIntoDb({
            id,
            content: params.content,
            memoryType: params.memoryType,
            importance: params.importance,
            tags: params.tags,
            metadata: params.metadata,
            embedding,
            imageBase64: params.imageBase64,
            imageMimeType: params.imageMimeType,
            expiresAt: params.expiresAt
        });
        // Don't include embedding in return - it's massive (1536 floats) and wastes tokens
        return {
            id,
            content: params.content,
            memoryType: params.memoryType,
            importance: params.importance,
            tags: params.tags,
            metadata: params.metadata,
            // embedding intentionally omitted - too large for MCP response
            imageData: params.imageBase64,
            imageMimeType: params.imageMimeType,
            createdAt: now,
            updatedAt: now,
            accessCount: 0,
            expiresAt: params.expiresAt ? new Date(params.expiresAt) : undefined
        };
    }
    async storeChunkedMemory(params, chunks) {
        const storedMemories = [];
        const now = new Date();
        const parentId = uuidv4();
        // PROJECT NAMESPACING: Include project_path on insert
        const projectPath = getProjectPathForInsert();
        // batch insert for that performance fr
        await this.db.transaction(async (client) => {
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const id = i === 0 ? parentId : uuidv4();
                const embedding = await this.cookTheEmbeddings(chunk);
                const chunkTags = [...params.tags, `chunk-${i + 1}`, `total-chunks-${chunks.length}`];
                if (i > 0)
                    chunkTags.push(`parent-${parentId}`);
                const chunkMetadata = {
                    ...params.metadata,
                    isChunk: true,
                    chunkIndex: i,
                    totalChunks: chunks.length,
                    parentId: i > 0 ? parentId : undefined,
                    nextChunk: i < chunks.length - 1 ? `chunk-${i + 2}` : undefined,
                    prevChunk: i > 0 ? `chunk-${i}` : undefined
                };
                await client.query(`INSERT INTO memories (
            id, content, memory_type, importance, tags, metadata, embedding, expires_at, project_path
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
                    id,
                    chunk,
                    params.memoryType,
                    params.importance,
                    chunkTags,
                    chunkMetadata,
                    embedding ? `[${embedding.join(',')}]` : null,
                    params.expiresAt ?? null,
                    projectPath
                ]);
                // Don't include embedding in response - it's massive and wastes tokens
                storedMemories.push({
                    id,
                    content: chunk,
                    memoryType: params.memoryType,
                    importance: params.importance,
                    tags: chunkTags,
                    metadata: chunkMetadata,
                    // embedding intentionally omitted
                    createdAt: now,
                    updatedAt: now,
                    accessCount: 0,
                    expiresAt: params.expiresAt ? new Date(params.expiresAt) : undefined
                });
            }
            // link chunks together for relationship traversal
            for (let i = 0; i < storedMemories.length - 1; i++) {
                const current = storedMemories[i];
                const next = storedMemories[i + 1];
                await client.query(`INSERT INTO memory_relations (source_id, target_id, relation_type, strength)
           VALUES ($1, $2, 'next_chunk', 1.0)
           ON CONFLICT DO NOTHING`, [current.id, next.id]);
            }
        });
        return storedMemories;
    }
    /**
     * cookTheEmbeddings - generate embeddings for content
     *
     * this is where we turn text into vectors
     * the caching layer handles the speed optimization
     *
     * HARD TIMEOUT: Won't hang forever - fails fast with empty embedding
     */
    async cookTheEmbeddings(content) {
        const EMBEDDING_TIMEOUT_MS = 30000; // 30 second hard limit
        try {
            // Race between embedding generation and timeout
            const result = await Promise.race([
                this.embeddingProvider.generateEmbedding(content),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`Embedding timeout after ${EMBEDDING_TIMEOUT_MS}ms - storing without vector`)), EMBEDDING_TIMEOUT_MS))
            ]);
            return result;
        }
        catch (error) {
            // Log the ACTUAL error so we know wtf happened
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.warn({ error: errorMsg, contentLength: content.length }, 'EMBEDDING FAILED - storing without vector. Error: ' + errorMsg);
            return [];
        }
    }
    /**
     * yeetMemoryIntoDb - actually insert the memory
     *
     * handles all the db stuff so the main method stays clean
     */
    async yeetMemoryIntoDb(params) {
        // PROJECT NAMESPACING: Include project_path on insert
        const projectPath = getProjectPathForInsert();
        await this.db.query(`INSERT INTO memories (
        id, content, memory_type, importance, tags, metadata,
        embedding, image_data, image_mime_type, expires_at, project_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
            params.id,
            params.content,
            params.memoryType,
            params.importance,
            params.tags,
            params.metadata ?? {},
            params.embedding && params.embedding.length > 0 ? `[${params.embedding.join(',')}]` : null,
            params.imageBase64 ? Buffer.from(params.imageBase64, 'base64') : null,
            params.imageMimeType ?? null,
            params.expiresAt ?? null,
            projectPath
        ]);
    }
    /**
     * validateImage - make sure the image is legit
     *
     * skids cant break this validation no cap
     */
    validateImage(base64Data, mimeType) {
        const sizeBytes = Math.ceil(base64Data.length * 0.75);
        if (sizeBytes > config.storage.maxImageSizeBytes) {
            throw new Error(`image too thicc: ${sizeBytes} bytes exceeds max ${config.storage.maxImageSizeBytes}`);
        }
        if (mimeType && !config.storage.allowedImageTypes.includes(mimeType)) {
            throw new Error(`image type ${mimeType} not allowed - try: ${config.storage.allowedImageTypes.join(', ')}`);
        }
        // basic base64 validation
        if (!/^[A-Za-z0-9+/]+=*$/.test(base64Data)) {
            throw new Error('image data aint valid base64 fr');
        }
    }
    static getStoreCount() {
        return _storeCount;
    }
}
//# sourceMappingURL=rememberThisShit.js.map