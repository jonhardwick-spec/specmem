/**
 * Process Health Check Utility
 *
 * Provides robust process age checking and health verification for embedding server processes.
 * Helps prevent stale processes from lingering and verifies we're killing the right process.
 *
 * @author hardwicksoftwareservices
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { logger } from './logger.js';
// ============================================================================
// PROCESS AGE CHECKING
// ============================================================================
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
export function checkProcessHealth(config) {
    const { pidFilePath, maxAgeHours, expectedProcessName, projectPath } = config;
    // Step 1: Read PID file
    if (!existsSync(pidFilePath)) {
        logger.debug({ pidFilePath }, '[ProcessHealthCheck] PID file does not exist');
        return null;
    }
    const pidFileInfo = readPidFileWithTimestamp(pidFilePath);
    if (!pidFileInfo) {
        logger.warn({ pidFilePath }, '[ProcessHealthCheck] Could not parse PID file');
        return null;
    }
    const { pid, timestamp } = pidFileInfo;
    const now = Date.now();
    const pidFileAgeMs = now - timestamp;
    const pidFileAgeHours = pidFileAgeMs / (1000 * 60 * 60);
    logger.debug({
        pid,
        pidFileTimestamp: new Date(timestamp).toISOString(),
        pidFileAgeHours: pidFileAgeHours.toFixed(2),
    }, '[ProcessHealthCheck] Read PID file');
    // Step 2: Check if process exists
    let processExists = false;
    try {
        process.kill(pid, 0); // Signal 0 checks existence without killing
        processExists = true;
        logger.debug({ pid }, '[ProcessHealthCheck] Process exists');
    }
    catch (err) {
        logger.debug({ pid, error: err }, '[ProcessHealthCheck] Process does not exist');
    }
    // Step 3: Verify it's the correct process (not a different process with same PID)
    let isEmbeddingServer = false;
    let commandLine = null;
    let processStartTime = null;
    let processAgeMs = null;
    let processAgeHours = null;
    if (processExists) {
        // Get command line
        commandLine = getProcessCommandLine(pid);
        logger.debug({ pid, commandLine }, '[ProcessHealthCheck] Got process command line');
        // Verify it's the embedding server
        if (commandLine) {
            const isEmbedding = commandLine.includes('frankenstein-embeddings.py') ||
                (expectedProcessName && commandLine.includes(expectedProcessName));
            const isCorrectProject = !projectPath || commandLine.includes(projectPath);
            isEmbeddingServer = isEmbedding && isCorrectProject;
            if (isEmbedding && !isCorrectProject) {
                logger.warn({
                    pid,
                    commandLine,
                    expectedProject: projectPath,
                }, '[ProcessHealthCheck] Process is embedding server but WRONG PROJECT');
            }
        }
        // Get actual process start time from /proc
        processStartTime = getProcessStartTime(pid);
        if (processStartTime) {
            processAgeMs = now - processStartTime;
            processAgeHours = processAgeMs / (1000 * 60 * 60);
            logger.debug({
                pid,
                processStartTime: new Date(processStartTime).toISOString(),
                processAgeHours: processAgeHours.toFixed(2),
            }, '[ProcessHealthCheck] Got process start time from /proc');
        }
    }
    // Step 4: Determine if stale
    // Use actual process age if available, otherwise fall back to PID file age
    const effectiveAgeHours = processAgeHours !== null ? processAgeHours : pidFileAgeHours;
    const isStale = effectiveAgeHours > maxAgeHours;
    // Step 5: Determine recommended action
    let recommendedAction = 'keep';
    let statusMessage = '';
    if (!processExists) {
        recommendedAction = 'kill'; // Kill PID file for non-existent process
        statusMessage = `Process ${pid} no longer exists (stale PID file)`;
    }
    else if (!isEmbeddingServer) {
        recommendedAction = 'investigate';
        statusMessage = `Process ${pid} exists but is NOT the embedding server (wrong command)`;
    }
    else if (isStale) {
        recommendedAction = 'kill';
        statusMessage = `Process ${pid} is stale (${effectiveAgeHours.toFixed(2)}h old, max ${maxAgeHours}h)`;
    }
    else {
        recommendedAction = 'keep';
        statusMessage = `Process ${pid} is healthy (${effectiveAgeHours.toFixed(2)}h old)`;
    }
    logger.info({
        pid,
        processExists,
        isEmbeddingServer,
        effectiveAgeHours: effectiveAgeHours.toFixed(2),
        maxAgeHours,
        isStale,
        recommendedAction,
        statusMessage,
    }, '[ProcessHealthCheck] Health check complete');
    return {
        pid,
        pidFileTimestamp: timestamp,
        pidFileAgeMs,
        pidFileAgeHours,
        processExists,
        isEmbeddingServer,
        processStartTime,
        processAgeMs,
        processAgeHours,
        commandLine,
        isStale,
        recommendedAction,
        statusMessage,
    };
}
// ============================================================================
// LOW-LEVEL UTILITIES
// ============================================================================
/**
 * Read PID file with timestamp
 * Format: PID:TIMESTAMP
 */
function readPidFileWithTimestamp(pidFilePath) {
    try {
        const content = readFileSync(pidFilePath, 'utf8').trim();
        const parts = content.split(':');
        if (parts.length < 1)
            return null;
        const pid = parseInt(parts[0], 10);
        if (isNaN(pid))
            return null;
        // If no timestamp, use file modification time
        let timestamp = Date.now();
        if (parts.length >= 2) {
            const ts = parseInt(parts[1], 10);
            if (!isNaN(ts)) {
                timestamp = ts;
            }
        }
        else {
            // Fall back to file mtime
            try {
                const stats = statSync(pidFilePath);
                timestamp = stats.mtimeMs;
            }
            catch {
                // Use current time as fallback
            }
        }
        return { pid, timestamp };
    }
    catch (err) {
        logger.debug({ pidFilePath, error: err }, '[ProcessHealthCheck] Failed to read PID file');
        return null;
    }
}
/**
 * Get process command line from /proc filesystem
 * Returns null if not available (e.g., on non-Linux systems)
 */
function getProcessCommandLine(pid) {
    try {
        const cmdlinePath = `/proc/${pid}/cmdline`;
        if (!existsSync(cmdlinePath)) {
            // Not Linux or process doesn't exist
            logger.debug({ pid }, '[ProcessHealthCheck] /proc not available, trying ps command');
            return getProcessCommandLinePS(pid);
        }
        // Read cmdline (null-separated arguments)
        const cmdline = readFileSync(cmdlinePath, 'utf8');
        // Replace null bytes with spaces
        return cmdline.replace(/\0/g, ' ').trim();
    }
    catch (err) {
        logger.debug({ pid, error: err }, '[ProcessHealthCheck] Failed to read /proc/[pid]/cmdline');
        return getProcessCommandLinePS(pid);
    }
}
/**
 * Get process command line using ps command (fallback for non-Linux)
 */
function getProcessCommandLinePS(pid) {
    try {
        const result = execSync(`ps -p ${pid} -o command= 2>/dev/null || true`, {
            encoding: 'utf8',
            timeout: 1000,
        }).trim();
        return result || null;
    }
    catch (err) {
        logger.debug({ pid, error: err }, '[ProcessHealthCheck] Failed to get command line with ps');
        return null;
    }
}
/**
 * Get process start time from /proc filesystem
 * Returns timestamp in milliseconds, or null if not available
 */
function getProcessStartTime(pid) {
    try {
        const statPath = `/proc/${pid}/stat`;
        if (!existsSync(statPath)) {
            logger.debug({ pid }, '[ProcessHealthCheck] /proc/[pid]/stat not available');
            return null;
        }
        // Read /proc/[pid]/stat
        const statContent = readFileSync(statPath, 'utf8');
        // Parse stat file - format is complex, we want field 22 (starttime)
        // Format: pid (comm) state ppid ... starttime ...
        // The (comm) field can contain spaces, so we need to parse carefully
        const match = statContent.match(/\(.*?\)\s+(.*)$/);
        if (!match) {
            logger.debug({ pid }, '[ProcessHealthCheck] Could not parse /proc/[pid]/stat');
            return null;
        }
        const fields = match[1].split(/\s+/);
        // starttime is field 20 after the comm field (index 19 in our split)
        const startTimeJiffies = parseInt(fields[19], 10);
        if (isNaN(startTimeJiffies)) {
            logger.debug({ pid }, '[ProcessHealthCheck] Invalid starttime in /proc/[pid]/stat');
            return null;
        }
        // Convert jiffies to milliseconds
        // Get system boot time and clock ticks per second
        const uptimeMs = getSystemUptimeMs();
        if (uptimeMs === null) {
            logger.debug('[ProcessHealthCheck] Could not get system uptime');
            return null;
        }
        const clockTicks = getClockTicksPerSecond();
        const startTimeMs = (startTimeJiffies / clockTicks) * 1000;
        const bootTime = Date.now() - uptimeMs;
        const processStartTime = bootTime + startTimeMs;
        logger.debug({
            pid,
            startTimeJiffies,
            clockTicks,
            bootTime: new Date(bootTime).toISOString(),
            processStartTime: new Date(processStartTime).toISOString(),
        }, '[ProcessHealthCheck] Calculated process start time');
        return processStartTime;
    }
    catch (err) {
        logger.debug({ pid, error: err }, '[ProcessHealthCheck] Failed to get process start time');
        return null;
    }
}
/**
 * Get system uptime in milliseconds
 */
function getSystemUptimeMs() {
    try {
        const uptimePath = '/proc/uptime';
        if (!existsSync(uptimePath)) {
            return null;
        }
        const content = readFileSync(uptimePath, 'utf8');
        const uptimeSeconds = parseFloat(content.split(/\s+/)[0]);
        if (isNaN(uptimeSeconds)) {
            return null;
        }
        return uptimeSeconds * 1000;
    }
    catch (err) {
        logger.debug({ error: err }, '[ProcessHealthCheck] Failed to read /proc/uptime');
        return null;
    }
}
/**
 * Get clock ticks per second (usually 100 on Linux)
 */
function getClockTicksPerSecond() {
    try {
        const result = execSync('getconf CLK_TCK 2>/dev/null || echo 100', {
            encoding: 'utf8',
            timeout: 1000,
        }).trim();
        const ticks = parseInt(result, 10);
        return isNaN(ticks) ? 100 : ticks;
    }
    catch {
        return 100; // Default fallback
    }
}
//# sourceMappingURL=processHealthCheck.js.map