/**
 * utils/index.ts - Utility Module Exports
 *
 * yo this exports ALL the fire utility modules
 * timer registry, path validation, metrics, all that fr fr
 *
 * Production readiness utilities for SpecMem
 */
export { TimerRegistry, getTimerRegistry, resetTimerRegistry, registerInterval, registerTimeout, clearRegisteredTimer, clearAllTimers } from './timerRegistry.js';
export { PathValidator, PathValidatorConfig, PathValidationResult, getPathValidator, resetPathValidator, validatePath, sanitizeFileName, isPathWithin } from './pathValidator.js';
export { StatsCache, DashboardStatsCache, CacheStats, getDashboardCache, resetDashboardCache } from './statsCache.js';
export { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerStats, CircuitState, CircuitBreakerError, CircuitBreakerTimeoutError, getCircuitBreaker, getCircuitBreakerRegistry, resetCircuitBreakerRegistry, DATABASE_BREAKER_CONFIG, API_BREAKER_CONFIG } from './circuitBreaker.js';
export { Counter, Gauge, Histogram, MetricsRegistry, getMetricsRegistry, resetMetricsRegistry, collectMetrics, getHttpRequestCounter, getHttpDurationHistogram, getDbQueryCounter, getDbDurationHistogram, getMcpToolCounter, getErrorCounter } from './metrics.js';
export { Tracer, Span, SpanContext, SpanData, SpanEvent, SpanAttributes, SpanStatus, SpanKind, SpanExporter, ConsoleSpanExporter, InMemorySpanExporter, getTracer, resetTracer, startSpan, trace, traceSync, extractTraceContext, injectTraceContext } from './tracing.js';
export { FileProcessingQueue, FileMutex, QueueItem, QueueItemStatus, QueueStats, getFileMutex, resetFileMutex, acquireFileLock, releaseFileLock, withFileLock, AtomicLockConfig, AtomicLockResult, acquireAtomicLock, withAtomicLock, atomicMkdir, ensureSocketDirAtomic, acquireAtomicLockSync, withAtomicLockSync, atomicMkdirSync, ensureSocketDirAtomicSync } from './fileProcessingQueue.js';
export { logger } from './logger.js';
export { getMemoryManager, MemoryManager, resetMemoryManager, LRUCache } from './memoryManager.js';
export type { MemoryConfig, MemoryStats } from './memoryManager.js';
export { compressToTraditionalChinese, decompressFromTraditionalChinese, smartCompress, testSemanticPreservation, compressMemoryContext, shouldCompress, compactIfEnabled, compressMCPResponse, formatCompressedOutput, getCompressionStats, _internal as _compressionInternal } from './tokenCompressor.js';
export { ensureProjectEnv, getProjectEnv, getSpawnEnv, // alias for getProjectEnv - use this when spawning child processes!
getProjectEnvOnly, mergeWithProjectEnv, logProjectInfo, getPythonPath, // use this when spawning Python processes - respects venv & PYTHON_PATH
getProjectPath, getProjectHash, getProjectHashFull, getInstanceDir, } from './projectEnv.js';
export { getCurrentScreenSession, injectToCurrentSession, injectToSession, sendSpecialKey, selfMessage, isInScreenSession, listScreenSessions, } from './sessionInjector.js';
export { ProgressReporter, ProgressReporterOptions, ProgressEvent, ProgressPhase, getProgressReporter, resetProgressReporter, reportProgress, reportStart, reportUpdate, reportComplete, reportError, reportRetry, setMcpServer, clearMcpServer, hasMcpServer, } from './progressReporter.js';
export { ProcessOwnership, SafeKillResult, registerProcessOwnership, registerProcessOwnershipSync, unregisterProcessOwnership, unregisterProcessOwnershipSync, getProcessOwnership, getProcessOwnershipSync, isOwnedProcess, isProcessRunning, safeKillProcess, safeKillByPort, getProjectScopedScreenName, isOwnedScreenSession, safeKillScreenSession, listOwnedScreenSessions, getProjectScopedContainerName, isOwnedContainer, spawnWithOwnership, cleanupStaleOwnershipFiles, getOwnedProcesses, killAllOwnedProcesses, } from './safeProcessTermination.js';
export { compactXmlResponse, compactSearchResults, stripNewlines, type XmlOptions } from './compactXmlResponse.js';
export { formatHumanReadable, formatHumanReadableStatus, formatHumanReadableError, type HumanReadableOptions } from './humanReadableOutput.js';
export { checkProcessHealth, type ProcessHealthInfo, type ProcessAgeCheckConfig, } from './processHealthCheck.js';
export { broadcastCOT, cotStart, cotAnalyze, cotResult, cotError, clearCotLog, type COTMessage } from './cotBroadcast.js';
export { withRetry, tryWithRetry, retryQuery, isTransientDbError, calculateBackoffDelay, Retryable, DEFAULT_RETRY_CONFIG, AGGRESSIVE_RETRY_CONFIG, QUICK_RETRY_CONFIG, type RetryConfig, type RetryResult } from './retryHelper.js';
export { setupMapCleanup, setupMapCleanupWithEmbeddedTime, CleanableMap, type CleanupConfig } from './mapCleanup.js';
//# sourceMappingURL=index.d.ts.map