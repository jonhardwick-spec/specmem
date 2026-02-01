/**
 * rememberThisShit - store a memory that actually matters fr
 *
 * this is where memories go to live
 * supports auto-splitting for unlimited content length like doobidoo
 * also handles images because we fancy like that
 *
 * Now integrated with LWJEB event bus for memory:stored events
 */
import { MCPTool } from '../../mcp/toolRegistry.js';
import { DatabaseManager } from '../../database.js';
import { StoreMemoryParams, EmbeddingProvider } from '../../types/index.js';
type StoreResult = string;
/**
 * RememberThisShit - the memory storage tool
 *
 * yooo storing this memory lets goooo
 * handles everything from simple notes to massive codebases
 *
 * Emits LWJEB events: memory:stored
 */
export declare class RememberThisShit implements MCPTool<StoreMemoryParams, StoreResult> {
    private db;
    private embeddingProvider;
    name: string;
    description: string;
    private coordinator;
    inputSchema: {
        type: "object";
        properties: {
            content: {
                type: string;
                description: string;
            };
            memoryType: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            importance: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                default: any[];
                description: string;
            };
            metadata: {
                type: string;
                description: string;
            };
            imageBase64: {
                type: string;
                description: string;
            };
            imageMimeType: {
                type: string;
                description: string;
            };
            expiresAt: {
                type: string;
                format: string;
                description: string;
            };
        };
        required: string[];
    };
    constructor(db: DatabaseManager, embeddingProvider: EmbeddingProvider);
    execute(params: StoreMemoryParams): Promise<StoreResult>;
    private storeSingleMemory;
    private storeChunkedMemory;
    /**
     * cookTheEmbeddings - generate embeddings for content
     *
     * this is where we turn text into vectors
     * the caching layer handles the speed optimization
     *
     * HARD TIMEOUT: Won't hang forever - fails fast with empty embedding
     */
    private cookTheEmbeddings;
    /**
     * yeetMemoryIntoDb - actually insert the memory
     *
     * handles all the db stuff so the main method stays clean
     */
    private yeetMemoryIntoDb;
    /**
     * validateImage - make sure the image is legit
     *
     * skids cant break this validation no cap
     */
    private validateImage;
    static getStoreCount(): number;
}
export {};
//# sourceMappingURL=rememberThisShit.d.ts.map