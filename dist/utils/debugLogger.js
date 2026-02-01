/**
 * Debug Logger - Unprofessional Anticommentation Skill Debugging
 *
 * bruh this thing logs everything with STYLE fr fr
 * - 30-minute auto-clearing cuz we ain't hoarding logs like boomers
 * - category filtering via SPECMEM_DEBUG env var
 * - funny messages cuz debugging should be fun no cap
 *
 * Usage:
 *   SPECMEM_DEBUG=* (all categories)
 *   SPECMEM_DEBUG=database,mcp (specific categories)
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import { getSpecmemRoot } from '../config.js';
// ============================================================================
// Funny Messages - keeping it unprofessional fr fr
// ============================================================================
const FUNNY_MESSAGES = {
    memory: {
        debug: [
            'memory vibin rn',
            'checking that RAM drip',
            'memory be like brrrr',
        ],
        info: [
            'memory vibin at {value}% no cap',
            'RAM looking thicc today',
            'heap doing its thang',
        ],
        warn: [
            'ayo memory getting chunky fr',
            'memory sus ngl, might need to yeet some stuff',
            'heap lowkey sweating rn',
        ],
        error: [
            'bruh memory just died on us',
            'memory said peace out',
            'heap went yoink and dipped',
        ],
        yeet: [
            'MEMORY EMERGENCY BRUH WE COOKED',
            'HEAP EXPLODED NO CAP FR FR',
            'RIP MEMORY IT HAD A GOOD RUN',
        ],
    },
    database: {
        debug: [
            'db query go brrrr',
            'postgres doing postgres things',
            'pool chillin with connections',
        ],
        info: [
            'query completed in {value}ms sheesh',
            'database connection secured fr',
            'pool stats looking clean',
        ],
        warn: [
            'bruh the database is being sus rn',
            'query taking its sweet time smh',
            'connection pool getting crowded ngl',
        ],
        error: [
            'database just yeeted itself',
            'connection said byebye',
            'query failed harder than my social life',
        ],
        yeet: [
            'DATABASE DOWN BRUH WE COOKED FR FR',
            'POSTGRES WENT TO GET MILK AND NEVER CAME BACK',
            'DB CONNECTION YOINKED INTO THE VOID',
        ],
    },
    mcp: {
        debug: [
            'mcp vibin on that protocol',
            'tool call incoming lesgo',
            'stdio transport go brrr',
        ],
        info: [
            'mcp request handled like a champ',
            'tool executed in {value}ms no cap',
            'protocol doing its thing fr',
        ],
        warn: [
            'mcp request kinda sus ngl',
            'tool acting weird but we handling it',
            'protocol hiccup but we good',
        ],
        error: [
            'mcp request caught these hands',
            'tool said nope and dipped',
            'protocol went brr but wrong way',
        ],
        yeet: [
            'MCP SERVER COOKED BRUH CALL 911',
            'PROTOCOL COMPLETELY YEETED WTF',
            'TOOLS ALL DEAD RIP BOZO',
        ],
    },
    dashboard: {
        debug: [
            'dashboard serving that heat',
            'websocket connection vibin',
            'ui update go brrr',
        ],
        info: [
            'dashboard request handled clean',
            'ws message sent in {value}ms',
            'browser connected successfully',
        ],
        warn: [
            'dashboard endpoint being slow smh',
            'ws connection flaky af',
            'ui might be lagging ngl',
        ],
        error: [
            'dashboard yeeted an error',
            'ws disconnected rudely',
            'ui broke harder than expected',
        ],
        yeet: [
            'DASHBOARD CRASHED AND BURNED',
            'ALL WEBSOCKETS DEAD WE COOKED',
            'UI WENT TO BRAZIL',
        ],
    },
    skills: {
        debug: [
            'skill scanner doing a scan',
            'checking that .md drip',
            'skill reload initiated fr',
        ],
        info: [
            'found {value} skills no cap',
            'skill loaded successfully sheesh',
            'skills path looking clean',
        ],
        warn: [
            'skill file looking sus',
            'skill metadata kinda mid ngl',
            'skill reload taking forever smh',
        ],
        error: [
            'skill failed to load bruh',
            'skill file corrupted rip',
            'skill scanner caught hands',
        ],
        yeet: [
            'ALL SKILLS YEETED WTF',
            'SKILL SYSTEM COMPLETELY COOKED',
            'MARKDOWN FILES ALL DEAD FR',
        ],
    },
    codebase: {
        debug: [
            'indexer doing indexer things',
            'parsing files like a boss',
            'chunk created successfully',
        ],
        info: [
            'indexed {value} files sheesh',
            'codebase scan complete no cap',
            'definitions extracted fr',
        ],
        warn: [
            'file taking forever to parse smh',
            'codebase index getting big ngl',
            'some files being weird',
        ],
        error: [
            'file parsing went bruh',
            'indexer caught an L',
            'codebase scan failed rip',
        ],
        yeet: [
            'CODEBASE INDEXER EXPLODED',
            'FILE SYSTEM WENT YOINK',
            'PARSING COMPLETELY COOKED FR FR',
        ],
    },
    coordination: {
        debug: [
            'coordination server vibin',
            'team member registered successfully',
            'event dispatched go brrr',
        ],
        info: [
            'coordination handling {value} team members',
            'event processed in {value}ms',
            'teamMembers synced no cap',
        ],
        warn: [
            'team member connection flaky af',
            'event queue getting chunky',
            'heartbeat missed smh',
        ],
        error: [
            'team member disconnected badly',
            'event failed to dispatch',
            'coordination took an L',
        ],
        yeet: [
            'COORDINATION SERVER DEAD BRUH',
            'ALL AGENTS GONE WTF',
            'EVENT BUS YEETED ITSELF',
        ],
    },
    embedding: {
        debug: [
            'embedding vector go brrr',
            'semantic search initiated',
            'cache checking vibes',
        ],
        info: [
            'embedding generated in {value}ms',
            'cache hit rate at {value}% sheesh',
            'similarity search clean',
        ],
        warn: [
            'embedding taking forever smh',
            'cache miss rate high ngl',
            'vector dimension sus',
        ],
        error: [
            'embedding generation failed bruh',
            'cache corrupted rip',
            'semantic search yeeted',
        ],
        yeet: [
            'EMBEDDING SYSTEM COMPLETELY COOKED',
            'VECTORS ALL WRONG WE DEAD',
            'OPENAI API SAID NO FR FR',
        ],
    },
    watcher: {
        debug: [
            'file watcher watching files wow',
            'fs event detected',
            'debounce timer set',
        ],
        info: [
            'watcher started on {value}',
            'file change processed',
            'sync check complete',
        ],
        warn: [
            'watcher lagging behind smh',
            'too many file changes ngl',
            'debounce queue full',
        ],
        error: [
            'watcher crashed bruh',
            'fs event handler failed',
            'file sync broke',
        ],
        yeet: [
            'WATCHER COMPLETELY DEAD',
            'FS EVENTS GOING CRAZY WE COOKED',
            'FILE SYSTEM ON FIRE FR FR',
        ],
    },
    socket: {
        debug: [
            'socket connection vibin',
            'checking that socket path drip',
            'socket handshake initiated',
        ],
        info: [
            'socket connected to {value}',
            'socket response received in {value}ms',
            'socket path verified successfully',
        ],
        warn: [
            'socket connection flaky af',
            'socket path looking sus ngl',
            'socket timeout approaching smh',
        ],
        error: [
            'socket connection failed bruh',
            'socket path dont exist rip',
            'socket yeeted during request',
        ],
        yeet: [
            'SOCKET COMPLETELY DEAD WE COOKED',
            'SOCKET PATH GONE TO BRAZIL',
            'EMBEDDING SERVICE UNREACHABLE FR FR',
        ],
    },
    search: {
        debug: [
            'search query initiated',
            'embedding generated for query',
            'similarity calculation go brrr',
        ],
        info: [
            'search found {value} results no cap',
            'semantic search completed in {value}ms',
            'query embedding ready',
        ],
        warn: [
            'search taking forever smh',
            'low similarity scores ngl',
            'search results looking mid',
        ],
        error: [
            'search failed bruh',
            'embedding generation yeeted',
            'query processing caught hands',
        ],
        yeet: [
            'SEARCH COMPLETELY BROKEN',
            'FIND_MEMORY COOKED FR FR',
            'SEMANTIC ENGINE WENT TO GET MILK',
        ],
    },
};
// ============================================================================
// Debug Logger Class
// ============================================================================
class DebugLogger {
    logDir;
    enabledCategories;
    clearIntervalMs = 30 * 60 * 1000; // 30 minutes
    clearInterval = null;
    currentLogFile = null;
    isEnabled;
    constructor() {
        this.logDir = path.join(getSpecmemRoot(), 'logs', 'debug');
        this.isEnabled = this.parseDebugEnv();
        this.enabledCategories = this.parseCategories();
        if (this.isEnabled) {
            this.ensureLogDir();
            this.startClearInterval();
        }
    }
    parseDebugEnv() {
        const debugEnv = process.env['SPECMEM_DEBUG'];
        return debugEnv !== undefined && debugEnv !== '' && debugEnv !== 'false';
    }
    parseCategories() {
        const debugEnv = process.env['SPECMEM_DEBUG'];
        if (!debugEnv || debugEnv === '*' || debugEnv === 'true') {
            return 'all';
        }
        const categories = debugEnv.split(',').map(c => c.trim().toLowerCase());
        const validCategories = [
            'memory', 'database', 'mcp', 'dashboard', 'skills',
            'codebase', 'coordination', 'embedding', 'watcher', 'socket', 'search'
        ];
        return new Set(categories.filter(c => validCategories.includes(c)));
    }
    ensureLogDir() {
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
        }
        catch (err) {
            logger.warn({ err, logDir: this.logDir }, 'bruh couldnt create debug log directory');
        }
    }
    startClearInterval() {
        // Clear old logs every 30 minutes
        this.clearInterval = setInterval(() => {
            this.clearOldLogs();
        }, this.clearIntervalMs);
        // Also clear immediately on startup
        this.clearOldLogs();
        logger.info({
            clearIntervalMs: this.clearIntervalMs
        }, 'debug log auto-clear started - logs older than 30min will get yeeted fr fr');
    }
    clearOldLogs() {
        try {
            if (!fs.existsSync(this.logDir))
                return;
            const files = fs.readdirSync(this.logDir);
            const now = Date.now();
            let clearedCount = 0;
            for (const file of files) {
                if (!file.endsWith('.log') && !file.endsWith('.json'))
                    continue;
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);
                const ageMs = now - stats.mtimeMs;
                // Clear files older than 30 minutes
                if (ageMs > this.clearIntervalMs) {
                    fs.unlinkSync(filePath);
                    clearedCount++;
                }
            }
            if (clearedCount > 0) {
                logger.debug({ clearedCount }, 'yeeted old debug logs no cap');
            }
        }
        catch (err) {
            logger.warn({ err }, 'couldnt clear debug logs smh');
        }
    }
    getLogFilePath() {
        const date = new Date();
        const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return path.join(this.logDir, `debug-${timestamp}.log`);
    }
    isEnabled4Category(category) {
        if (!this.isEnabled)
            return false;
        if (this.enabledCategories === 'all')
            return true;
        return this.enabledCategories.has(category);
    }
    getFunnyMessage(category, level, value) {
        const messages = FUNNY_MESSAGES[category]?.[level];
        if (!messages || messages.length === 0) {
            return 'something happened idk';
        }
        let message = messages[Math.floor(Math.random() * messages.length)];
        if (value !== undefined) {
            message = message.replace('{value}', String(value));
        }
        return message;
    }
    writeLog(entry) {
        try {
            if (!this.currentLogFile) {
                this.currentLogFile = this.getLogFilePath();
            }
            const logLine = JSON.stringify(entry) + '\n';
            fs.appendFileSync(this.currentLogFile, logLine);
            // Also log to pino with appropriate level
            const pinoLevel = entry.level === 'yeet' ? 'error' : entry.level;
            logger[pinoLevel]({
                debugCategory: entry.category,
                debugData: entry.data,
                funnyNote: entry.funnyNote
            }, `[DEBUG] ${entry.message}`);
        }
        catch (err) {
            // Don't log errors about logging - that's too meta
        }
    }
    /**
     * Main log function - call this fr fr
     */
    log(category, level, message, data, valueForFunny) {
        if (!this.isEnabled4Category(category))
            return;
        const entry = {
            timestamp: new Date().toISOString(),
            category,
            level,
            message,
            data,
            funnyNote: this.getFunnyMessage(category, level, valueForFunny),
        };
        this.writeLog(entry);
    }
    /**
     * Convenience methods for different levels
     */
    debug(category, message, data) {
        this.log(category, 'debug', message, data);
    }
    info(category, message, data, value) {
        this.log(category, 'info', message, data, value);
    }
    warn(category, message, data) {
        this.log(category, 'warn', message, data);
    }
    error(category, message, data) {
        this.log(category, 'error', message, data);
    }
    yeet(category, message, data) {
        this.log(category, 'yeet', message, data);
    }
    /**
     * Category-specific helpers for common operations
     */
    dbQuery(query, durationMs, success) {
        const level = !success ? 'error' : durationMs > 1000 ? 'warn' : durationMs > 100 ? 'info' : 'debug';
        this.log('database', level, `Query ${success ? 'completed' : 'failed'}`, {
            query: query.slice(0, 100),
            durationMs,
            success
        }, durationMs);
    }
    memoryUsage(usagePercent, heapUsedMB) {
        const level = usagePercent > 90 ? 'yeet' : usagePercent > 80 ? 'error' : usagePercent > 70 ? 'warn' : 'info';
        this.log('memory', level, `Memory at ${usagePercent.toFixed(1)}%`, {
            usagePercent,
            heapUsedMB
        }, usagePercent.toFixed(0));
    }
    mcpRequest(tool, durationMs, success) {
        const level = !success ? 'error' : durationMs > 5000 ? 'warn' : 'info';
        this.log('mcp', level, `Tool ${tool} ${success ? 'completed' : 'failed'}`, {
            tool,
            durationMs,
            success
        }, durationMs);
    }
    fileIndexed(filePath, chunkCount) {
        this.log('codebase', 'info', `Indexed ${filePath}`, {
            filePath,
            chunkCount
        }, chunkCount);
    }
    skillLoaded(skillName, success) {
        const level = success ? 'info' : 'error';
        this.log('skills', level, `Skill ${skillName} ${success ? 'loaded' : 'failed'}`, {
            skillName,
            success
        });
    }
    /**
     * Socket connection logging - includes socket path for debugging
     */
    socketConnection(socketPath, state, error) {
        const level = state === 'error' ? 'error' : state === 'disconnected' ? 'warn' : 'info';
        this.log('socket', level, `Socket ${state}: ${socketPath}`, {
            socketPath,
            state,
            error: error ? { message: error.message, code: error.code } : undefined
        }, socketPath);
    }
    /**
     * Search operation logging with full context
     */
    searchOperation(query, phase, data) {
        const level = phase === 'error' ? 'error' : phase === 'complete' ? 'info' : 'debug';
        const message = phase === 'error' && data?.error
            ? `Search ${phase}: ${data.error.message}${data.socketPath ? ` (socket: ${data.socketPath})` : ''}`
            : `Search ${phase}: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"`;
        this.log('search', level, message, {
            query: query.slice(0, 100),
            phase,
            ...data,
            error: data?.error ? { message: data.error.message, stack: data.error.stack?.slice(0, 500) } : undefined
        }, data?.durationMs || data?.resultCount);
    }
    /**
     * Embedding generation logging with socket info
     */
    embeddingGeneration(text, socketPath, phase, data) {
        const level = phase === 'error' || phase === 'timeout' ? 'error' : phase === 'complete' ? 'info' : 'debug';
        const message = phase === 'error' || phase === 'timeout'
            ? `Embedding ${phase}: ${data?.error?.message || 'unknown error'} (socket: ${socketPath})`
            : `Embedding ${phase} for "${text.slice(0, 30)}..."`;
        this.log('embedding', level, message, {
            textPreview: text.slice(0, 50),
            socketPath,
            phase,
            ...data,
            error: data?.error ? { message: data.error.message, code: data.error.code } : undefined
        }, data?.durationMs);
    }
    /**
     * Stop the auto-clear interval (call on shutdown)
     */
    shutdown() {
        if (this.clearInterval) {
            clearInterval(this.clearInterval);
            this.clearInterval = null;
        }
        logger.info('debug logger shutdown complete - peace out');
    }
    /**
     * Force clear all debug logs (for testing)
     */
    forceClear() {
        this.clearOldLogs();
    }
    /**
     * Get debug status info
     */
    getStatus() {
        return {
            enabled: this.isEnabled,
            categories: this.enabledCategories === 'all'
                ? ['*']
                : Array.from(this.enabledCategories),
            logDir: this.logDir
        };
    }
}
// ============================================================================
// Singleton Export
// ============================================================================
let debugLoggerInstance = null;
export function getDebugLogger() {
    if (!debugLoggerInstance) {
        debugLoggerInstance = new DebugLogger();
    }
    return debugLoggerInstance;
}
export function resetDebugLogger() {
    if (debugLoggerInstance) {
        debugLoggerInstance.shutdown();
        debugLoggerInstance = null;
    }
}
// Export convenience function for quick access
export function debugLog(category, level, message, data) {
    getDebugLogger().log(category, level, message, data);
}
// Default export
export const dLog = getDebugLogger();
//# sourceMappingURL=debugLogger.js.map