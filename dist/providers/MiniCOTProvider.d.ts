/**
 * Mini COT Provider
 *
 * Connects to Mini COT Decision Model service via Unix socket
 * Converts search results into semantic gallery view with COT reasoning
 */
export interface GalleryItem {
    memory_id: string;
    thumbnail: string;
    relevance: number;
    cot: string;
    research: Record<string, any>;
    drill_hint: string;
    timestamp?: string;
    role?: string;
}
export interface GalleryView {
    query: string;
    gallery: GalleryItem[];
    total_researched_terms: number;
}
export interface MemoryForGallery {
    id: string;
    keywords: string;
    snippet: string;
    timestamp?: string;
    role?: string;
}
export declare class MiniCOTProvider {
    private socketPath;
    private timeout;
    constructor(socketPath?: string, timeout?: number);
    /**
     * Create gallery view from search results
     *
     * Sends memories to Mini COT model which:
     * 1. Analyzes relevance with COT reasoning
     * 2. Researches unknown terms
     * 3. Creates compacted thumbnails
     * 4. Sorts by relevance
     */
    createGallery(query: string, memories: MemoryForGallery[]): Promise<GalleryView>;
    /**
     * Check if Mini COT service is available
     */
    isAvailable(): Promise<boolean>;
}
//# sourceMappingURL=MiniCOTProvider.d.ts.map