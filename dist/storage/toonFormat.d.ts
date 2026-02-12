export interface ToonHeader {
    version: number;
    compressed: boolean;
    originalSize: number;
    compressedSize: number;
    checksum: number;
    createdAt: number;
    metadata: Record<string, unknown>;
}
export interface ToonData<T = unknown> {
    header: ToonHeader;
    payload: T;
}
export interface ToonSerializeOptions {
    compress?: boolean;
    compressionLevel?: number;
    metadata?: Record<string, unknown>;
}
export interface ToonStats {
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    serializationTime: number;
}
export declare class ToonFormat {
    private static instance;
    private constructor();
    static getInstance(): ToonFormat;
    serialize<T>(data: T, options?: ToonSerializeOptions): Promise<{
        buffer: Buffer;
        stats: ToonStats;
    }>;
    deserialize<T>(buffer: Buffer): Promise<ToonData<T>>;
    serializeSync<T>(data: T, options?: Omit<ToonSerializeOptions, 'compress'> & {
        compress?: false;
    }): {
        buffer: Buffer;
        stats: ToonStats;
    };
    deserializeSync<T>(buffer: Buffer): ToonData<T>;
    isToonFormat(buffer: Buffer): boolean;
    getHeaderOnly(buffer: Buffer): ToonHeader | null;
    estimateSize<T>(data: T): number;
}
export declare const toonFormat: ToonFormat;
export declare function serializeToToon<T>(data: T, options?: ToonSerializeOptions): Promise<Buffer>;
export declare function deserializeFromToon<T>(buffer: Buffer): Promise<T>;
export declare function serializeToToonSync<T>(data: T, options?: Omit<ToonSerializeOptions, 'compress'>): Buffer;
export declare function deserializeFromToonSync<T>(buffer: Buffer): T;
//# sourceMappingURL=toonFormat.d.ts.map