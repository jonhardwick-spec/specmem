/**
 * SpecMem HTTP Client - REST API wrapper for SpecMem
 *
 * Provides typed interfaces and methods for all SpecMem API endpoints.
 * Handles authentication, session management, and error handling.
 *
 * Features:
 * - Automatic retry with exponential backoff for transient failures
 * - Structured logging with configurable levels
 * - Input validation for all parameters
 * - TypeScript strict types throughout
 */
import { HTTP } from '../../constants.js';
import { getPassword } from '../../config/password.js';
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function createLogger(prefix, minLevel = 'info') {
    const minLevelNum = LOG_LEVELS[minLevel];
    const log = (level, message, ...args) => {
        if (LOG_LEVELS[level] >= minLevelNum) {
            const timestamp = new Date().toISOString();
            const levelStr = level.toUpperCase().padEnd(5);
            console[level === 'debug' ? 'log' : level](`[${timestamp}] [${levelStr}] [${prefix}] ${message}`, ...args);
        }
    };
    return {
        debug: (msg, ...args) => log('debug', msg, ...args),
        info: (msg, ...args) => log('info', msg, ...args),
        warn: (msg, ...args) => log('warn', msg, ...args),
        error: (msg, ...args) => log('error', msg, ...args),
    };
}
class RetryableError extends Error {
    statusCode;
    isRetryable;
    constructor(message, statusCode, isRetryable = true) {
        super(message);
        this.statusCode = statusCode;
        this.isRetryable = isRetryable;
        this.name = 'RetryableError';
    }
}
/**
 * ValidationError - Thrown when input validation fails
 */
class ValidationError extends Error {
    fieldName;
    receivedValue;
    constructor(message, fieldName, receivedValue) {
        super(message);
        this.fieldName = fieldName;
        this.receivedValue = receivedValue;
        this.name = 'ValidationError';
    }
}
async function withRetry(fn, options = {}) {
    const { maxRetries = HTTP.MAX_RETRIES, initialDelay = HTTP.INITIAL_RETRY_DELAY_MS, maxDelay = HTTP.MAX_RETRY_DELAY_MS, backoffMultiplier = HTTP.BACKOFF_MULTIPLIER, logger, } = options;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            // Check if error is retryable
            const isRetryable = error instanceof RetryableError ? error.isRetryable : true;
            if (!isRetryable || attempt >= maxRetries) {
                logger?.error(`Request failed after ${attempt + 1} attempt(s): ${lastError.message}`);
                throw lastError;
            }
            // Calculate delay with exponential backoff
            const delay = Math.min(initialDelay * Math.pow(backoffMultiplier, attempt), maxDelay);
            logger?.warn(`Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}
// ============================================================================
// Input Validation
// ============================================================================
/**
 * Check if this shit aint empty or something
 * @yeets {ValidationError} if it looks sus
 */
function stringLooksAightOrNah(value, whatTheThing) {
    if (typeof value !== 'string') {
        throw new ValidationError(`${whatTheThing} gotta be a string bruh, not ${typeof value}`, whatTheThing, value);
    }
    if (value.trim().length === 0) {
        throw new ValidationError(`${whatTheThing} can't be empty yo`, whatTheThing, value);
    }
    return value;
}
/**
 * Validate that a value is a positive number, with optional default
 * @throws {ValidationError} if validation fails
 */
function validatePositiveNumber(value, fieldName, defaultValue) {
    if (value === undefined || value === null) {
        return defaultValue;
    }
    const num = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(num) || num <= 0) {
        throw new ValidationError(`${fieldName} must be a positive number, got ${value}`, fieldName, value);
    }
    return num;
}
/** Valid memory types for SpecMem */
const VALID_MEMORY_TYPES = ['episodic', 'semantic', 'procedural', 'working', 'consolidated'];
/** Valid importance levels */
const VALID_IMPORTANCE_LEVELS = ['low', 'medium', 'high'];
/**
 * Validate memory type
 * @throws {ValidationError} if validation fails
 */
function validateMemoryType(value) {
    if (value && !VALID_MEMORY_TYPES.includes(String(value))) {
        throw new ValidationError(`Invalid memoryType: ${value}. Must be one of: ${VALID_MEMORY_TYPES.join(', ')}`, 'memoryType', value);
    }
    return value;
}
/**
 * Validate importance level
 * @throws {ValidationError} if validation fails
 */
function validateImportance(value) {
    if (value && !VALID_IMPORTANCE_LEVELS.includes(String(value))) {
        throw new ValidationError(`Invalid importance: ${value}. Must be one of: ${VALID_IMPORTANCE_LEVELS.join(', ')}`, 'importance', value);
    }
    return value;
}
/**
 * Validate an array of tags
 */
function validateTags(value) {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new ValidationError('tags must be an array', 'tags', value);
    }
    return value.filter((tag) => typeof tag === 'string');
}
export class SpecMemClient {
    config;
    sessionCookie = null;
    authenticated = false;
    logger;
    maxRetries;
    requestTimeout;
    constructor(config) {
        // Validate required configuration
        this.config = {
            ...config,
            baseUrl: stringLooksAightOrNah(config.baseUrl, 'baseUrl'),
            password: stringLooksAightOrNah(config.password, 'password'),
        };
        this.logger = createLogger('SpecMemClient', config.logLevel || 'info');
        this.maxRetries = config.maxRetries ?? HTTP.MAX_RETRIES;
        this.requestTimeout = config.requestTimeout ?? HTTP.REQUEST_TIMEOUT_MS;
        this.logger.debug(`Initialized with baseUrl: ${config.baseUrl}, maxRetries: ${this.maxRetries}`);
    }
    /**
     * Login to SpecMem and store session cookie
     * Implements retry logic for transient failures
     */
    async login() {
        this.logger.debug('Attempting login...');
        return withRetry(async () => {
            const response = await fetch(`${this.config.baseUrl}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ password: this.config.password }),
            });
            // Check for retryable status codes
            if (!response.ok) {
                const isRetryable = HTTP.RETRYABLE_STATUS_CODES.includes(response.status);
                throw new RetryableError(`Login failed: ${response.status} ${response.statusText}`, response.status, isRetryable);
            }
            // Extract and store session cookie
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) {
                // Extract just the session cookie value
                const match = setCookie.match(/connect\.sid=([^;]+)/);
                if (match) {
                    this.sessionCookie = `connect.sid=${match[1]}`;
                    this.authenticated = true;
                    this.logger.info('Login successful');
                    return true;
                }
            }
            // Even without cookie extraction, check response
            const data = (await response.json());
            if (data.success) {
                this.authenticated = true;
                this.logger.info('Login successful (no cookie needed)');
                return true;
            }
            throw new RetryableError('Login failed: Invalid response', undefined, false);
        }, {
            maxRetries: this.maxRetries,
            logger: this.logger,
        }).catch((error) => {
            this.logger.error(`Login error: ${error.message}`);
            return false;
        });
    }
    /**
     * Make an authenticated request with retry logic
     */
    async request(endpoint, method = 'GET', body) {
        // Validate endpoint
        stringLooksAightOrNah(endpoint, 'endpoint');
        // Auto-login if not authenticated
        if (!this.authenticated) {
            this.logger.debug(`Not authenticated, attempting login before request to ${endpoint}`);
            const loggedIn = await this.login();
            if (!loggedIn) {
                this.logger.error('Authentication failed, cannot make request');
                return { success: false, error: 'Authentication failed' };
            }
        }
        return withRetry(async () => {
            const headers = {
                'Content-Type': 'application/json',
            };
            if (this.sessionCookie) {
                headers['Cookie'] = this.sessionCookie;
            }
            this.logger.debug(`Making ${method} request to ${endpoint}`);
            const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });
            // Handle 401 - try to re-authenticate once
            if (response.status === 401) {
                this.logger.warn('Received 401, attempting re-authentication');
                this.authenticated = false;
                const loggedIn = await this.login();
                if (loggedIn) {
                    // Throw retryable error to trigger retry with new auth
                    throw new RetryableError('Re-authenticated, retrying request', 401, true);
                }
                throw new RetryableError('Authentication required', 401, false);
            }
            // Check for retryable status codes
            if (!response.ok) {
                const isRetryable = HTTP.RETRYABLE_STATUS_CODES.includes(response.status);
                throw new RetryableError(`Request failed: ${response.status} ${response.statusText}`, response.status, isRetryable);
            }
            const data = await response.json();
            this.logger.debug(`Request to ${endpoint} successful`);
            return data;
        }, {
            maxRetries: this.maxRetries,
            logger: this.logger,
        }).catch((error) => {
            this.logger.error(`Request error (${endpoint}): ${error.message}`);
            return { success: false, error: String(error.message) };
        });
    }
    /**
     * Store a memory with validation
     */
    async remember(content, options = {}) {
        // Validate inputs
        const validatedContent = stringLooksAightOrNah(content, 'content');
        const validatedMemoryType = validateMemoryType(options.memoryType) || 'episodic';
        const validatedImportance = validateImportance(options.importance) || 'medium';
        const validatedTags = validateTags(options.tags);
        this.logger.debug(`Storing memory: ${validatedContent.substring(0, 50)}...`);
        const response = await this.request('/api/specmem/remember', 'POST', {
            content: validatedContent,
            memoryType: validatedMemoryType,
            importance: validatedImportance,
            tags: validatedTags,
            metadata: options.metadata || {},
        });
        if (response.success && response.memory) {
            this.logger.info(`Memory yeeted into the database fr fr - ID: ${response.memory.id}`);
            return response.memory;
        }
        this.logger.error(`Remember failed: ${response.error}`);
        return null;
    }
    /**
     * Search for memories with validation
     */
    async find(query, options = {}) {
        // Validate inputs
        const validatedQuery = stringLooksAightOrNah(query, 'query');
        const validatedLimit = validatePositiveNumber(options.limit, 'limit', 10);
        this.logger.debug(`Searching for: "${validatedQuery.substring(0, 30)}..." (limit: ${validatedLimit})`);
        const response = await this.request('/api/specmem/find', 'POST', {
            query: validatedQuery,
            limit: validatedLimit,
            memoryType: options.memoryType,
            tags: options.tags,
        });
        if (response.success && response.memories) {
            this.logger.info(`Found ${response.memories.length} memories`);
            return response.memories;
        }
        this.logger.error(`Find failed: ${response.error}`);
        return [];
    }
    /**
     * Semantic search (context-aware) with validation
     */
    async semanticSearch(query, limit = 5) {
        // Validate inputs
        const validatedQuery = stringLooksAightOrNah(query, 'query');
        const validatedLimit = validatePositiveNumber(limit, 'limit', 5);
        this.logger.debug(`Semantic search for: "${validatedQuery.substring(0, 30)}..." (limit: ${validatedLimit})`);
        const response = await this.request('/api/specmem/semantic', 'POST', {
            query: validatedQuery,
            limit: validatedLimit,
        });
        if (response.success && response.memories) {
            this.logger.info(`Semantic search found ${response.memories.length} memories`);
            return response.memories;
        }
        this.logger.warn('Semantic search returned no results');
        return [];
    }
    /**
     * Delete a memory by ID with validation
     */
    async delete(id) {
        // Validate inputs
        const validatedId = stringLooksAightOrNah(id, 'id');
        this.logger.debug(`Deleting memory with ID: ${validatedId}`);
        const response = await this.request(`/api/specmem/delete/${validatedId}`, 'DELETE');
        if (response.success) {
            this.logger.info(`Memory ${validatedId} yeeted outta here, no cap`);
        }
        else {
            this.logger.error(`Couldn't yeet memory ${validatedId} lmao: ${response.error}`);
        }
        return response.success;
    }
    /**
     * Get memory statistics
     */
    async getStats() {
        this.logger.debug('Fetching memory statistics');
        const response = await this.request('/api/specmem/stats', 'GET');
        if (response.success) {
            this.logger.info('Stats grabbed fr fr');
            // The API response has database and memory at the response level
            const anyResponse = response;
            return {
                database: response.database,
                memory: anyResponse.memory,
            };
        }
        this.logger.error(`Failed to fetch statistics: ${response.error}`);
        return null;
    }
    /**
     * Link two memories together with validation
     */
    async linkMemories(sourceId, targetId, relationType = 'related') {
        // Validate inputs
        const validatedSourceId = stringLooksAightOrNah(sourceId, 'sourceId');
        const validatedTargetId = stringLooksAightOrNah(targetId, 'targetId');
        const validatedRelationType = stringLooksAightOrNah(relationType, 'relationType');
        this.logger.debug(`Linking memory ${validatedSourceId} to ${validatedTargetId} (type: ${validatedRelationType})`);
        const response = await this.request('/api/specmem/link', 'POST', {
            sourceId: validatedSourceId,
            targetId: validatedTargetId,
            relationType: validatedRelationType,
        });
        if (response.success) {
            this.logger.info(`Memories linked up, let's go!`);
        }
        else {
            this.logger.error(`Memories ain't linking bruh: ${response.error}`);
        }
        return response.success;
    }
    /**
     * Check if client is authenticated
     */
    isAuthenticated() {
        return this.authenticated;
    }
    /**
     * Get current config
     */
    getConfig() {
        return { ...this.config };
    }
}
// Export default instance factory
export function createSpecMemClient(config) {
    const logLevel = process.env.SPECMEM_LOG_LEVEL || 'info';
    // Use centralized password module for consistent password resolution
    const password = config?.password || getPassword();
    return new SpecMemClient({
        baseUrl: config?.baseUrl || process.env.SPECMEM_API_URL || 'http://127.0.0.1:8595',
        password,
        teamMemberId: config?.teamMemberId,
        logLevel: config?.logLevel || logLevel,
        maxRetries: config?.maxRetries,
        requestTimeout: config?.requestTimeout,
    });
}
// Export utilities for testing and external use
export { createLogger, withRetry, RetryableError, ValidationError };
// Export validation functions for testing (Team Member A addition)
export { stringLooksAightOrNah, validatePositiveNumber, validateMemoryType, validateImportance, validateTags, VALID_MEMORY_TYPES, VALID_IMPORTANCE_LEVELS, };
//# sourceMappingURL=specmemClient.js.map