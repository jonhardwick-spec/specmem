/**
 * syncChecker.ts - Sync Status Verification
 *
 * yooo checking if MCP is in sync with filesystem
 * detects drift and triggers resync when needed
 *
 * Features:
 * - Compare filesystem state with MCP memories
 * - Detect missing files (in MCP but not on disk)
 * - Detect new files (on disk but not in MCP)
 * - Detect modified files (content hash mismatch)
 * - Full resync capability
 * - Incremental drift detection
 */
import { BigBrainSearchEngine } from '../db/findThatShit.js';
import { AutoUpdateTheMemories } from './changeHandler.js';
export interface SyncCheckerConfig {
    rootPath: string;
    search: BigBrainSearchEngine;
    changeHandler: AutoUpdateTheMemories;
    ignorePatterns?: string[];
    maxFileSizeBytes?: number;
    batchSize?: number;
}
export interface DriftReport {
    inSync: boolean;
    lastChecked: Date;
    totalFiles: number;
    totalMemories: number;
    missingFromMcp: string[];
    missingFromDisk: string[];
    contentMismatch: string[];
    upToDate: number;
    driftPercentage: number;
    syncScore: number;
}
export interface ResyncResult {
    success: boolean;
    filesAdded: number;
    filesUpdated: number;
    filesMarkedDeleted: number;
    errors: string[];
    duration: number;
}
/**
 * areWeStillInSync - sync status checker
 *
 * fr fr making sure everything is synced up
 */
export declare class AreWeStillInSync {
    private config;
    private lastSyncCheck;
    constructor(config: SyncCheckerConfig);
    /**
     * checkSync - performs drift detection
     *
     * yooo checking if we still in sync
     */
    checkSync(): Promise<DriftReport>;
    /**
     * resyncEverythingFrFr - full resync of filesystem to MCP
     *
     * yooo doing a full resync lets goooo
     * NON-BLOCKING: Yields to event loop between batches
     */
    resyncEverythingFrFr(): Promise<ResyncResult>;
    /**
     * scanDiskFiles - scans filesystem for all files
     *
     * NON-BLOCKING: Yields to event loop periodically during batch processing
     * This prevents blocking the main thread even on large codebases
     */
    private scanDiskFiles;
    /**
     * scanMcpMemories - gets all file-watcher memories from MCP
     * Also checks codebase_files table where actual indexed files are stored
     */
    private scanMcpMemories;
    /**
     * getLastSyncCheck - returns time of last sync check
     */
    getLastSyncCheck(): Date | null;
    /**
     * getSyncHealth - returns health metrics
     */
    getSyncHealth(): Promise<{
        healthy: boolean;
        lastChecked: Date | null;
        minutesSinceCheck: number | null;
        issues: string[];
    }>;
}
//# sourceMappingURL=syncChecker.d.ts.map