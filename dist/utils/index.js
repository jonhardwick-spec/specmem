/**
 * utils/index.ts - Utility Module Exports
 *
 * yo this exports ALL the fire utility modules
 * timer registry, path validation, metrics, all that fr fr
 *
 * Production readiness utilities for SpecMem
 */
// Timer Registry - Issue #18
export { TimerRegistry, getTimerRegistry, resetTimerRegistry, registerInterval, registerTimeout, clearRegisteredTimer, clearAllTimers } from './timerRegistry.js';
// Path Validator - Issue #36
export { PathValidator, getPathValidator, resetPathValidator, validatePath, sanitizeFileName, isPathWithin } from './pathValidator.js';
// Stats Cache - Issue #39
export { StatsCache, DashboardStatsCache, getDashboardCache, resetDashboardCache } from './statsCache.js';
// Circuit Breaker - Issue #44
export { CircuitBreaker, CircuitState, CircuitBreakerError, CircuitBreakerTimeoutError, getCircuitBreaker, getCircuitBreakerRegistry, resetCircuitBreakerRegistry, DATABASE_BREAKER_CONFIG, API_BREAKER_CONFIG } from './circuitBreaker.js';
// Metrics - Issue #27
export { Counter, Gauge, Histogram, MetricsRegistry, getMetricsRegistry, resetMetricsRegistry, collectMetrics, getHttpRequestCounter, getHttpDurationHistogram, getDbQueryCounter, getDbDurationHistogram, getMcpToolCounter, getErrorCounter } from './metrics.js';
// Tracing - Issue #43
export { Tracer, Span, SpanStatus, SpanKind, ConsoleSpanExporter, InMemorySpanExporter, getTracer, resetTracer, startSpan, trace, traceSync, extractTraceContext, injectTraceContext } from './tracing.js';
// File Processing Queue - Issue #16
export { FileProcessingQueue, FileMutex, QueueItemStatus, getFileMutex, resetFileMutex, acquireFileLock, releaseFileLock, withFileLock, acquireAtomicLock, withAtomicLock, atomicMkdir, ensureSocketDirAtomic, 
// Synchronous versions for use in config.ts and other sync contexts
acquireAtomicLockSync, withAtomicLockSync, atomicMkdirSync, ensureSocketDirAtomicSync } from './fileProcessingQueue.js';
// Re-export existing utilities
export { logger } from './logger.js';
export { getMemoryManager, MemoryManager, resetMemoryManager, LRUCache } from './memoryManager.js';
// Chinese Compactor - Token Efficient Compression
export { 
// Core compression functions
compressToTraditionalChinese, decompressFromTraditionalChinese, smartCompress, testSemanticPreservation, compressMemoryContext, 
// Config-aware API (main entry points)
shouldCompress, compactIfEnabled, compressMCPResponse, formatCompressedOutput, getCompressionStats, 
// Internal exports for testing
_internal as _compressionInternal } from './tokenCompressor.js';
// Project Environment - Multi-instance isolation
export { ensureProjectEnv, getProjectEnv, getSpawnEnv, // alias for getProjectEnv - use this when spawning child processes!
getProjectEnvOnly, mergeWithProjectEnv, logProjectInfo, getPythonPath, // use this when spawning Python processes - respects venv & PYTHON_PATH
// Re-exports from config
getProjectPath, getProjectHash, getProjectHashFull, getInstanceDir, } from './projectEnv.js';
// Session Injector - Screen session text injection with Enter key support
export { getCurrentScreenSession, injectToCurrentSession, injectToSession, sendSpecialKey, selfMessage, isInScreenSession, listScreenSessions, } from './sessionInjector.js';
// Progress Reporter - MCP-safe progress/loading bar system
export { ProgressReporter, getProgressReporter, resetProgressReporter, reportProgress, reportStart, reportUpdate, reportComplete, reportError, reportRetry, setMcpServer, clearMcpServer, hasMcpServer, } from './progressReporter.js';
// Safe Process Termination - Ownership-verified process management
export { 
// Ownership management
registerProcessOwnership, registerProcessOwnershipSync, unregisterProcessOwnership, unregisterProcessOwnershipSync, getProcessOwnership, getProcessOwnershipSync, isOwnedProcess, 
// Safe termination
isProcessRunning, safeKillProcess, safeKillByPort, 
// Screen session management
getProjectScopedScreenName, isOwnedScreenSession, safeKillScreenSession, listOwnedScreenSessions, 
// Docker container naming
getProjectScopedContainerName, isOwnedContainer, 
// Spawn with tracking
spawnWithOwnership, 
// Cleanup
cleanupStaleOwnershipFiles, getOwnedProcesses, killAllOwnedProcesses, } from './safeProcessTermination.js';
// Compact XML Response - Token-efficient XML formatting with compression
export { compactXmlResponse, compactSearchResults, stripNewlines } from './compactXmlResponse.js';
// Human Readable Output - Hook-style [SPECMEM-TOOL] tag formatting
export { formatHumanReadable, formatHumanReadableStatus, formatHumanReadableError } from './humanReadableOutput.js';
// Process Health Check - Robust process age checking and verification
export { checkProcessHealth, } from './processHealthCheck.js';
// COT Broadcast - Bridge between MCP tools and Dashboard
export { broadcastCOT, cotStart, cotAnalyze, cotResult, cotError, clearCotLog } from './cotBroadcast.js';
// Retry Helper - Exponential backoff for transient failures (Task #40)
export { withRetry, tryWithRetry, retryQuery, isTransientDbError, calculateBackoffDelay, Retryable, DEFAULT_RETRY_CONFIG, AGGRESSIVE_RETRY_CONFIG, QUICK_RETRY_CONFIG } from './retryHelper.js';
// Map Cleanup - Project-scoped Map memory leak prevention
export { setupMapCleanup, setupMapCleanupWithEmbeddedTime, CleanableMap } from './mapCleanup.js';
//# sourceMappingURL=index.js.map