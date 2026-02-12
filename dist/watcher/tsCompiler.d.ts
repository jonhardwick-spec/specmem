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
import { EventEmitter } from 'events';
export interface CompileResult {
    success: boolean;
    duration: number;
    code?: number;
    stdout?: string;
    stderr?: string;
}
export interface TypeScriptCompilerConfig {
    debounceMs?: number;
    cwd?: string;
    tscArgs?: string[];
    verbose?: boolean;
}
/**
 * TypeScriptCompiler - handles TypeScript compilation for hot reload
 *
 * fr fr this is the compiler that makes hot reload work
 * emits events when compile succeeds or fails
 */
export declare class TypeScriptCompiler extends EventEmitter {
    private isCompiling;
    private pendingCompile;
    private debounceTimer;
    private debounceMs;
    private cwd;
    private tscArgs;
    private verbose;
    private stats;
    constructor(config?: TypeScriptCompilerConfig);
    /**
     * queueCompile - Queue a compilation with debouncing
     *
     * yooo queuing compile with debounce so we dont spam tsc
     */
    queueCompile(): void;
    /**
     * compile - Run TypeScript compilation
     *
     * fr fr running tsc and emitting events
     */
    compile(): Promise<boolean>;
    /**
     * handlePendingCompile - Process any queued compile requests
     */
    private handlePendingCompile;
    /**
     * cancelPending - Cancel any pending compilation
     */
    cancelPending(): void;
    /**
     * isCurrentlyCompiling - Check if compilation is in progress
     */
    isCurrentlyCompiling(): boolean;
    /**
     * hasPendingCompile - Check if there's a pending compile
     */
    hasPendingCompile(): boolean;
    /**
     * getStats - Returns compiler statistics
     */
    getStats(): typeof this.stats & {
        isCompiling: boolean;
        hasPending: boolean;
    };
    /**
     * setDebounceMs - Update debounce delay
     */
    setDebounceMs(ms: number): void;
    /**
     * setCwd - Update working directory
     */
    setCwd(cwd: string): void;
}
export declare const tsCompiler: TypeScriptCompiler;
//# sourceMappingURL=tsCompiler.d.ts.map