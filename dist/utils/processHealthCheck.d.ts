/**
 * Process Health Check Utility
 *
 * Provides robust process age checking and health verification for embedding server processes.
 * Helps prevent stale processes from lingering and verifies we're killing the right process.
 *
 * @author hardwicksoftwareservices
 */
export interface ProcessHealthInfo {
    /** PID from PID file */
    pid: number;
    /** Timestamp from PID file (when process started according to file) */
    pidFileTimestamp: number;
    /** Age of PID file in milliseconds */
    pidFileAgeMs: number;
    /** Age of PID file in hours */
    pidFileAgeHours: number;
    /** Does the process exist? */
    processExists: boolean;
    /** Is this the embedding server process? (verified by command line) */
    isEmbeddingServer: boolean;
    /** Process start time from /proc/[pid]/stat (if available) */
    processStartTime: number | null;
    /** Process age in milliseconds (from /proc start time) */
    processAgeMs: number | null;
    /** Process age in hours (from /proc start time) */
    processAgeHours: number | null;
    /** Process command line (for verification) */
    commandLine: string | null;
    /** Is this process stale? (older than max age) */
    isStale: boolean;
    /** Recommended action: 'kill', 'keep', 'investigate' */
    recommendedAction: 'kill' | 'keep' | 'investigate';
    /** Human-readable status message */
    statusMessage: string;
}
export interface ProcessAgeCheckConfig {
    /** Max age in hours before considering process stale (default: 1) */
    maxAgeHours: number;
    /** Path to PID file */
    pidFilePath: string;
    /** Expected process name pattern (e.g., 'frankenstein-embeddings') */
    expectedProcessName?: string;
    /** Project path (for verification) */
    projectPath?: string;
}
/**
 * Check process health and age with robust verification
 *
 * This function:
 * 1. Reads PID file with timestamp
 * 2. Verifies process exists and is the correct process
 * 3. Gets actual process start time from /proc filesystem
 * 4. Calculates process age in hours
 * 5. Returns comprehensive health metadata
 *
 * @param config Configuration for health check
 * @returns ProcessHealthInfo with all metadata
 */
export declare function checkProcessHealth(config: ProcessAgeCheckConfig): ProcessHealthInfo | null;
//# sourceMappingURL=processHealthCheck.d.ts.map