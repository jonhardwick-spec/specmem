/**
 * fileWatcher.ts - File System Watcher for Auto-Updating MCP Memories
 *
 * yooo watching for file changes lets goooo
 * monitors the entire codebase and auto-updates MCP when files change
 *
 * Features:
 * - Uses chokidar for reliable cross-platform watching
 * - Respects .specmemignore exclusions
 * - Debounces rapid changes (like during compilation)
 * - Auto-restarts on crashes (because watcher crashes are NOT it)
 * - Handles mass operations (git checkout, build, etc.)
 */
import chokidar from 'chokidar';
import { promises as fs } from 'fs';
import { join, relative, resolve, sep, basename } from 'path';
import { logger } from '../utils/logger.js';
import debounce from 'debounce';
/**
 * Check if a path is within the project scope.
 * This is a defense-in-depth check to prevent watching paths outside the project.
 */
function isPathWithinProject(targetPath, projectPath) {
    const normalizedTarget = resolve(targetPath);
    const normalizedProject = resolve(projectPath);
    // Path must be within project directory or be the project directory itself
    return normalizedTarget === normalizedProject ||
        normalizedTarget.startsWith(normalizedProject + sep);
}
/**
 * watchForChangesNoCap - main file watcher class
 *
 * fr fr this is the GOAT of file watchers
 * handles everything from rapid changes to mass git operations
 */
export class WatchForChangesNoCap {
    config;
    watcher = null;
    isWatching = false;
    restartCount = 0;
    ignorePatterns = [];
    changeHandler = null;
    // FIX MED-13: Track debounced handlers with proper typing for cancel support
    debouncedHandlers = new Map();
    // FIX MED-14 & LOW-15: Track latest event data per key to avoid stale closures
    pendingEventData = new Map();
    // stats tracking
    stats = {
        filesWatched: 0,
        eventsProcessed: 0,
        eventsSkipped: 0,
        errors: 0,
        restarts: 0,
        lastEventTime: null
    };
    constructor(config) {
        this.config = {
            rootPath: config.rootPath,
            additionalPaths: config.additionalPaths ?? [],
            ignorePath: config.ignorePath ?? join(config.rootPath, '.specmemignore'),
            debounceMs: config.debounceMs ?? 1000,
            autoRestart: config.autoRestart ?? true,
            maxRestarts: config.maxRestarts ?? 5,
            verbose: config.verbose ?? false
        };
    }
    /**
     * startWatching - fires up the file watcher
     *
     * yooo lets get this watcher rolling
     */
    async startWatching(handler) {
        if (this.isWatching) {
            logger.warn('watcher already running - call stopWatching first bruh');
            return;
        }
        this.changeHandler = handler;
        // load ignore patterns from .specmemignore
        await this.loadIgnorePatterns();
        // PROJECT ISOLATION: Validate all paths are within rootPath scope
        // This is a defense-in-depth check to prevent watching paths outside the project
        const validatedPaths = [this.config.rootPath];
        const rejectedPaths = [];
        for (const additionalPath of this.config.additionalPaths) {
            if (isPathWithinProject(additionalPath, this.config.rootPath)) {
                validatedPaths.push(additionalPath);
            }
            else {
                rejectedPaths.push(additionalPath);
            }
        }
        if (rejectedPaths.length > 0) {
            logger.warn({
                rejectedPaths,
                rootPath: this.config.rootPath
            }, 'PROJECT ISOLATION: Rejected paths outside project scope');
        }
        // Build list of all paths to watch (only validated paths)
        const pathsToWatch = validatedPaths.filter(Boolean);
        logger.info({
            rootPath: this.config.rootPath,
            additionalPaths: validatedPaths.slice(1), // exclude rootPath from additional
            rejectedPaths: rejectedPaths.length > 0 ? rejectedPaths : undefined,
            totalPaths: pathsToWatch.length,
            ignorePatterns: this.ignorePatterns.length
        }, 'starting PROJECT-SCOPED file watcher...');
        try {
            // create chokidar watcher with optimal settings
            // watching multiple paths from database + config
            this.watcher = chokidar.watch(pathsToWatch, {
                // nah bruh dont watch these by default - comprehensive exclusions
                ignored: [
                    // Package managers
                    '**/node_modules/**',
                    '**/.npm/**',
                    '**/.yarn/**',
                    // Version control
                    '**/.git/**',
                    '**/.svn/**',
                    // Build outputs
                    '**/dist/**',
                    '**/build/**',
                    '**/out/**',
                    '**/.next/**',
                    // Data directories - NOT CODE, just runtime data
                    '**/data/**',
                    '**/backups/**',
                    '**/backup_*/**',
                    '**/logs/**',
                    '**/memory-dumps/**',
                    '**/tmp/**',
                    '**/temp/**',
                    // Test artifacts
                    '**/coverage/**',
                    '**/__pycache__/**',
                    '**/.pytest_cache/**',
                    // Cache
                    '**/.cache/**',
                    // IDE/Editor
                    '**/.vscode/**',
                    '**/.idea/**',
                    // Log files
                    '**/*.log',
                    // Minified/bundled files - obfuscated garbage for indexing
                    '**/*.min.js',
                    '**/*.min.css',
                    '**/*.min.mjs',
                    '**/*.bundle.js',
                    '**/*.bundle.mjs',
                    '**/*.chunk.js',
                    '**/*.chunk.mjs',
                    '**/bundle.js',
                    '**/vendor.js',
                    // Source maps
                    '**/*.map',
                    '**/*.js.map',
                    '**/*.css.map',
                    // Lock files - huge and not useful
                    '**/package-lock.json',
                    '**/yarn.lock',
                    '**/pnpm-lock.yaml',
                    // Tarballs and packages
                    '**/*.tgz',
                    '**/*.tar.gz',
                    // Custom ignore patterns from .specmemignore
                    ...this.ignorePatterns
                ],
                // performance settings
                ignoreInitial: true, // dont fire events for existing files
                persistent: true,
                depth: undefined, // watch all depths
                // debouncing built into chokidar
                awaitWriteFinish: {
                    stabilityThreshold: 300, // wait 300ms for file to stop changing
                    pollInterval: 100 // check every 100ms
                },
                // dont follow symlinks (security)
                followSymlinks: false,
                // efficiency settings
                usePolling: false, // use native fs.watch when possible
                interval: 1000,
                binaryInterval: 3000
            });
            // set up event handlers
            this.setupEventHandlers();
            this.isWatching = true;
            this.restartCount = 0;
            logger.info('file watcher started successfully - were LIVE');
        }
        catch (error) {
            logger.error({ error }, 'failed to start file watcher');
            throw error;
        }
    }
    /**
     * stopWatching - gracefully shuts down the watcher
     */
    async stopWatching() {
        if (!this.isWatching) {
            logger.warn('watcher not running - nothing to stop');
            return;
        }
        logger.info('stopping file watcher...');
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        // FIX MED-13: Cancel all debounced handlers before clearing to prevent memory leaks
        // The debounce library's clear() method cancels pending timer execution
        for (const handler of this.debouncedHandlers.values()) {
            handler.clear();
        }
        this.debouncedHandlers.clear();
        this.pendingEventData.clear();
        this.isWatching = false;
        logger.info({ stats: this.stats }, 'file watcher stopped - peace out');
    }
    /**
     * setupEventHandlers - wires up all the chokidar events
     *
     * nah bruh handling ALL the file events
     */
    setupEventHandlers() {
        if (!this.watcher)
            return;
        // file added
        this.watcher.on('add', (path, stats) => {
            this.handleEvent('add', path, stats);
        });
        // file changed
        this.watcher.on('change', (path, stats) => {
            this.handleEvent('change', path, stats);
        });
        // file deleted
        this.watcher.on('unlink', (path) => {
            this.handleEvent('unlink', path);
        });
        // directory added
        this.watcher.on('addDir', (path, stats) => {
            this.handleEvent('addDir', path, stats);
        });
        // directory deleted
        this.watcher.on('unlinkDir', (path) => {
            this.handleEvent('unlinkDir', path);
        });
        // ready event (initial scan complete)
        this.watcher.on('ready', () => {
            const watched = this.watcher?.getWatched();
            if (watched) {
                const count = Object.values(watched).reduce((sum, files) => sum + files.length, 0);
                this.stats.filesWatched = count;
                logger.info({ filesWatched: count }, 'initial scan complete - ready to watch');
            }
        });
        // error handling
        this.watcher.on('error', (error) => {
            this.stats.errors++;
            logger.error({ error }, 'watcher error occurred');
            // auto-restart if enabled
            if (this.config.autoRestart && this.restartCount < this.config.maxRestarts) {
                logger.info('attempting to restart watcher...');
                this.restartWatcher();
            }
        });
    }
    /**
     * handleEvent - processes a single file change event
     *
     * fr fr auto-updating this file rn
     */
    handleEvent(type, path, stats) {
        // skip if we have custom ignore logic
        if (this.skipTheBoringShit(path)) {
            this.stats.eventsSkipped++;
            if (this.config.verbose) {
                logger.debug({ path, type }, 'skipping ignored file');
            }
            return;
        }
        const relativePath = relative(this.config.rootPath, path);
        // create event object
        const event = {
            type,
            path,
            relativePath,
            timestamp: new Date(),
            stats: stats ? { size: stats.size, mtime: stats.mtime } : undefined
        };
        // debounce the handler call per file
        // this handles rapid changes like compile output
        const key = `${type}:${path}`;
        // FIX MED-14 & LOW-15: Always update the pending event data with latest stats/timestamp
        // This ensures we use the most recent event data when the handler fires
        this.pendingEventData.set(key, event);
        if (this.debouncedHandlers.has(key)) {
            // already debouncing this file - the handler will use updated pendingEventData
            // FIX MED-14: Don't return early - we've already updated the event data above
            // The debounced function will pick up the latest event when it fires
            return;
        }
        // create debounced handler that reads latest event data when executing
        const debouncedHandler = debounce(async () => {
            try {
                if (this.changeHandler) {
                    // FIX LOW-15: Get the latest event data at execution time, not creation time
                    const latestEvent = this.pendingEventData.get(key);
                    if (latestEvent) {
                        // Update timestamp to reflect when we actually process the event
                        latestEvent.timestamp = new Date();
                        await this.changeHandler(latestEvent);
                        this.stats.eventsProcessed++;
                        this.stats.lastEventTime = new Date();
                    }
                }
            }
            catch (error) {
                this.stats.errors++;
                const latestEvent = this.pendingEventData.get(key);
                logger.error({ error, event: latestEvent }, 'error processing file change');
            }
            finally {
                // remove from debounce map and pending data
                this.debouncedHandlers.delete(key);
                this.pendingEventData.delete(key);
            }
        }, this.config.debounceMs);
        this.debouncedHandlers.set(key, debouncedHandler);
        debouncedHandler();
        if (this.config.verbose) {
            logger.debug({ event }, 'file change detected');
        }
    }
    /**
     * skipTheBoringShit - checks if file should be ignored
     *
     * nah bruh excluded file getting skipped
     */
    skipTheBoringShit(path) {
        const relativePath = relative(this.config.rootPath, path);
        // check against custom ignore patterns
        for (const pattern of this.ignorePatterns) {
            if (this.matchPattern(relativePath, pattern)) {
                return true;
            }
        }
        // skip common temp files
        // FIX LOW-09: Use path.basename() for cross-platform compatibility (Windows uses backslash)
        const filename = basename(path);
        if (filename.startsWith('.') && !filename.startsWith('.spec')) {
            return true; // skip dotfiles except .specmem files
        }
        if (filename.endsWith('~') || filename.endsWith('.swp') || filename.endsWith('.tmp')) {
            return true; // skip temp files
        }
        return false;
    }
    /**
     * matchPattern - simple glob-style pattern matching
     */
    matchPattern(path, pattern) {
        // convert glob pattern to regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(path);
    }
    /**
     * loadIgnorePatterns - loads patterns from .specmemignore
     */
    async loadIgnorePatterns() {
        try {
            const content = await fs.readFile(this.config.ignorePath, 'utf-8');
            this.ignorePatterns = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#')) // skip comments and empty lines
                .map(pattern => {
                // convert to glob pattern relative to root
                if (pattern.startsWith('/')) {
                    return pattern.slice(1); // remove leading slash
                }
                return `**/${pattern}`; // match anywhere
            });
            logger.info({
                count: this.ignorePatterns.length,
                file: this.config.ignorePath
            }, 'loaded ignore patterns');
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('no .specmemignore file found - using default exclusions only');
            }
            else {
                logger.warn({ error }, 'failed to load .specmemignore');
            }
            this.ignorePatterns = [];
        }
    }
    /**
     * restartWatcher - attempts to restart after crash
     *
     * skids editing files while were processing lmao
     */
    async restartWatcher() {
        this.stats.restarts++;
        this.restartCount++;
        logger.warn({
            attempt: this.restartCount,
            maxAttempts: this.config.maxRestarts
        }, 'restarting watcher...');
        try {
            await this.stopWatching();
            // wait a bit before restarting
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (this.changeHandler) {
                await this.startWatching(this.changeHandler);
                logger.info('watcher restarted successfully');
            }
        }
        catch (error) {
            logger.error({ error }, 'failed to restart watcher');
            if (this.restartCount >= this.config.maxRestarts) {
                logger.fatal('max restart attempts reached - giving up on watcher');
                throw new Error('File watcher failed to restart');
            }
        }
    }
    /**
     * getStats - returns watcher statistics
     */
    getStats() {
        return {
            ...this.stats,
            isWatching: this.isWatching,
            rootPath: this.config.rootPath,
            additionalPaths: this.config.additionalPaths
        };
    }
    /**
     * scanExistingFiles - queues all existing watched files for indexing
     *
     * ignoreInitial:true means existing files dont fire events on startup
     * call this after watcher starts to index everything thats already there
     */
    async scanExistingFiles() {
        if (!this.watcher || !this.changeHandler) {
            logger.warn('cannot scan - watcher not running or no handler set');
            return { scanned: 0, skipped: 0, errors: 0 };
        }
        const watched = this.watcher.getWatched();
        if (!watched) {
            logger.warn('getWatched returned nothing');
            return { scanned: 0, skipped: 0, errors: 0 };
        }
        const stats = { scanned: 0, skipped: 0, errors: 0 };
        logger.info('scanning existing files for initial indexing...');
        for (const [dir, files] of Object.entries(watched)) {
            for (const file of files) {
                const fullPath = join(dir, file);
                if (this.skipTheBoringShit(fullPath)) {
                    stats.skipped++;
                    continue;
                }
                try {
                    const fileStat = await fs.stat(fullPath);
                    if (!fileStat.isFile()) {
                        continue;
                    }
                    const relativePath = relative(this.config.rootPath, fullPath);
                    const event = {
                        type: 'add',
                        path: fullPath,
                        relativePath,
                        timestamp: new Date(),
                        stats: { size: fileStat.size, mtime: fileStat.mtime }
                    };
                    await this.changeHandler(event);
                    stats.scanned++;
                }
                catch (error) {
                    stats.errors++;
                    if (this.config.verbose) {
                        logger.debug({ path: fullPath, error }, 'failed to scan file');
                    }
                }
            }
        }
        logger.info({ stats }, 'existing file scan complete');
        return stats;
    }
    /**
     * isActive - checks if watcher is currently running
     */
    isActive() {
        return this.isWatching;
    }
    /**
     * reloadIgnorePatterns - reloads .specmemignore without restart
     */
    async reloadIgnorePatterns() {
        logger.info('reloading ignore patterns...');
        await this.loadIgnorePatterns();
        logger.info({ count: this.ignorePatterns.length }, 'ignore patterns reloaded');
    }
}
//# sourceMappingURL=fileWatcher.js.map