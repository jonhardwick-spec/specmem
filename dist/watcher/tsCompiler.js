/**
 * tsCompiler.ts - TypeScript Compilation Watcher for Hot Reload
 *
 * watches for TS changes and triggers compilation
 * part of the hot reload system - compiles then signals for reload
 *
 * Features:
 * - Debounced compilation (prevents rapid recompiles)
 * - Event emission for compile success/error
 * - Queue system for pending compiles
 * - Non-blocking async compilation
 */
import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import { getSpawnEnv } from '../utils/index.js';
/**
 * TypeScriptCompiler - handles TypeScript compilation for hot reload
 *
 * fr fr this is the compiler that makes hot reload work
 * emits events when compile succeeds or fails
 */
export class TypeScriptCompiler extends EventEmitter {
    isCompiling = false;
    pendingCompile = false;
    debounceTimer = null;
    debounceMs;
    cwd;
    tscArgs;
    verbose;
    // stats tracking
    stats = {
        totalCompiles: 0,
        successfulCompiles: 0,
        failedCompiles: 0,
        lastCompileTime: null,
        lastCompileDuration: 0,
        lastError: null
    };
    constructor(config = {}) {
        super();
        this.debounceMs = config.debounceMs ?? 500;
        this.cwd = config.cwd ?? '/specmem';
        this.tscArgs = config.tscArgs ?? ['--noEmit', 'false'];
        this.verbose = config.verbose ?? false;
    }
    /**
     * queueCompile - Queue a compilation with debouncing
     *
     * yooo queuing compile with debounce so we dont spam tsc
     */
    queueCompile() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        if (this.verbose) {
            logger.debug('[TSCompiler] Compile queued, debouncing...');
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.compile();
        }, this.debounceMs);
    }
    /**
     * compile - Run TypeScript compilation
     *
     * fr fr running tsc and emitting events
     */
    async compile() {
        if (this.isCompiling) {
            this.pendingCompile = true;
            logger.debug('[TSCompiler] Compile already in progress, queuing another');
            return false;
        }
        this.isCompiling = true;
        this.stats.totalCompiles++;
        logger.info('[TSCompiler] Starting TypeScript compilation...');
        return new Promise((resolve) => {
            const startTime = Date.now();
            // spawn tsc process
            // bruh ALWAYS use getSpawnEnv for project isolation
            const tsc = spawn('npx', ['tsc', ...this.tscArgs], {
                cwd: this.cwd,
                shell: true,
                env: getSpawnEnv()
            });
            let stdout = '';
            let stderr = '';
            tsc.stdout?.on('data', (data) => {
                stdout += data.toString();
                if (this.verbose) {
                    logger.debug({ data: data.toString() }, '[TSCompiler] stdout');
                }
            });
            tsc.stderr?.on('data', (data) => {
                stderr += data.toString();
                if (this.verbose) {
                    logger.debug({ data: data.toString() }, '[TSCompiler] stderr');
                }
            });
            tsc.on('error', (error) => {
                const duration = Date.now() - startTime;
                this.isCompiling = false;
                this.stats.failedCompiles++;
                this.stats.lastCompileTime = new Date();
                this.stats.lastCompileDuration = duration;
                this.stats.lastError = error.message;
                logger.error({ error }, '[TSCompiler] Failed to spawn tsc process');
                const result = {
                    success: false,
                    duration,
                    stderr: error.message
                };
                this.emit('compile:error', result);
                resolve(false);
                this.handlePendingCompile();
            });
            tsc.on('close', (code) => {
                const duration = Date.now() - startTime;
                this.isCompiling = false;
                this.stats.lastCompileTime = new Date();
                this.stats.lastCompileDuration = duration;
                const result = {
                    success: code === 0,
                    duration,
                    code: code ?? undefined,
                    stdout: stdout || undefined,
                    stderr: stderr || undefined
                };
                if (code === 0) {
                    this.stats.successfulCompiles++;
                    this.stats.lastError = null;
                    logger.info({ duration }, '[TSCompiler] Compilation successful');
                    this.emit('compile:success', result);
                    resolve(true);
                }
                else {
                    this.stats.failedCompiles++;
                    this.stats.lastError = stderr || `Exit code: ${code}`;
                    logger.error({ code, stderr }, '[TSCompiler] Compilation failed');
                    this.emit('compile:error', result);
                    resolve(false);
                }
                this.handlePendingCompile();
            });
        });
    }
    /**
     * handlePendingCompile - Process any queued compile requests
     */
    handlePendingCompile() {
        if (this.pendingCompile) {
            this.pendingCompile = false;
            logger.debug('[TSCompiler] Processing pending compile...');
            // slight delay to prevent rapid succession
            setTimeout(() => this.compile(), 100);
        }
    }
    /**
     * cancelPending - Cancel any pending compilation
     */
    cancelPending() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.pendingCompile = false;
        logger.debug('[TSCompiler] Pending compile cancelled');
    }
    /**
     * isCurrentlyCompiling - Check if compilation is in progress
     */
    isCurrentlyCompiling() {
        return this.isCompiling;
    }
    /**
     * hasPendingCompile - Check if there's a pending compile
     */
    hasPendingCompile() {
        return this.pendingCompile || this.debounceTimer !== null;
    }
    /**
     * getStats - Returns compiler statistics
     */
    getStats() {
        return {
            ...this.stats,
            isCompiling: this.isCompiling,
            hasPending: this.hasPendingCompile()
        };
    }
    /**
     * setDebounceMs - Update debounce delay
     */
    setDebounceMs(ms) {
        this.debounceMs = ms;
        logger.debug({ debounceMs: ms }, '[TSCompiler] Debounce delay updated');
    }
    /**
     * setCwd - Update working directory
     */
    setCwd(cwd) {
        this.cwd = cwd;
        logger.debug({ cwd }, '[TSCompiler] Working directory updated');
    }
}
// LOW-12 FIX: Make default singleton cwd configurable via env var
// This allows per-project TypeScript compilation instead of hardcoded /specmem
export const tsCompiler = new TypeScriptCompiler({
    cwd: process.env.SPECMEM_PROJECT_PATH || process.cwd() || '/specmem'
});
//# sourceMappingURL=tsCompiler.js.map