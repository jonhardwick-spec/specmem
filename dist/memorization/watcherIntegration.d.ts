/**
 * watcherIntegration.ts - Integrate Memorization with File Watcher
 *
 * yooo this connects the file watcher to the memorization system
 * when files change, Claude's code gets auto-memorized
 *
 * This is the SECRET SAUCE that makes auto-memorization work:
 * 1. File watcher detects changes
 * 2. This integration routes changes to the tracker
 * 3. Tracker auto-memorizes with detected purposes
 * 4. Claude can recall what it wrote later
 */
import { WatchForChangesNoCap } from '../watcher/fileWatcher.js';
import { ClaudeCodeTracker } from './claudeCodeTracker.js';
import { CodeMemorizer } from './codeMemorizer.js';
/**
 * Configuration for watcher-memorization integration
 */
export interface WatcherMemorizationConfig {
    memorizePatterns?: string[];
    skipPatterns?: string[];
    maxFileSizeBytes?: number;
    trackAllChanges?: boolean;
}
/**
 * WatcherMemorizationBridge - connects file watcher to memorization
 *
 * fr fr this is the glue that makes everything work together
 */
export declare class WatcherMemorizationBridge {
    private watcher;
    private tracker;
    private config;
    private isActive;
    private stats;
    constructor(watcher: WatchForChangesNoCap, tracker: ClaudeCodeTracker, config?: WatcherMemorizationConfig);
    /**
     * activate - start the bridge between watcher and memorization
     *
     * yooo lets connect these systems together
     */
    activate(): Promise<void>;
    /**
     * deactivate - stop the bridge
     */
    deactivate(): Promise<void>;
    /**
     * shouldMemorize - check if a file change should be memorized
     */
    private shouldMemorize;
    /**
     * matchGlob - simple glob pattern matching
     */
    private matchGlob;
    /**
     * getStats - get bridge statistics
     */
    getStats(): {
        isActive: boolean;
        watcherStats: {
            filesWatched: number;
            eventsProcessed: number;
            eventsSkipped: number;
            errors: number;
            restarts: number;
            lastEventTime: Date | null;
        } & {
            isWatching: boolean;
            rootPath: string;
            additionalPaths: string[];
        };
        trackerStats: {
            filesTracked: number;
            filesSkipped: number;
            sessionsCreated: number;
            purposesDetected: number;
            relatedFilesLinked: number;
            errors: number;
        };
        eventsReceived: number;
        eventsMemorized: number;
        eventsSkipped: number;
        errors: number;
    };
    /**
     * isActiveNow - check if bridge is active
     */
    isActiveNow(): boolean;
}
/**
 * setupWatcherMemorization - convenience function to set everything up
 *
 * fr fr one function to rule them all
 */
export declare function setupWatcherMemorization(watcher: WatchForChangesNoCap, memorizer: CodeMemorizer, config?: WatcherMemorizationConfig): WatcherMemorizationBridge;
export declare function getWatcherMemorizationBridge(projectPath?: string): WatcherMemorizationBridge | null;
export declare function setWatcherMemorizationBridge(bridge: WatcherMemorizationBridge, projectPath?: string): void;
export declare function resetWatcherMemorizationBridge(projectPath?: string): void;
export declare function resetAllWatcherMemorizationBridges(): void;
//# sourceMappingURL=watcherIntegration.d.ts.map