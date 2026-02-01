import { ConnectionPoolGoBrrr } from './connectionPoolGoBrrr.js';
import { MemoryType, ImportanceLevelType } from '../types/index.js';
interface NukeResult {
    deleted: number;
    duration: number;
}
interface CleanupResult {
    expiredDeleted: number;
    orphanTagsDeleted: number;
    orphanRelationsDeleted: number;
    embeddingCachePurged: number;
    duration: number;
}
interface BulkNukeOpts {
    ids?: string[];
    olderThan?: Date;
    memoryType?: MemoryType;
    importance?: ImportanceLevelType;
    tags?: string[];
    expiredOnly?: boolean;
    dryRun?: boolean;
    crossProject?: boolean;
}
/**
 * MemoryNuker - deletes memories with EXTREME PREJUDICE
 *
 * deletion modes:
 * - single: delete by id
 * - bulk: delete by criteria
 * - expired: cleanup old stuff
 * - cascade: delete with all relations
 * - purge: nuclear option - delete EVERYTHING
 */
export declare class MemoryNuker {
    private pool;
    private deletedCount;
    constructor(pool: ConnectionPoolGoBrrr);
    nukeOne(id: string, crossProject?: boolean): Promise<boolean>;
    nukeMany(ids: string[], crossProject?: boolean): Promise<NukeResult>;
    nukeByCriteria(opts: BulkNukeOpts): Promise<NukeResult>;
    nukeByTags(tags: string[], mode?: 'ANY' | 'ALL', crossProject?: boolean): Promise<NukeResult>;
    nukeExpired(crossProject?: boolean): Promise<NukeResult>;
    nukeRelationsFor(memoryId: string): Promise<NukeResult>;
    nukeRelation(sourceId: string, targetId: string, relationType?: string, bidirectional?: boolean): Promise<NukeResult>;
    deepClean(crossProject?: boolean): Promise<CleanupResult>;
    vacuum(full?: boolean): Promise<void>;
    reindex(): Promise<void>;
    thermonuclearOption(confirm: string): Promise<void>;
    markExpired(ids: string[], crossProject?: boolean): Promise<number>;
    archiveOldMemories(olderThanDays: number, crossProject?: boolean): Promise<NukeResult>;
    getStats(): {
        totalDeleted: number;
    };
    previewNuke(opts: BulkNukeOpts): Promise<{
        count: number;
        sampleIds: string[];
    }>;
}
export declare function getTheNuker(pool?: ConnectionPoolGoBrrr, projectPath?: string): MemoryNuker;
export declare function resetTheNuker(projectPath?: string): void;
export declare function resetAllNukers(): void;
export type { NukeResult, CleanupResult, BulkNukeOpts };
//# sourceMappingURL=nukeFromOrbit.d.ts.map