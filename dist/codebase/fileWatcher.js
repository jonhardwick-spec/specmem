// yooo file watcher that keeps our codebase memory FRESH
// detects changes and updates memories automatically
// this is how we stay in sync with the actual codebase fr fr
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { SkipTheBoringShit } from './exclusions.js';
/**
 * FileWatcherGoBrrr - watches for file system changes
 *
 * features:
 * - recursive directory watching
 * - debouncing for batch changes
 * - exclusion pattern support
 * - event batching for efficiency
 * - automatic reconnection on errors
 */
export class FileWatcherGoBrrr extends EventEmitter {
    options;
    exclusionHandler;
    watcher = null;
    isWatching = false;
    pendingEvents = new Map();
    debounceTimer = null;
    watchedPaths = new Set();
    stats = {
        isWatching: false,
        rootPath: '',
        eventsReceived: 0,
        eventsProcessed: 0,
        lastEventTime: null,
        watchedPaths: 0,
        errors: 0
    };
    constructor(options) {
        super();
        this.options = {
            rootPath: options.rootPath,
            debounceMs: options.debounceMs ?? 100,
            ignoreInitial: options.ignoreInitial ?? true,
            persistent: options.persistent ?? true,
            depth: options.depth ?? 50,
            additionalExclusions: options.additionalExclusions ?? []
        };
        this.exclusionHandler = new SkipTheBoringShit(this.options.additionalExclusions);
        this.stats.rootPath = this.options.rootPath;
    }
    /**
     * start - begin watching for file changes
     */
    async start() {
        if (this.isWatching) {
            logger.warn('file watcher already running');
            return;
        }
        // initialize exclusion handler
        await this.exclusionHandler.initialize(this.options.rootPath);
        logger.info({ rootPath: this.options.rootPath }, 'starting file watcher - we watching everything now fr');
        try {
            // use native fs.watch with recursive option where supported
            this.watcher = fs.watch(this.options.rootPath, {
                recursive: true,
                persistent: this.options.persistent
            }, (eventType, filename) => {
                if (filename) {
                    this.handleFsEvent(eventType, filename);
                }
            });
            this.watcher.on('error', (error) => {
                this.handleWatcherError(error);
            });
            this.watcher.on('close', () => {
                logger.info('file watcher closed');
                this.isWatching = false;
                this.stats.isWatching = false;
            });
            this.isWatching = true;
            this.stats.isWatching = true;
            this.watchedPaths.add(this.options.rootPath);
            this.stats.watchedPaths = this.watchedPaths.size;
            this.emit('ready');
            logger.info('file watcher ready - lets catch them changes');
        }
        catch (error) {
            logger.error({ error }, 'failed to start file watcher');
            throw error;
        }
    }
    /**
     * stop - stop watching for changes
     */
    stop() {
        if (!this.isWatching) {
            return;
        }
        logger.info('stopping file watcher');
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.isWatching = false;
        this.stats.isWatching = false;
        this.pendingEvents.clear();
        this.watchedPaths.clear();
        this.emit('close');
    }
    /**
     * getStats - get watcher statistics
     */
    getStats() {
        return {
            ...this.stats,
            watchedPaths: this.watchedPaths.size
        };
    }
    /**
     * isActive - check if watcher is running
     */
    isActive() {
        return this.isWatching;
    }
    // private methods
    handleFsEvent(eventType, filename) {
        this.stats.eventsReceived++;
        this.stats.lastEventTime = new Date();
        const absolutePath = path.join(this.options.rootPath, filename);
        const relativePath = filename;
        // check exclusions
        if (this.exclusionHandler.shouldSkip(relativePath, false)) {
            return;
        }
        // determine the actual event type
        let changeType;
        try {
            const stats = fs.statSync(absolutePath);
            if (eventType === 'rename') {
                // file/dir was added or renamed
                changeType = stats.isDirectory() ? 'addDir' : 'add';
            }
            else {
                changeType = 'change';
            }
        }
        catch (e) {
            // file doesn't exist anymore - it was deleted (expected during unlink events)
            changeType = 'unlink';
        }
        const event = {
            type: changeType,
            filePath: relativePath,
            absolutePath,
            timestamp: new Date()
        };
        // add to pending events (deduplication)
        this.pendingEvents.set(absolutePath, event);
        // reset debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.flushPendingEvents();
        }, this.options.debounceMs);
    }
    flushPendingEvents() {
        if (this.pendingEvents.size === 0) {
            return;
        }
        const events = Array.from(this.pendingEvents.values());
        this.pendingEvents.clear();
        // group events by type
        const adds = events.filter(e => e.type === 'add');
        const changes = events.filter(e => e.type === 'change');
        const deletes = events.filter(e => e.type === 'unlink');
        const addDirs = events.filter(e => e.type === 'addDir');
        const deleteDirs = events.filter(e => e.type === 'unlinkDir');
        this.stats.eventsProcessed += events.length;
        // emit individual events
        for (const event of events) {
            this.emit(event.type, event);
        }
        // emit batch event for bulk processing
        if (events.length > 1) {
            this.emit('batch', {
                events,
                adds,
                changes,
                deletes,
                addDirs,
                deleteDirs
            });
        }
        // emit all event with all changes
        this.emit('all', events);
        logger.debug({
            total: events.length,
            adds: adds.length,
            changes: changes.length,
            deletes: deletes.length
        }, 'file watcher events flushed - we saw them changes');
    }
    handleWatcherError(error) {
        this.stats.errors++;
        logger.error({ error }, 'file watcher error');
        this.emit('error', error);
        // attempt to restart if the watcher died
        if (!this.watcher || this.watcher.ref === undefined) {
            logger.warn('watcher appears dead - attempting restart');
            setTimeout(() => {
                this.stop();
                this.start().catch(err => {
                    logger.error({ err }, 'failed to restart file watcher');
                });
            }, 1000);
        }
    }
}
/**
 * createWatcherWithHandler - convenience function to create a watcher with a change handler
 */
export function createWatcherWithHandler(options, handler) {
    const watcher = new FileWatcherGoBrrr(options);
    if (handler.onFileAdded) {
        watcher.on('add', handler.onFileAdded);
    }
    if (handler.onFileChanged) {
        watcher.on('change', handler.onFileChanged);
    }
    if (handler.onFileDeleted) {
        watcher.on('unlink', handler.onFileDeleted);
    }
    if (handler.onBatchChanges) {
        watcher.on('all', handler.onBatchChanges);
    }
    return watcher;
}
// PROJECT-SCOPED WATCHER REGISTRY
// Instead of a single global singleton, we track watchers per project path
// This ensures project isolation even if multiple projects share a process
const watchersByProject = new Map();
/**
 * Get or create a watcher for a specific project.
 * Each project gets its own watcher instance.
 *
 * @param options - Watcher options (must include rootPath)
 * @returns The watcher for this project, or null if no options provided
 */
export function getFileWatcher(options) {
    if (!options?.rootPath) {
        // If no options, try to return existing watcher for the first project
        // This maintains backward compatibility
        const firstWatcher = watchersByProject.values().next().value;
        return firstWatcher || null;
    }
    const projectPath = path.resolve(options.rootPath);
    // Check if we already have a watcher for this project
    if (watchersByProject.has(projectPath)) {
        return watchersByProject.get(projectPath);
    }
    // Create new watcher for this project
    const watcher = new FileWatcherGoBrrr(options);
    watchersByProject.set(projectPath, watcher);
    logger.info({ projectPath, totalWatchers: watchersByProject.size }, 'created new project-scoped watcher');
    return watcher;
}
/**
 * Reset (stop and remove) the watcher for a specific project.
 * Only affects the watcher for that project - other projects' watchers are untouched.
 *
 * @param projectPath - The project path to reset. If not provided, resets all watchers.
 */
export function resetFileWatcher(projectPath) {
    if (projectPath) {
        // Reset specific project's watcher
        const resolvedPath = path.resolve(projectPath);
        const watcher = watchersByProject.get(resolvedPath);
        if (watcher) {
            watcher.stop();
            watchersByProject.delete(resolvedPath);
            logger.info({ projectPath: resolvedPath }, 'reset project-scoped watcher');
        }
    }
    else {
        // Reset ALL watchers (for cleanup on process exit)
        for (const [projPath, watcher] of watchersByProject.entries()) {
            watcher.stop();
            logger.debug({ projectPath: projPath }, 'stopping watcher during full reset');
        }
        watchersByProject.clear();
        logger.info({ watchersCleared: true }, 'reset all project watchers');
    }
}
/**
 * Check if a watcher exists for a specific project.
 */
export function hasWatcherForProject(projectPath) {
    return watchersByProject.has(path.resolve(projectPath));
}
/**
 * Get all currently watched project paths.
 */
export function getWatchedProjectPaths() {
    return Array.from(watchersByProject.keys());
}
//# sourceMappingURL=fileWatcher.js.map