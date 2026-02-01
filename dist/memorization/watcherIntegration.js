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
import { getClaudeCodeTracker } from './claudeCodeTracker.js';
import { logger } from '../utils/logger.js';
import { getCurrentProjectPath } from '../services/ProjectContext.js';
/**
 * WatcherMemorizationBridge - connects file watcher to memorization
 *
 * fr fr this is the glue that makes everything work together
 */
export class WatcherMemorizationBridge {
    watcher;
    tracker;
    config;
    isActive = false;
    // stats
    stats = {
        eventsReceived: 0,
        eventsMemorized: 0,
        eventsSkipped: 0,
        errors: 0
    };
    constructor(watcher, tracker, config = {}) {
        this.watcher = watcher;
        this.tracker = tracker;
        this.config = {
            memorizePatterns: config.memorizePatterns ?? [
                '*.ts', '*.tsx', '*.js', '*.jsx',
                '*.py', '*.rs', '*.go',
                '*.json', '*.yaml', '*.yml',
                '*.md', '*.mdx'
            ],
            skipPatterns: config.skipPatterns ?? [
                'node_modules/*',
                'dist/*',
                'build/*',
                '.git/*',
                '*.log',
                '*.lock',
                'package-lock.json'
            ],
            maxFileSizeBytes: config.maxFileSizeBytes ?? 500 * 1024, // 500KB
            trackAllChanges: config.trackAllChanges ?? false
        };
    }
    /**
     * activate - start the bridge between watcher and memorization
     *
     * yooo lets connect these systems together
     */
    async activate() {
        if (this.isActive) {
            logger.warn('watcher-memorization bridge already active');
            return;
        }
        logger.info('activating watcher-memorization bridge');
        // wrap the tracker's onFileChange to add our filtering
        const originalHandler = this.tracker.onFileChange.bind(this.tracker);
        await this.watcher.startWatching(async (event) => {
            this.stats.eventsReceived++;
            // check if we should memorize this file
            if (!this.shouldMemorize(event)) {
                this.stats.eventsSkipped++;
                return;
            }
            try {
                // delegate to the tracker
                await originalHandler(event);
                this.stats.eventsMemorized++;
            }
            catch (error) {
                this.stats.errors++;
                logger.error({ error, event }, 'bridge failed to process event');
            }
        });
        this.isActive = true;
        logger.info('watcher-memorization bridge activated - auto-memorization is ON');
    }
    /**
     * deactivate - stop the bridge
     */
    async deactivate() {
        if (!this.isActive) {
            return;
        }
        await this.watcher.stopWatching();
        this.isActive = false;
        logger.info({ stats: this.stats }, 'watcher-memorization bridge deactivated');
    }
    /**
     * shouldMemorize - check if a file change should be memorized
     */
    shouldMemorize(event) {
        const path = event.relativePath;
        // check skip patterns first
        for (const pattern of this.config.skipPatterns) {
            if (this.matchGlob(path, pattern)) {
                return false;
            }
        }
        // if tracking all changes, return true
        if (this.config.trackAllChanges) {
            return true;
        }
        // check memorize patterns
        for (const pattern of this.config.memorizePatterns) {
            if (this.matchGlob(path, pattern)) {
                return true;
            }
        }
        return false;
    }
    /**
     * matchGlob - simple glob pattern matching
     */
    matchGlob(path, pattern) {
        const fileName = path.split('/').pop() || path;
        // convert glob to regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        // check both full path and filename
        return regex.test(path) || regex.test(fileName);
    }
    /**
     * getStats - get bridge statistics
     */
    getStats() {
        return {
            ...this.stats,
            isActive: this.isActive,
            watcherStats: this.watcher.getStats(),
            trackerStats: this.tracker.getStats()
        };
    }
    /**
     * isActiveNow - check if bridge is active
     */
    isActiveNow() {
        return this.isActive;
    }
}
/**
 * setupWatcherMemorization - convenience function to set everything up
 *
 * fr fr one function to rule them all
 */
export function setupWatcherMemorization(watcher, memorizer, config) {
    const tracker = getClaudeCodeTracker(memorizer);
    const bridge = new WatcherMemorizationBridge(watcher, tracker, config);
    logger.info('watcher-memorization setup complete');
    return bridge;
}
/**
 * Per-project bridge instances - each project gets isolated watcher-memorization fr
 */
const bridgesByProject = new Map();
export function getWatcherMemorizationBridge(projectPath) {
    const targetProject = projectPath || getCurrentProjectPath();
    return bridgesByProject.get(targetProject) || null;
}
export function setWatcherMemorizationBridge(bridge, projectPath) {
    const targetProject = projectPath || getCurrentProjectPath();
    bridgesByProject.set(targetProject, bridge);
    logger.debug(`[WatcherBridge] Set bridge for project: ${targetProject}`);
}
export function resetWatcherMemorizationBridge(projectPath) {
    if (projectPath) {
        bridgesByProject.delete(projectPath);
        logger.debug(`[WatcherBridge] Reset bridge for project: ${projectPath}`);
    }
    else {
        // reset current project only
        const currentProject = getCurrentProjectPath();
        bridgesByProject.delete(currentProject);
        logger.debug(`[WatcherBridge] Reset bridge for current project: ${currentProject}`);
    }
}
export function resetAllWatcherMemorizationBridges() {
    bridgesByProject.clear();
    logger.debug('[WatcherBridge] Reset all bridges');
}
//# sourceMappingURL=watcherIntegration.js.map