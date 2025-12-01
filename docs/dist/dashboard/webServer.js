/**
 * webServer.ts - CSGO-Themed SpecMem Web Dashboard
 *
 * A badass web dashboard with CS:GO vibes for managing the SpecMem MCP Server.
 * Yellow (#FFD700) and Black (#000000) color scheme with modal-based UI.
 *
 * Features:
 * - Login system with password protection
 * - Memory management (view/search/delete)
 * - Session management (Claude sessions)
 * - Codebase browser
 * - Skills manager
 * - Team member coordination viewer
 * - Statistics dashboard
 * - Configuration panel
 *
 * @author hardwicksoftwareservices
 */
// @ts-ignore - express types not installed
import express from 'express';
// @ts-ignore - express-session types not installed
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { isPortAvailable, sleep } from '../utils/portUtils.js';
import { getDatabase } from '../database.js';
import { createSessionStore } from './sessionStore.js';
import { requestTimeout, setServerTimeouts } from '../utils/timeoutMiddleware.js';
import { getSkillScanner } from '../skills/skillScanner.js';
import { getCodebaseIndexer } from '../codebase/codebaseIndexer.js';
import { getMemoryManager } from '../utils/memoryManager.js';
import { getTeamMemberTracker } from '../team-members/teamMemberTracker.js';
import { getTeamMemberDeployment } from '../team-members/teamMemberDeployment.js';
import { getTeamMemberHistoryManager } from '../team-members/teamMemberHistory.js';
import { createTeamMemberDiscovery } from '../team-members/teamMemberDiscovery.js';
import { createTeamMemberCommunicator } from '../team-members/communication.js';
import { createMemoryRecallRouter } from './api/memoryRecall.js';
import { createTeamMemberHistoryRouter } from './api/teamMemberHistory.js';
import { createTeamMemberDeployRouter } from './api/teamMemberDeploy.js';
import { initializeTeamMemberStream, shutdownTeamMemberStream } from './websocket/teamMemberStream.js';
// Phase 4-6 imports for Direct Prompting, Terminal Streaming, and Claude Control
import { createPromptSendRouter } from './api/promptSend.js';
import { createTerminalRouter } from './api/terminal.js';
import { createClaudeControlRouter } from './api/claudeControl.js';
import { createSpecmemToolsRouter } from './api/specmemTools.js';
import { createTerminalInjectRouter } from './api/terminalInject.js';
import { createTerminalStreamRouter, handleTerminalWebSocket } from './api/terminalStream.js';
// Live Session Streaming - Team Member 2's LIVE Claude Code session viewer!
import { createLiveSessionRouter } from './api/liveSessionStream.js';
// Task team member logging
import { createTaskTeamMembersRouter } from './api/taskTeamMembers.js';
import { initializeTaskTeamMemberLogger } from '../team-members/taskTeamMemberLogger.js';
// File Manager - FTP-style file browsing for codebase management
import { createFileManagerRouter } from './api/fileManager.js';
// Settings API - Password management and dashboard configuration
import { createSettingsRouter } from './api/settings.js';
// Setup API - Dashboard mode switching and initial setup
import { createSetupRouter } from './api/setup.js';
// Data Export API - Export PostgreSQL tables to JSON
import { createDataExportRouter } from './api/dataExport.js';
// Hot Reload API - Dashboard control for hot reload system
import { createHotReloadRouter } from './api/hotReload.js';
// Camera Roll Search - zoom-based memory exploration
import { ZOOM_CONFIGS, formatAsCameraRollItem, formatAsCameraRollResponse } from '../services/CameraZoomSearch.js';
// Hooks Management API - User-manageable custom hooks
import { hooksRouter } from './api/hooks.js';
// Centralized password management
import { getPassword, checkPassword, isUsingDefaultPassword, changePasswordWithTeamMemberNotification } from '../config/password.js';
// Port allocation for unique per-instance ports
import { getInstancePortsSync, getDashboardPort, getCoordinationPort, getPortAllocationSummary, PORT_CONFIG } from '../utils/portAllocator.js';
// Project path for database isolation
import { getProjectPathForInsert } from '../services/ProjectContext.js';
// ============================================================================
// Zod Validation Schemas for Dashboard API
// ============================================================================
const MemoriesQuerySchema = z.object({
    search: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().min(0).default(0)
});
const BulkDeleteMemoriesSchema = z.object({
    ids: z.array(z.string().uuid()).optional(),
    olderThan: z.string().datetime().optional(),
    tags: z.array(z.string()).optional(),
    expiredOnly: z.boolean().optional()
}).refine(data => data.ids || data.olderThan || data.tags || data.expiredOnly, { message: 'At least one deletion criterion required (ids, olderThan, tags, or expiredOnly)' });
// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ============================================================================
// Default Configuration
// ============================================================================
/**
 * Get or create a persistent session secret
 * - First checks SPECMEM_SESSION_SECRET env var
 * - Then checks SPECMEM_SESSION_SECRET_FILE for file-based secret
 * - Falls back to generating one (logged as warning since it won't persist)
 */
function getSessionSecret() {
    // Option 1: Environment variable
    const envSecret = process.env['SPECMEM_SESSION_SECRET'];
    if (envSecret && envSecret.length >= 32) {
        logger.debug('using session secret from SPECMEM_SESSION_SECRET env var');
        return envSecret;
    }
    // Option 2: File-based secret
    const secretFile = process.env['SPECMEM_SESSION_SECRET_FILE'];
    if (secretFile) {
        try {
            const fsSync = require('fs');
            if (fsSync.existsSync(secretFile)) {
                const fileSecret = fsSync.readFileSync(secretFile, 'utf-8').trim();
                if (fileSecret.length >= 32) {
                    logger.debug({ secretFile }, 'using session secret from file');
                    return fileSecret;
                }
            }
        }
        catch (e) {
            logger.warn({ secretFile, error: e }, 'couldnt read session secret file');
        }
    }
    // Option 3: Generate new (sessions won't persist across restarts)
    logger.warn('generating random session secret - sessions will not persist across restarts bruh');
    logger.warn('set SPECMEM_SESSION_SECRET or SPECMEM_SESSION_SECRET_FILE env var for persistent sessions');
    return crypto.randomBytes(32).toString('hex');
}
/**
 * Get dashboard mode from environment
 * - 'private' (default): Localhost only, more secure
 * - 'public': Network accessible, requires strong password
 */
function getDashboardMode() {
    const mode = process.env['SPECMEM_DASHBOARD_MODE'];
    if (mode === 'public')
        return 'public';
    return 'private';
}
/**
 * Get dashboard host based on mode
 * Private mode: Always 127.0.0.1 (localhost only)
 * Public mode: Use SPECMEM_DASHBOARD_HOST or 0.0.0.0 (all interfaces)
 */
function getDashboardHost() {
    const mode = getDashboardMode();
    if (mode === 'private') {
        return '127.0.0.1';
    }
    return process.env['SPECMEM_DASHBOARD_HOST'] || '0.0.0.0';
}
const DEFAULT_CONFIG = {
    // Use dynamic port from portAllocator (project-hash derived)
    port: parseInt(process.env['SPECMEM_DASHBOARD_PORT'] || '', 10) || getDashboardPort(),
    host: getDashboardHost(),
    mode: getDashboardMode(),
    sessionSecret: getSessionSecret(),
    password: '', // Must be set via SPECMEM_DASHBOARD_PASSWORD env var
    // Use dynamic coordination port from portAllocator (project-hash derived)
    coordinationPort: parseInt(process.env['SPECMEM_COORDINATION_PORT'] || '', 10) || getCoordinationPort(),
    maxPortAttempts: 10,
    maxStartupRetries: 3,
    retryDelayMs: 1000
};
// ============================================================================
// Dashboard Web Server
// ============================================================================
export class DashboardWebServer {
    config;
    app;
    server;
    wss;
    isRunning = false;
    startTime = 0;
    actualPort = 0; // The port we actually bound to
    db = null;
    sessionStore = null;
    skillScanner = null;
    codebaseIndexer = null;
    embeddingProvider = null;
    memoryManager = null;
    embeddingOverflowHandler = null;
    connectedClients = new Set();
    envFilePath = null;
    teamMemberTracker = null;
    teamMemberDeployment = null;
    teamMemberHistoryManager = null;
    terminalStreamManager = null;
    teamMemberStreamManager = null;
    dashboardCommunicator = null;
    dashboardDiscovery = null; // TeamMemberDiscovery instance for querying team members
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.app = express();
        this.server = createServer(this.app);
        // CRITICAL: Set HTTP server keepalive to prevent connection drops
        this.server.keepAliveTimeout = 120000; // 120 seconds
        this.server.headersTimeout = 125000; // Must be > keepAliveTimeout
        // CRITICAL FIX: Use noServer mode to prevent conflicts with other WebSocket handlers
        // When multiple WebSocketServers are attached to the same HTTP server, they ALL
        // receive the 'upgrade' event, causing the RSV1/1006 close bug where one WSS
        // sends a 400 error after another has already completed the upgrade.
        this.wss = new WebSocketServer({
            noServer: true,
            perMessageDeflate: false, // Disable compression to prevent issues
            clientTracking: true,
            maxPayload: 100 * 1024 * 1024 // 100MB max message size
        });
        // Centralized upgrade handling - route to appropriate WebSocket server
        this.server.on('upgrade', (request, socket, head) => {
            const url = new URL(request.url || '/', `http://${request.headers.host}`);
            const pathname = url.pathname;
            // Skip paths handled by other WebSocket managers (TeamMemberStreamManager handles /ws/team-members/live)
            if (pathname === '/ws/team-members/live') {
                // Let TeamMemberStreamManager handle this
                return;
            }
            // Handle all other WebSocket paths
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request);
            });
        });
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
    }
    /**
     * Setup Express middleware
     */
    setupMiddleware() {
        // Parse JSON bodies
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        // Request timeout middleware - prevents long-running requests from hanging
        // Configurable via SPECMEM_REQUEST_TIMEOUT env var (default: 30 seconds)
        this.app.use(requestTimeout({
            timeout: parseInt(process.env['SPECMEM_REQUEST_TIMEOUT'] || '30000', 10),
            message: 'Request timeout - try again or reduce the scope of your request',
            log: true
        }));
        // Rate limiting for API endpoints
        const apiLimiter = rateLimit({
            windowMs: 1 * 60 * 1000, // 1 minute window (faster reset)
            max: 1000, // 1000 requests per minute (teamMembers need this!)
            message: { error: 'Too many requests, please try again later' },
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => {
                // Skip rate limiting for localhost (teamMembers running on same machine)
                const ip = req.ip || req.socket.remoteAddress || '';
                return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
            }
        });
        // Much more relaxed auth limiting for team member communication
        const authLimiter = rateLimit({
            windowMs: 1 * 60 * 1000, // 1 minute window
            max: 500, // 500 logins per minute (teamMembers retry a lot!)
            message: { error: 'Too many login attempts, please try again later' },
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => {
                // Skip rate limiting for localhost
                const ip = req.ip || req.socket.remoteAddress || '';
                return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
            }
        });
        // Apply rate limiting to API routes (but localhost is exempt!)
        this.app.use('/api/', apiLimiter);
        this.app.use('/api/login', authLimiter);
        // Session management
        // Cookie secure flag configurable via SPECMEM_COOKIE_SECURE env var (default: false)
        const cookieSecure = process.env.SPECMEM_COOKIE_SECURE === 'true';
        // Session options - store will be set in start() if database is available
        const sessionOptions = {
            secret: this.config.sessionSecret,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: cookieSecure,
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            }
        };
        // Note: We configure the session store in start() after database is available
        // For now, use the default memory store (will be replaced in start())
        this.app.use(session(sessionOptions));
        // Serve static files - React app takes priority
        this.app.use(express.static(path.join(__dirname, 'public', 'react-dist')));
        this.app.use(express.static(path.join(__dirname, 'public')));
        // CORS headers for API
        // Private mode: restricted to localhost origins only
        // Public mode: allows configured origins or same-origin requests
        // Use dynamic ports for per-project isolation
        const dynamicDashboardPort = this.config.port;
        const dynamicCoordinationPort = this.config.coordinationPort;
        const allowedOrigins = [
            `http://localhost:${dynamicDashboardPort}`,
            `http://127.0.0.1:${dynamicDashboardPort}`,
            `http://localhost:${dynamicCoordinationPort}`,
            `http://127.0.0.1:${dynamicCoordinationPort}`
        ];
        // In public mode, add the actual host binding to allowed origins
        if (this.config.mode === 'public') {
            // Allow requests from any host the server is bound to
            allowedOrigins.push(`http://${this.config.host}:${this.config.port}`);
            // Also allow requests from the local machine's actual IP/hostname
            // The origin will be validated against what the browser sends
        }
        this.app.use((req, res, next) => {
            const origin = req.headers.origin;
            if (this.config.mode === 'public') {
                // In public mode, use whitelist for CORS instead of reflecting any origin
                // This prevents CSRF attacks while still allowing legitimate cross-origin requests
                const publicModeWhitelist = [
                    ...allowedOrigins,
                    `http://${this.config.host}:${this.config.port}`,
                    // Allow common local development origins
                    'http://localhost:3000',
                    'http://localhost:5173',
                    'http://127.0.0.1:3000',
                    'http://127.0.0.1:5173'
                ];
                if (origin && publicModeWhitelist.includes(origin)) {
                    res.header('Access-Control-Allow-Origin', origin);
                    res.header('Access-Control-Allow-Credentials', 'true');
                }
            }
            else {
                // Private mode: strict origin checking
                if (origin && allowedOrigins.includes(origin)) {
                    res.header('Access-Control-Allow-Origin', origin);
                }
            }
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            if (req.method === 'OPTIONS') {
                res.sendStatus(204);
                return;
            }
            next();
        });
    }
    /**
     * Authentication middleware
     */
    requireAuth(req, res, next) {
        const session = req.session;
        if (session?.authenticated) {
            next();
        }
        else {
            res.status(401).json({ error: 'Authentication required' });
        }
    }
    /**
     * Setup Express routes
     */
    setupRoutes() {
        // ==================== PUBLIC ROUTES ====================
        // Serve React app index.html
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'react-dist', 'index.html'));
        });
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                uptime: this.isRunning ? Date.now() - this.startTime : 0,
                service: 'specmem-dashboard'
            });
        });
        // Login endpoint - uses centralized password management
        this.app.post('/api/login', (req, res) => {
            const { password } = req.body;
            // Use centralized password check (supports runtime updates)
            if (checkPassword(password)) {
                const sess = req.session;
                sess.authenticated = true;
                sess.loginTime = Date.now();
                logger.info('Dashboard login successful');
                // Warn if using default password
                if (isUsingDefaultPassword()) {
                    logger.warn('Login with DEFAULT password - consider changing for security');
                }
                res.json({ success: true, message: 'Login successful' });
            }
            else {
                logger.warn('Dashboard login failed - incorrect password');
                res.status(401).json({ error: 'Invalid password' });
            }
        });
        // Logout endpoint
        this.app.post('/api/logout', (req, res) => {
            req.session.destroy((err) => {
                if (err) {
                    logger.error({ err }, 'Error destroying session');
                    res.status(500).json({ error: 'Logout failed' });
                }
                else {
                    res.json({ success: true, message: 'Logged out' });
                }
            });
        });
        // Check auth status
        this.app.get('/api/auth/status', (req, res) => {
            const sess = req.session;
            res.json({
                authenticated: !!sess?.authenticated,
                loginTime: sess?.loginTime || null
            });
        });
        // Client-side logging endpoint - logs browser errors/messages to server
        // This allows dashboard pages to send errors to the server for proper logging
        this.app.post('/api/log', (req, res) => {
            const { level, message, page, data } = req.body;
            // Validate level
            const validLevels = ['info', 'warn', 'error', 'debug'];
            const logLevel = validLevels.includes(level) ? level : 'info';
            // Construct log context
            const logContext = {
                source: 'dashboard-client',
                page: page || 'unknown',
                userAgent: req.headers['user-agent'],
                ...(data && typeof data === 'object' ? data : { extra: data })
            };
            // Log using the appropriate level
            switch (logLevel) {
                case 'error':
                    logger.error(logContext, `[Dashboard] ${message}`);
                    break;
                case 'warn':
                    logger.warn(logContext, `[Dashboard] ${message}`);
                    break;
                case 'debug':
                    logger.debug(logContext, `[Dashboard] ${message}`);
                    break;
                default:
                    logger.info(logContext, `[Dashboard] ${message}`);
            }
            res.json({ success: true });
        });
        // ==================== PROTECTED ROUTES ====================
        // Port allocation status endpoint - shows allocated ports for this instance
        this.app.get('/api/ports', this.requireAuth.bind(this), async (req, res) => {
            try {
                const allocatedPorts = getInstancePortsSync();
                if (allocatedPorts) {
                    const summary = getPortAllocationSummary(allocatedPorts);
                    res.json({
                        success: true,
                        allocated: true,
                        ports: {
                            dashboard: summary.dashboard,
                            coordination: summary.coordination
                        },
                        projectPath: summary.projectPath,
                        verified: summary.verified,
                        config: {
                            minPort: PORT_CONFIG.MIN_PORT,
                            maxPort: PORT_CONFIG.MAX_PORT,
                            defaults: PORT_CONFIG.DEFAULTS
                        }
                    });
                }
                else {
                    // Fallback to current configuration
                    res.json({
                        success: true,
                        allocated: false,
                        ports: {
                            dashboard: {
                                port: getDashboardPort(),
                                url: `http://localhost:${getDashboardPort()}`
                            },
                            coordination: {
                                port: getCoordinationPort(),
                                wsUrl: `ws://localhost:${getCoordinationPort()}/teamMembers`
                            }
                        },
                        projectPath: process.cwd(),
                        config: {
                            minPort: PORT_CONFIG.MIN_PORT,
                            maxPort: PORT_CONFIG.MAX_PORT,
                            defaults: PORT_CONFIG.DEFAULTS
                        }
                    });
                }
            }
            catch (error) {
                logger.error({ error }, 'Error fetching port allocation');
                res.status(500).json({ error: 'Port info not available' });
            }
        });
        // Database metrics endpoint (#31)
        this.app.get('/api/metrics/database', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.db) {
                    res.status(503).json({ error: 'Database not connected bruh' });
                    return;
                }
                const metrics = await this.db.getDetailedMetrics();
                res.json(metrics);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching database metrics');
                res.status(500).json({ error: 'Database metrics said nah fr fr' });
            }
        });
        // Stats dashboard
        this.app.get('/api/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.getStats();
                res.json(stats);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching stats');
                res.status(500).json({ error: 'Stats ain\'t loading bruh' });
            }
        });
        // Memory management routes
        this.app.get('/api/memories', this.requireAuth.bind(this), async (req, res) => {
            try {
                const parseResult = MemoriesQuerySchema.safeParse(req.query);
                if (!parseResult.success) {
                    res.status(400).json({
                        error: 'Invalid query parameters',
                        details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                    });
                    return;
                }
                const { search, limit, offset } = parseResult.data;
                const memories = await this.getMemories(search, limit, offset);
                res.json(memories);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching memories');
                res.status(500).json({ error: 'Memories not loading lmao' });
            }
        });
        // Search memories - MUST be before :id route to avoid matching "search" as an ID
        // Supports camera roll mode for zoom-based exploration with drilldown IDs
        this.app.get('/api/memories/search', this.requireAuth.bind(this), async (req, res) => {
            try {
                const q = req.query.q || req.query.query || '';
                const limit = parseInt(req.query.limit) || 50;
                const offset = parseInt(req.query.offset) || 0;
                // Camera roll mode parameters
                const cameraRollMode = req.query.cameraRollMode === 'true' || req.query.cameraRollMode === '1';
                const zoomLevelParam = req.query.zoomLevel;
                const validZoomLevels = ['ultra-wide', 'wide', 'normal', 'close', 'macro'];
                const zoomLevel = validZoomLevels.includes(zoomLevelParam)
                    ? zoomLevelParam
                    : 'normal';
                // Standard search mode (backward compatible)
                if (!cameraRollMode) {
                    const memories = await this.getMemories(q, limit, offset);
                    res.json({ success: true, query: q, memories: memories.memories, total: memories.total });
                    return;
                }
                // Camera roll mode - use zoom-based search with drilldown IDs
                const zoomConfig = ZOOM_CONFIGS[zoomLevel];
                const effectiveLimit = Math.min(limit, zoomConfig.limit);
                // Perform the search with zoom-appropriate threshold
                const searchResult = await this.getCameraRollMemories(q, zoomConfig.threshold, effectiveLimit, offset);
                // Format results as CameraRollItems with drilldown IDs
                const items = searchResult.memories.map((memory) => {
                    return formatAsCameraRollItem({
                        id: memory.id,
                        content: memory.content,
                        similarity: memory.similarity || 0.5,
                        metadata: memory.metadata,
                        tags: memory.tags,
                        createdAt: memory.created_at
                    }, zoomConfig, {
                        claudeResponse: memory.metadata?.claudeResponse,
                        relatedCount: memory.metadata?.relatedCount,
                        codePointers: memory.metadata?.codePointers
                    });
                });
                // Format as CameraRollResponse - now returns compact XML string
                const xmlResponse = formatAsCameraRollResponse(items, q, zoomLevel, searchResult.searchType === 'hybrid' ? 'hybrid' : 'memory', searchResult.total);
                // Extract drilldownIDs for easy access
                const drilldownIDs = items.map(item => item.drilldownID);
                // Return XML directly with metadata
                res.json({
                    success: true,
                    cameraRollMode: true,
                    drilldownIDs,
                    response: xmlResponse
                });
            }
            catch (error) {
                logger.error({ error }, 'Error searching memories');
                res.status(500).json({ error: 'Memory search failed fr' });
            }
        });
        // Get single memory by ID
        this.app.get('/api/memories/:id', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const memory = await this.getMemoryById(id);
                if (!memory) {
                    res.status(404).json({ error: 'Memory not found' });
                    return;
                }
                res.json(memory);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching memory');
                res.status(500).json({ error: 'Memory fetch broke fr' });
            }
        });
        this.app.delete('/api/memories/:id', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                await this.deleteMemory(id);
                res.json({ success: true, message: 'Memory deleted' });
            }
            catch (error) {
                logger.error({ error }, 'Error deleting memory');
                res.status(500).json({ error: 'Couldn\'t yeet that memory' });
            }
        });
        // Bulk delete memories
        this.app.post('/api/memories/bulk-delete', this.requireAuth.bind(this), async (req, res) => {
            try {
                const parseResult = BulkDeleteMemoriesSchema.safeParse(req.body);
                if (!parseResult.success) {
                    res.status(400).json({
                        error: 'Invalid request body',
                        details: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
                    });
                    return;
                }
                const { ids, olderThan, tags, expiredOnly } = parseResult.data;
                const result = await this.bulkDeleteMemories({ ids, olderThan, tags, expiredOnly });
                res.json({ success: true, deleted: result.deleted, message: `${result.deleted} memories deleted` });
            }
            catch (error) {
                logger.error({ error }, 'Error bulk deleting memories');
                res.status(500).json({ error: 'Bulk delete didn\'t work rip' });
            }
        });
        // Session management routes
        this.app.get('/api/sessions', this.requireAuth.bind(this), async (req, res) => {
            try {
                const sessions = await this.getSessions();
                res.json(sessions);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching sessions');
                res.status(500).json({ error: 'Sessions not loading yo' });
            }
        });
        // Get session details by ID
        this.app.get('/api/sessions/:id', this.requireAuth.bind(this), async (req, res) => {
            try {
                const sessionId = req.params.id;
                // Validate session ID format - must be alphanumeric with dashes/underscores (UUID-like or custom format)
                // Prevents SQL injection and other attacks via malformed session IDs
                const sessionIdRegex = /^[a-zA-Z0-9_-]{1,128}$/;
                if (!sessionIdRegex.test(sessionId)) {
                    res.status(400).json({ error: 'Invalid session ID format' });
                    return;
                }
                if (!this.db) {
                    res.status(503).json({ error: 'Database not connected' });
                    return;
                }
                // Get session details from memories - use sessionId (camelCase) from metadata
                const sessionQuery = `
          WITH session_tags AS (
            SELECT DISTINCT unnest(tags) as tag
            FROM memories
            WHERE COALESCE(metadata->>'sessionId', metadata->>'session_id') = $1
          )
          SELECT
            COALESCE(metadata->>'sessionId', metadata->>'session_id') as session_id,
            MIN(created_at) as started_at,
            MAX(updated_at) as last_activity,
            COUNT(*) as memory_count,
            COUNT(DISTINCT memory_type) as memory_types_used,
            array_agg(DISTINCT memory_type) as memory_types,
            array_agg(DISTINCT importance) as importance_levels,
            (SELECT array_agg(tag) FROM session_tags) as all_tags,
            MAX(metadata->>'project') as project,
            MAX(metadata->>'workingDirectory') as working_directory
          FROM memories
          WHERE COALESCE(metadata->>'sessionId', metadata->>'session_id') = $1
          GROUP BY COALESCE(metadata->>'sessionId', metadata->>'session_id')
        `;
                const result = await this.db.query(sessionQuery, [sessionId]);
                if (result.rows.length === 0) {
                    res.status(404).json({ error: 'Session not found' });
                    return;
                }
                const session = result.rows[0];
                // Get memories for this session - use sessionId (camelCase) from metadata
                const memoriesQuery = `
          SELECT id, content, memory_type, importance, tags, created_at, updated_at, metadata
          FROM memories
          WHERE COALESCE(metadata->>'sessionId', metadata->>'session_id') = $1
          ORDER BY created_at DESC
          LIMIT 100
        `;
                const memories = await this.db.query(memoriesQuery, [sessionId]);
                res.json({
                    ...session,
                    memories: memories.rows,
                    duration_minutes: session.last_activity && session.started_at
                        ? (new Date(session.last_activity).getTime() - new Date(session.started_at).getTime()) / 60000
                        : 0
                });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching session details');
                res.status(500).json({ error: 'Session details broke' });
            }
        });
        // Get messages for a session
        this.app.get('/api/sessions/:id/messages', this.requireAuth.bind(this), async (req, res) => {
            try {
                const sessionId = req.params.id;
                // Validate session ID format - must be alphanumeric with dashes/underscores
                const sessionIdRegex = /^[a-zA-Z0-9_-]{1,128}$/;
                if (!sessionIdRegex.test(sessionId)) {
                    res.status(400).json({ error: 'Invalid session ID format' });
                    return;
                }
                if (!this.db) {
                    res.status(503).json({ error: 'Database not connected' });
                    return;
                }
                // Get memories for this session (these are the "messages") - use sessionId (camelCase)
                const query = `
          SELECT
            id,
            content,
            memory_type,
            importance,
            tags,
            created_at,
            updated_at,
            metadata
          FROM memories
          WHERE COALESCE(metadata->>'sessionId', metadata->>'session_id') = $1
          ORDER BY created_at ASC
        `;
                const result = await this.db.query(query, [sessionId]);
                res.json(result.rows);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching session messages');
                res.status(500).json({ error: 'Session messages ain\'t showing' });
            }
        });
        // Codebase browser routes
        this.app.get('/api/codebase', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { path: filePath, search } = req.query;
                const files = await this.getCodebaseFiles(filePath, search);
                res.json(files);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching codebase');
                res.status(500).json({ error: 'Codebase fetch broke lmao' });
            }
        });
        // Get file content from codebase
        this.app.get('/api/codebase/file', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { path: filePath } = req.query;
                if (!filePath || typeof filePath !== 'string') {
                    res.status(400).json({ error: 'File path required' });
                    return;
                }
                const fileContent = await this.getFileContent(filePath);
                if (!fileContent) {
                    res.status(404).json({ error: 'File not found' });
                    return;
                }
                res.json(fileContent);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching file content');
                res.status(500).json({ error: 'File content not loading' });
            }
        });
        // Skills manager routes
        this.app.get('/api/skills', this.requireAuth.bind(this), async (req, res) => {
            try {
                const skills = await this.getSkills();
                res.json(skills);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching skills');
                res.status(500).json({ error: 'Skills ain\'t loading' });
            }
        });
        this.app.post('/api/skills/reload', this.requireAuth.bind(this), async (req, res) => {
            try {
                await this.reloadSkills();
                res.json({ success: true, message: 'Skills reloaded' });
            }
            catch (error) {
                logger.error({ error }, 'Error reloading skills');
                res.status(500).json({ error: 'Skills reload broke' });
            }
        });
        // Get individual skill content by name
        this.app.get('/api/skills/:name', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.skillScanner) {
                    res.status(503).json({ error: 'Skills system not initialized' });
                    return;
                }
                const skillName = decodeURIComponent(req.params.name);
                const skills = this.skillScanner.getAllSkills();
                const skill = skills.find(s => s.name === skillName || s.id === skillName);
                if (!skill) {
                    res.status(404).json({ error: 'Skill not found' });
                    return;
                }
                res.json({
                    id: skill.id,
                    name: skill.name,
                    category: skill.category,
                    description: skill.description,
                    content: skill.content,
                    path: skill.filePath
                });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching skill content');
                res.status(500).json({ error: 'Skill content not loading' });
            }
        });
        // Update skill content
        this.app.put('/api/skills/:name', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.skillScanner) {
                    res.status(503).json({ error: 'Skills system not initialized' });
                    return;
                }
                const skillName = decodeURIComponent(req.params.name);
                const { content } = req.body;
                if (!content) {
                    res.status(400).json({ error: 'Content is required' });
                    return;
                }
                const skills = this.skillScanner.getAllSkills();
                const skill = skills.find(s => s.name === skillName || s.id === skillName);
                if (!skill) {
                    res.status(404).json({ error: 'Skill not found' });
                    return;
                }
                // Write content to file
                const fs = await import('fs/promises');
                await fs.writeFile(skill.filePath, content, 'utf-8');
                // Reload skills to reflect changes
                await this.skillScanner.scan();
                res.json({ success: true, message: 'Skill updated, no cap' });
            }
            catch (error) {
                logger.error({ error }, 'Error updating skill');
                res.status(500).json({ error: 'Skill update didn\'t work' });
            }
        });
        // Team member coordination routes
        this.app.get('/api/teamMembers', this.requireAuth.bind(this), async (req, res) => {
            try {
                const teamMembers = await this.getTeamMembers();
                res.json(teamMembers);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team members');
                res.status(500).json({ error: 'Failed to fetch team members' });
            }
        });
        // ==================== TEAM_MEMBER COMMUNICATION DASHBOARD ROUTES ====================
        // GET /api/team-members/active - list all currently active team member sessions
        this.app.get('/api/team-members/active', this.requireAuth.bind(this), async (req, res) => {
            try {
                const activeTeamMembers = await this.getActiveTeamMemberSessions();
                res.json(activeTeamMembers);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching active team members');
                res.status(500).json({ error: 'Failed to fetch active team members' });
            }
        });
        // GET /api/team-members/history - list past team member sessions with pagination
        this.app.get('/api/team-members/history', this.requireAuth.bind(this), async (req, res) => {
            try {
                const limit = Math.min(parseInt(req.query.limit) || 50, 200);
                const offset = parseInt(req.query.offset) || 0;
                const teamMemberType = req.query.type;
                const status = req.query.status;
                const history = await this.getTeamMemberSessionHistory(limit, offset, teamMemberType, status);
                res.json(history);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team member history');
                res.status(500).json({ error: 'Failed to fetch team member history' });
            }
        });
        // GET /api/team-members/session/:id - get detailed session info with messages
        this.app.get('/api/team-members/session/:id', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const includeMessages = req.query.messages !== 'false';
                const messageLimit = Math.min(parseInt(req.query.messageLimit) || 100, 500);
                const session = await this.getTeamMemberSessionDetails(id, includeMessages, messageLimit);
                if (!session) {
                    res.status(404).json({ error: 'Session not found' });
                    return;
                }
                res.json(session);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching session details');
                res.status(500).json({ error: 'Session details broke' });
            }
        });
        // GET /api/team-members/session/:id/messages - get messages for a session with pagination
        this.app.get('/api/team-members/session/:id/messages', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const limit = Math.min(parseInt(req.query.limit) || 50, 200);
                const offset = parseInt(req.query.offset) || 0;
                const messageType = req.query.type;
                const messages = await this.getTeamMemberSessionMessages(id, limit, offset, messageType);
                res.json(messages);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching session messages');
                res.status(500).json({ error: 'Session messages ain\'t showing' });
            }
        });
        // GET /api/team-members/deployments - list team member deployments
        this.app.get('/api/team-members/deployments', this.requireAuth.bind(this), async (req, res) => {
            try {
                const limit = Math.min(parseInt(req.query.limit) || 50, 200);
                const offset = parseInt(req.query.offset) || 0;
                const status = req.query.status;
                const environment = req.query.environment;
                const deployments = await this.getTeamMemberDeployments(limit, offset, status, environment);
                res.json(deployments);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching deployments');
                res.status(500).json({ error: 'Failed to fetch deployments' });
            }
        });
        // GET /api/team-members/stats - get aggregate team member statistics
        this.app.get('/api/team-members/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.getTeamMemberStats();
                res.json(stats);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team member stats');
                res.status(500).json({ error: 'Failed to fetch team member stats' });
            }
        });
        // GET /api/team-members/collaboration/stats - get team member collaboration statistics
        this.app.get('/api/team-members/collaboration/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.db) {
                    res.status(503).json({ error: 'Database not connected' });
                    return;
                }
                // Get collaboration statistics from team member sessions and messages
                const collaborationQuery = `
          SELECT
            COUNT(DISTINCT s.id) as total_collaborations,
            COUNT(DISTINCT s.team_member_id) as unique_teamMembers,
            COUNT(m.id) as total_messages,
            AVG(EXTRACT(EPOCH FROM (s.ended_at - s.started_at))) as avg_duration_seconds,
            COUNT(DISTINCT DATE(s.started_at)) as active_days,
            MAX(s.started_at) as last_collaboration
          FROM team_member_sessions s
          LEFT JOIN team_member_messages m ON m.session_id = s.id
          WHERE s.started_at >= NOW() - INTERVAL '30 days'
        `;
                const result = await this.db.query(collaborationQuery);
                const stats = result.rows[0];
                res.json({
                    total_collaborations: parseInt(stats.total_collaborations) || 0,
                    unique_teamMembers: parseInt(stats.unique_teamMembers) || 0,
                    total_messages: parseInt(stats.total_messages) || 0,
                    avg_duration_seconds: parseFloat(stats.avg_duration_seconds) || 0,
                    active_days: parseInt(stats.active_days) || 0,
                    last_collaboration: stats.last_collaboration || null,
                    period: '30_days'
                });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching collaboration stats');
                res.status(500).json({ error: 'Failed to fetch collaboration stats' });
            }
        });
        // Team Member Deployment & Tracking Routes
        // BUG FIX (Team Member 2): Added discovery-based team members to the list
        this.app.get('/api/team-members/list', this.requireAuth.bind(this), async (req, res) => {
            try {
                // Get team members from deployment tracker
                const deployedTeamMembers = await this.teamMemberTracker?.getAllTeamMembers() || [];
                const deployedIds = new Set(deployedTeamMembers.map(a => a.id));
                // Also get team members from discovery service (SpecMem heartbeat-based)
                let discoveredTeamMembers = [];
                try {
                    if (this.dashboardDiscovery) {
                        const discovered = await this.dashboardDiscovery.getActiveTeamMembers(120000); // 2 min expiry
                        // Convert discovered team members to the same format, excluding already-deployed ones
                        discoveredTeamMembers = discovered
                            .filter((d) => !deployedIds.has(d.teamMemberId))
                            .map((d) => ({
                            id: d.teamMemberId,
                            name: d.teamMemberName || d.teamMemberId.substring(0, 8),
                            type: d.teamMemberType || 'worker',
                            status: d.status === 'active' || d.status === 'busy' ? 'running' : d.status === 'idle' ? 'pending' : 'stopped',
                            tokensUsed: d.metadata?.tokensUsed || 0,
                            tokensLimit: d.metadata?.tokensLimit || 20000,
                            createdAt: d.registeredAt || d.lastHeartbeat,
                            lastHeartbeat: d.lastHeartbeat,
                            currentTask: d.metadata?.currentTask,
                            metadata: { ...d.metadata, source: 'discovery' }
                        }));
                    }
                }
                catch (discErr) {
                    logger.debug({ error: discErr }, 'Discovery service not available');
                }
                // ALSO get Task team members from team_member_sessions table
                let taskTeamMembers = [];
                if (this.db) {
                    try {
                        const result = await this.db.query(`
              SELECT
                team_member_id as id,
                team_member_name as name,
                team_member_type as type,
                status,
                current_task,
                started_at as created_at,
                tokens_used,
                metadata,
                last_heartbeat
              FROM team_member_sessions
              ORDER BY started_at DESC
              LIMIT 100
            `);
                        taskTeamMembers = result.rows.map((row) => ({
                            id: row.id,
                            name: row.name || row.id.substring(0, 8),
                            type: row.type || 'worker',
                            status: row.status === 'terminated' ? 'completed' : row.status === 'error' ? 'failed' : row.status,
                            tokensUsed: row.tokens_used || 0,
                            tokensLimit: row.metadata?.tokensLimit || 128000,
                            createdAt: row.created_at,
                            lastHeartbeat: row.last_heartbeat,
                            currentTask: row.current_task ? { name: row.current_task, progress: 0 } : undefined,
                            metadata: { ...row.metadata, source: 'task-team-member' }
                        }));
                    }
                    catch (taskErr) {
                        logger.debug({ error: taskErr }, 'Failed to get Task team members');
                    }
                }
                const allTeamMembers = [...deployedTeamMembers, ...discoveredTeamMembers, ...taskTeamMembers];
                res.json({ success: true, teamMembers: allTeamMembers });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team member list');
                res.status(500).json({ success: false, error: 'Failed to fetch team members' });
            }
        });
        // REMOVED: Duplicate route handlers - now using teamMemberDeployRouter instead
        this.app.post('/api/team-members/:id/restart', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const result = await this.teamMemberDeployment?.restart(id);
                res.json({ success: result });
            }
            catch (error) {
                logger.error({ error }, 'Error restarting team member');
                res.status(500).json({ success: false, error: 'Failed to restart team member' });
            }
        });
        this.app.get('/api/team-members/:id/logs', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const limit = Math.min(parseInt(req.query.limit) || 50, 200);
                const offset = parseInt(req.query.offset) || 0;
                // Check if this is a Task team member (from team_member_sessions table)
                let isTaskTeamMember = false;
                let sessionDbId = null;
                if (this.db) {
                    try {
                        const sessionCheck = await this.db.query(`
              SELECT id, metadata FROM team_member_sessions WHERE team_member_id = $1 LIMIT 1
            `, [id]);
                        if (sessionCheck.rows.length > 0) {
                            isTaskTeamMember = true;
                            sessionDbId = sessionCheck.rows[0].id;
                        }
                    }
                    catch (checkErr) {
                        logger.debug({ error: checkErr }, 'Could not check for Task team member session');
                    }
                }
                if (isTaskTeamMember && sessionDbId && this.db) {
                    // Fetch logs for Task team member from team_member_logs table using session's DB id
                    try {
                        const result = await this.db.query(`
              SELECT
                al.id,
                al.team_member_id,
                al.level,
                al.message,
                al.metadata,
                al.created_at as timestamp
              FROM team_member_logs al
              WHERE al.team_member_id = $1
              ORDER BY al.created_at DESC
              LIMIT $2 OFFSET $3
            `, [sessionDbId, limit, offset]);
                        const logs = result.rows.map((row) => ({
                            id: row.id,
                            teamMemberId: id,
                            level: row.level || 'info',
                            message: row.message,
                            metadata: row.metadata,
                            timestamp: row.timestamp
                        }));
                        res.json({ success: true, logs, isTaskTeamMember: true });
                        return;
                    }
                    catch (logErr) {
                        logger.debug({ error: logErr }, 'Could not fetch Task team member logs, falling back');
                    }
                }
                // Fall back to native team member logs from teamMemberTracker
                const logs = await this.teamMemberTracker?.getLogs(id, limit, offset) || [];
                res.json({ success: true, logs });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team member logs');
                res.status(500).json({ success: false, error: 'Failed to fetch logs' });
            }
        });
        this.app.get('/api/team-members/:id/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const teamMember = await this.teamMemberTracker?.getTeamMember(id);
                if (!teamMember) {
                    res.status(404).json({ success: false, error: 'Team Member not found' });
                    return;
                }
                res.json({ success: true, teamMember });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team member stats');
                res.status(500).json({ success: false, error: 'Failed to fetch team member stats' });
            }
        });
        // TeamMember limits endpoint
        this.app.get('/api/team-members/:id/limits', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const limits = this.teamMemberDeployment?.getTeamMemberLimits(id);
                const status = this.teamMemberDeployment?.getTeamMemberLimitStatus(id);
                if (!limits) {
                    res.status(404).json({ success: false, error: 'Team Member limits not found' });
                    return;
                }
                res.json({ success: true, limits, status });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team member limits');
                res.status(500).json({ success: false, error: 'Failed to fetch team member limits' });
            }
        });
        // ==================== TEAM_MEMBER COLLABORATION ROUTES ====================
        this.app.post('/api/team-members/:id/share-code', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const { title, description, code, filePath, language, tags } = req.body;
                if (!title || !code) {
                    res.status(400).json({ success: false, error: 'Title and code required' });
                    return;
                }
                const shared = await this.teamMemberTracker?.shareCode(id, { title, description, code, filePath, language, tags });
                this.broadcastUpdate('code_shared', shared);
                res.json({ success: true, sharedCode: shared });
            }
            catch (error) {
                logger.error({ error }, 'Error sharing code');
                res.status(500).json({ success: false, error: 'Failed to share code' });
            }
        });
        this.app.get('/api/team-members/shared-code', this.requireAuth.bind(this), async (req, res) => {
            try {
                const limit = Math.min(parseInt(req.query.limit) || 50, 100);
                const offset = parseInt(req.query.offset) || 0;
                const sharedCode = await this.teamMemberTracker?.getAllSharedCode(limit, offset) || [];
                res.json({ success: true, sharedCode });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching shared code');
                res.status(500).json({ success: false, error: 'Failed to fetch shared code' });
            }
        });
        this.app.get('/api/team-members/shared-code/:codeId', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { codeId } = req.params;
                const code = await this.teamMemberTracker?.getSharedCode(codeId);
                if (!code) {
                    res.status(404).json({ success: false, error: 'Shared code not found' });
                    return;
                }
                res.json({ success: true, sharedCode: code });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching shared code');
                res.status(500).json({ success: false, error: 'Failed to fetch shared code' });
            }
        });
        this.app.get('/api/team-members/:id/shared-code', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const limit = Math.min(parseInt(req.query.limit) || 50, 100);
                const sharedCode = await this.teamMemberTracker?.getSharedCodeByTeamMember(id, limit) || [];
                res.json({ success: true, sharedCode });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team member shared code');
                res.status(500).json({ success: false, error: 'Failed to fetch shared code' });
            }
        });
        this.app.get('/api/team-members/shared-code/:codeId/chunk/:index', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { codeId, index } = req.params;
                const chunkIndex = parseInt(index, 10);
                if (isNaN(chunkIndex) || chunkIndex < 0) {
                    res.status(400).json({ success: false, error: 'Invalid chunk index' });
                    return;
                }
                const chunk = await this.teamMemberTracker?.getCodeChunk(codeId, chunkIndex);
                if (!chunk) {
                    res.status(404).json({ success: false, error: 'Chunk not found' });
                    return;
                }
                res.json({ success: true, chunk });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching code chunk');
                res.status(500).json({ success: false, error: 'Failed to fetch code chunk' });
            }
        });
        this.app.get('/api/team-members/shared-code/:codeId/download', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { codeId } = req.params;
                const code = await this.teamMemberTracker?.getSharedCode(codeId);
                if (!code) {
                    res.status(404).json({ success: false, error: 'Shared code not found' });
                    return;
                }
                const fullCode = await this.teamMemberTracker?.getFullCode(codeId);
                if (!fullCode) {
                    res.status(404).json({ success: false, error: 'Code content not found' });
                    return;
                }
                const ext = this.getFileExtension(code.language);
                const filename = code.filePath ? code.filePath.split('/').pop() : `${code.title.replace(/[^a-z0-9]/gi, '_')}.${ext}`;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                res.setHeader('Content-Length', Buffer.byteLength(fullCode, 'utf-8'));
                res.send(fullCode);
            }
            catch (error) {
                logger.error({ error }, 'Error downloading code');
                res.status(500).json({ success: false, error: 'Failed to download code' });
            }
        });
        this.app.post('/api/team-members/shared-code/:codeId/feedback', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { codeId } = req.params;
                const { fromTeamMemberId, feedbackType, message } = req.body;
                if (!fromTeamMemberId || !feedbackType || !message) {
                    res.status(400).json({ success: false, error: 'fromTeamMemberId, feedbackType, and message required' });
                    return;
                }
                if (!['positive', 'negative', 'question', 'critique'].includes(feedbackType)) {
                    res.status(400).json({ success: false, error: 'Invalid feedback type' });
                    return;
                }
                const feedback = await this.teamMemberTracker?.giveFeedback(fromTeamMemberId, codeId, feedbackType, message);
                this.broadcastUpdate('feedback_given', feedback);
                res.json({ success: true, feedback });
            }
            catch (error) {
                logger.error({ error }, 'Error giving feedback');
                res.status(500).json({ success: false, error: 'Failed to give feedback' });
            }
        });
        this.app.get('/api/team-members/shared-code/:codeId/feedback', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { codeId } = req.params;
                const limit = Math.min(parseInt(req.query.limit) || 50, 100);
                const feedback = await this.teamMemberTracker?.getFeedbackForCode(codeId, limit) || [];
                res.json({ success: true, feedback });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching feedback');
                res.status(500).json({ success: false, error: 'Failed to fetch feedback' });
            }
        });
        this.app.post('/api/team-members/:id/message', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const { toTeamMemberId, message, metadata } = req.body;
                if (!toTeamMemberId || !message) {
                    res.status(400).json({ success: false, error: 'toTeamMemberId and message required' });
                    return;
                }
                const msg = await this.teamMemberTracker?.sendMessage(id, toTeamMemberId, message, metadata);
                this.broadcastUpdate('message_sent', msg);
                res.json({ success: true, message: msg });
            }
            catch (error) {
                logger.error({ error }, 'Error sending message');
                res.status(500).json({ success: false, error: 'Failed to send message' });
            }
        });
        this.app.get('/api/team-members/:id/messages', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const limit = Math.min(parseInt(req.query.limit) || 50, 100);
                const unreadOnly = req.query.unreadOnly === 'true';
                const messages = await this.teamMemberTracker?.getMessagesForTeamMember(id, limit, unreadOnly) || [];
                res.json({ success: true, messages });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching messages');
                res.status(500).json({ success: false, error: 'Failed to fetch messages' });
            }
        });
        this.app.post('/api/team-members/messages/:messageId/read', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { messageId } = req.params;
                await this.teamMemberTracker?.markMessageRead(messageId);
                res.json({ success: true });
            }
            catch (error) {
                logger.error({ error }, 'Error marking message read');
                res.status(500).json({ success: false, error: 'Failed to mark message read' });
            }
        });
        this.app.get('/api/team-members/:id/unread-count', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const count = await this.teamMemberTracker?.getUnreadMessageCount(id) || 0;
                res.json({ success: true, count });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching unread count');
                res.status(500).json({ success: false, error: 'Failed to fetch unread count' });
            }
        });
        this.app.get('/api/team-members/:id/pending-reviews', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const pendingReviews = await this.teamMemberTracker?.getPendingReviewsForTeamMember(id) || [];
                res.json({ success: true, pendingReviews });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching pending reviews');
                res.status(500).json({ success: false, error: 'Failed to fetch pending reviews' });
            }
        });
        this.app.get('/api/team-members/collaboration/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = this.teamMemberTracker?.getCollaborationStats() || {
                    totalSharedCode: 0, totalFeedback: 0, totalMessages: 0, positiveRatio: 0
                };
                res.json({ success: true, stats });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching collaboration stats');
                res.status(500).json({ success: false, error: 'Failed to fetch collaboration stats' });
            }
        });
        // ==================== TEAM_MEMBER COMMAND ROUTE ====================
        // POST /api/team-members/:id/command - Send command to team member stdin OR via SpecMem
        // BUG FIX (Team Member 2): Added fallback to SpecMem-based communication for discovered team members
        this.app.post('/api/team-members/:id/command', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const { command } = req.body;
                if (!command || typeof command !== 'object') {
                    res.status(400).json({ success: false, error: 'Command must be a valid object' });
                    return;
                }
                // Validate command has a type
                if (!command.type || typeof command.type !== 'string') {
                    res.status(400).json({ success: false, error: 'Command must have a type field' });
                    return;
                }
                // First try sending via deployment manager (for spawned processes)
                let result = await this.teamMemberDeployment?.sendCommand(id, command);
                // If deployment manager failed, try SpecMem-based communication
                if (!result && this.dashboardCommunicator) {
                    try {
                        // Check if team member exists in discovery
                        const teamMemberOnline = this.dashboardDiscovery ?
                            await this.dashboardDiscovery.isTeamMemberOnline(id) : false;
                        if (teamMemberOnline) {
                            // Send message via SpecMem
                            const messageContent = JSON.stringify({
                                type: 'command',
                                command: command,
                                from: 'dashboard',
                                timestamp: new Date().toISOString()
                            });
                            const sent = await this.dashboardCommunicator.say(messageContent, id, { priority: 'high' });
                            if (sent) {
                                result = {
                                    success: true,
                                    response: { status: 'sent', via: 'specmem' },
                                    queued: true
                                };
                                logger.info({ teamMemberId: id }, 'Command sent via SpecMem communicator');
                            }
                        }
                    }
                    catch (specMemErr) {
                        logger.debug({ error: specMemErr }, 'SpecMem communication failed');
                    }
                }
                if (!result) {
                    res.status(404).json({ success: false, error: 'Team Member not found or not running' });
                    return;
                }
                // Log the command (truncate for safety)
                const commandStr = JSON.stringify(command);
                const truncatedCmd = commandStr.length > 200 ? commandStr.substring(0, 200) + '...' : commandStr;
                await this.teamMemberTracker?.addLog(id, 'info', `Command sent: ${truncatedCmd}`);
                // Broadcast command event via WebSocket
                this.broadcastUpdate('teamMember_command', {
                    teamMemberId: id,
                    command,
                    timestamp: new Date().toISOString()
                });
                res.json({ success: true, response: result.response, queued: result.queued });
            }
            catch (error) {
                logger.error({ error }, 'Error sending command to team member');
                res.status(500).json({ success: false, error: 'Failed to send command to team member' });
            }
        });
        // ==================== TEAM_MEMBER HISTORY ROUTES ====================
        // BUG FIX (Team Member 2): Also include discovered team members with active sessions
        this.app.get('/api/team-members/history/teamMembers', this.requireAuth.bind(this), async (req, res) => {
            try {
                // Get historical team members from session database
                const historicalTeamMembers = await this.teamMemberHistoryManager?.getTeamMembersWithSessionCounts() || [];
                const historicalIds = new Set(historicalTeamMembers.map(a => a.id));
                // Also include currently active discovered team members (they may have no DB sessions yet)
                let activeTeamMembers = [];
                try {
                    if (this.dashboardDiscovery) {
                        const discovered = await this.dashboardDiscovery.getActiveTeamMembers(300000); // 5 min window
                        activeTeamMembers = discovered
                            .filter((d) => !historicalIds.has(d.teamMemberId))
                            .map((d) => ({
                            id: d.teamMemberId,
                            name: d.teamMemberName || d.teamMemberId.substring(0, 8),
                            type: d.teamMemberType || 'worker',
                            sessionCount: 1, // Current session counts as 1
                            lastSessionDate: d.lastHeartbeat,
                            totalTokensUsed: d.metadata?.tokensUsed || 0
                        }));
                    }
                }
                catch (discErr) {
                    logger.debug({ error: discErr }, 'Discovery not available for history');
                }
                const allTeamMembers = [...historicalTeamMembers, ...activeTeamMembers];
                res.json({ success: true, teamMembers: allTeamMembers });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching team members with session counts');
                res.status(500).json({ success: false, error: 'Failed to fetch team member history list' });
            }
        });
        // BUG FIX (Team Member 2): Also return synthetic session for currently active discovered team members
        this.app.get('/api/team-members/:id/sessions', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { id } = req.params;
                const limit = Math.min(parseInt(req.query.limit) || 10, 50);
                const offset = parseInt(req.query.offset) || 0;
                // Get sessions from history manager
                let sessions = await this.teamMemberHistoryManager?.getSessionsForTeamMember(id, limit, offset) || [];
                // If no sessions found, check if this is a currently active discovered teamMember
                if (sessions.length === 0 && this.dashboardDiscovery) {
                    try {
                        const teamMemberInfo = await this.dashboardDiscovery.getTeamMemberInfo(id);
                        if (teamMemberInfo) {
                            // Create a synthetic "current session" for this active teamMember
                            sessions = [{
                                    id: `live-${id}`,
                                    teamMemberId: id,
                                    teamMemberName: teamMemberInfo.teamMemberName || id.substring(0, 8),
                                    teamMemberType: teamMemberInfo.teamMemberType || 'worker',
                                    sessionStart: teamMemberInfo.registeredAt || teamMemberInfo.lastHeartbeat,
                                    sessionEnd: null,
                                    taskCount: teamMemberInfo.metadata?.currentTask ? 1 : 0,
                                    codeCount: 0,
                                    feedbackCount: 0,
                                    messageCount: 0,
                                    tokensUsed: teamMemberInfo.metadata?.tokensUsed || 0,
                                    status: teamMemberInfo.status === 'active' || teamMemberInfo.status === 'busy' ? 'running' : 'completed',
                                    summary: `Active session - ${teamMemberInfo.status}`
                                }];
                        }
                    }
                    catch (discErr) {
                        logger.debug({ error: discErr }, 'Discovery not available for sessions');
                    }
                }
                res.json({ success: true, sessions });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching sessions for team member');
                res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
            }
        });
        // BUG FIX (Team Member 2): Handle live sessions for discovered team members
        this.app.get('/api/team-members/sessions/:sessionId', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { sessionId } = req.params;
                // Check for live session (synthetic session for discovered team members)
                if (sessionId.startsWith('live-') && this.dashboardDiscovery) {
                    const teamMemberId = sessionId.substring(5); // Remove 'live-' prefix
                    const teamMemberInfo = await this.dashboardDiscovery.getTeamMemberInfo(teamMemberId);
                    if (teamMemberInfo) {
                        const liveSession = {
                            id: sessionId,
                            teamMemberId: teamMemberId,
                            teamMemberName: teamMemberInfo.teamMemberName || teamMemberId.substring(0, 8),
                            teamMemberType: teamMemberInfo.teamMemberType || 'worker',
                            sessionStart: teamMemberInfo.registeredAt || teamMemberInfo.lastHeartbeat,
                            sessionEnd: null,
                            tasksCompleted: teamMemberInfo.metadata?.currentTask ? [{
                                    id: 'current',
                                    name: teamMemberInfo.metadata.currentTask,
                                    status: 'running',
                                    startedAt: teamMemberInfo.lastHeartbeat
                                }] : [],
                            codeSharedIds: [],
                            feedbackGivenIds: [],
                            messagesSentIds: [],
                            tokensUsed: teamMemberInfo.metadata?.tokensUsed || 0,
                            status: 'running',
                            summary: `Live session for ${teamMemberInfo.teamMemberName || teamMemberId}`
                        };
                        res.json({ success: true, session: liveSession });
                        return;
                    }
                }
                // Fall back to database session
                const session = await this.teamMemberHistoryManager?.getSessionDetails(sessionId);
                if (!session) {
                    res.status(404).json({ success: false, error: 'Session not found' });
                    return;
                }
                res.json({ success: true, session });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching session details');
                res.status(500).json({ success: false, error: 'Failed to fetch session details' });
            }
        });
        // BUG FIX (Team Member 2): Handle live session logs from SpecMem messages
        this.app.get('/api/team-members/sessions/:sessionId/logs', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { sessionId } = req.params;
                const limit = Math.min(parseInt(req.query.limit) || 100, 500);
                const offset = parseInt(req.query.offset) || 0;
                // Check for live session logs
                if (sessionId.startsWith('live-') && this.dashboardCommunicator) {
                    const teamMemberId = sessionId.substring(5);
                    try {
                        // Try to get recent messages from/to this team member as "logs"
                        const messages = await this.dashboardCommunicator.getMessages(new Date(Date.now() - 3600000) // Last hour
                        );
                        const teamMemberLogs = messages
                            .filter(m => m.from === teamMemberId || m.to === teamMemberId)
                            .map((m, i) => ({
                            id: m.messageId || `msg-${i}`,
                            teamMemberId: m.from,
                            timestamp: m.timestamp,
                            level: m.messageType === 'status' ? 'info' : 'debug',
                            message: m.content
                        }))
                            .slice(offset, offset + limit);
                        res.json({
                            success: true,
                            logs: teamMemberLogs,
                            totalCount: teamMemberLogs.length,
                            limit,
                            offset
                        });
                        return;
                    }
                    catch (msgErr) {
                        logger.debug({ error: msgErr }, 'Could not get messages for live session');
                    }
                }
                // Fall back to database logs
                const logs = await this.teamMemberHistoryManager?.getSessionLogs(sessionId, limit, offset) || [];
                const totalCount = await this.teamMemberHistoryManager?.getSessionLogCount(sessionId) || 0;
                res.json({ success: true, logs, totalCount, limit, offset });
            }
            catch (error) {
                logger.error({ error }, 'Error fetching session logs');
                res.status(500).json({ success: false, error: 'Failed to fetch session logs' });
            }
        });
        // Configuration routes
        this.app.get('/api/config', this.requireAuth.bind(this), (req, res) => {
            res.json({
                coordinationPort: this.config.coordinationPort,
                dashboardPort: this.config.port
            });
        });
        this.app.post('/api/config/password', this.requireAuth.bind(this), async (req, res) => {
            const { currentPassword, newPassword } = req.body;
            // Use centralized password change with team member notification
            // This handles: validation, runtime update, env persistence, hook update, and team member notification
            const result = await changePasswordWithTeamMemberNotification(currentPassword, newPassword, true);
            if (!result.success) {
                // Determine appropriate status code based on error
                const statusCode = result.message.includes('incorrect') ? 401 : 400;
                res.status(statusCode).json({ error: result.message });
                return;
            }
            // Also update this.config.password for backwards compatibility with any code
            // that still reads from config directly
            this.config.password = newPassword;
            logger.info({
                persisted: result.persisted,
                hookUpdated: result.hookUpdated,
                teamMembersNotified: result.teamMembersNotified
            }, 'Dashboard password changed via centralized system');
            res.json({
                success: true,
                message: result.message,
                persisted: result.persisted,
                hookUpdated: result.hookUpdated,
                teamMembersNotified: result.teamMembersNotified
            });
        });
        // ==================== MEMORY MANAGEMENT ROUTES ====================
        // Get memory configuration
        this.app.get('/api/memory/config', this.requireAuth.bind(this), async (req, res) => {
            try {
                const memoryConfig = await this.getMemoryConfig();
                res.json(memoryConfig);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching memory config');
                res.status(500).json({ error: 'Failed to fetch memory configuration' });
            }
        });
        // Update memory configuration
        this.app.post('/api/memory/config', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { memoryLimit, overflowTime, cacheSize } = req.body;
                // Validate inputs
                if (memoryLimit !== undefined && (memoryLimit < 50 || memoryLimit > 200)) {
                    res.status(400).json({ error: 'Memory limit must be between 50 and 200 MB' });
                    return;
                }
                if (overflowTime !== undefined && (overflowTime < 0 || overflowTime > 72)) {
                    res.status(400).json({ error: 'Overflow time must be between 0 and 72 hours' });
                    return;
                }
                if (cacheSize !== undefined && (cacheSize < 100 || cacheSize > 1000)) {
                    res.status(400).json({ error: 'Cache size must be between 100 and 1000 entries' });
                    return;
                }
                const persisted = await this.persistMemoryConfig({ memoryLimit, overflowTime, cacheSize });
                logger.info({ memoryLimit, overflowTime, cacheSize, persisted }, 'Memory configuration updated');
                res.json({
                    success: true,
                    message: persisted ? 'Memory configuration saved to specmem.env' : 'Memory configuration updated (in-memory only)',
                    config: { memoryLimit, overflowTime, cacheSize }
                });
            }
            catch (error) {
                logger.error({ error }, 'Error updating memory config');
                res.status(500).json({ error: 'Failed to update memory configuration' });
            }
        });
        // Get memory statistics
        this.app.get('/api/memory/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.getMemoryStats();
                res.json(stats);
            }
            catch (error) {
                logger.error({ error }, 'Error fetching memory stats');
                res.status(500).json({ error: 'Failed to fetch memory statistics' });
            }
        });
        // Trigger overflow cleanup
        this.app.post('/api/memory/overflow', this.requireAuth.bind(this), async (req, res) => {
            try {
                const result = await this.triggerOverflowCleanup();
                this.broadcastUpdate('overflow_triggered', result);
                res.json(result);
            }
            catch (error) {
                logger.error({ error }, 'Error triggering overflow cleanup');
                res.status(500).json({ error: 'Failed to trigger overflow cleanup' });
            }
        });
        // Emergency memory purge
        this.app.post('/api/memory/purge', this.requireAuth.bind(this), async (req, res) => {
            try {
                const result = await this.emergencyMemoryPurge();
                this.broadcastUpdate('emergency_purge', result);
                logger.warn({ result }, 'Emergency memory purge executed');
                res.json(result);
            }
            catch (error) {
                logger.error({ error }, 'Error executing emergency purge');
                res.status(500).json({ error: 'Failed to execute emergency purge' });
            }
        });
        // Clear specific cache
        this.app.delete('/api/memory/cache/:type', this.requireAuth.bind(this), async (req, res) => {
            try {
                const { type } = req.params;
                if (!['query', 'embedding'].includes(type)) {
                    res.status(400).json({ error: 'Invalid cache type. Must be "query" or "embedding"' });
                    return;
                }
                const result = await this.clearCache(type);
                this.broadcastUpdate('cache_cleared', { type, ...result });
                res.json(result);
            }
            catch (error) {
                logger.error({ error }, 'Error clearing cache');
                res.status(500).json({ error: 'Failed to clear cache' });
            }
        });
        // ==================== PHASE 4-6 ROUTES ====================
        // Phase 4: Direct Prompting API
        const promptSendRouter = createPromptSendRouter(this.db, this.requireAuth.bind(this));
        this.app.use('/api/prompt', promptSendRouter);
        // Phase 5: Terminal Output API
        const terminalRouter = createTerminalRouter(this.requireAuth.bind(this));
        this.app.use('/api/terminal', terminalRouter);
        // Terminal Injection API - Direct prompt injection into Claude Code terminal!
        const terminalInjectRouter = createTerminalInjectRouter(this.requireAuth.bind(this));
        this.app.use('/api/terminal-inject', terminalInjectRouter);
        // Terminal Streaming API - PTY streaming with full ANSI support!
        const terminalStreamRouter = createTerminalStreamRouter(this.requireAuth.bind(this));
        this.app.use('/api/terminal-stream', terminalStreamRouter);
        // Phase 6: Claude Control API
        const claudeControlRouter = createClaudeControlRouter(this.db, this.requireAuth.bind(this), this.broadcastUpdate.bind(this));
        this.app.use('/api/claude', claudeControlRouter);
        // Specmem Tools API - Expose MCP tools to team members via HTTP
        // Pass embedding provider GETTER so HTTP endpoints use REAL MCP tool semantic search!
        // NOTE: Using getter function because embeddingProvider is set AFTER server starts
        const specmemToolsRouter = createSpecmemToolsRouter(() => this.db, this.requireAuth.bind(this), () => this.embeddingProvider);
        // SECURITY: Localhost-only access for SpecMem API (internal bridge only)
        // This ensures SpecMem API is NEVER exposed to public internet
        this.app.use('/api/specmem', (req, res, next) => {
            const clientIP = req.ip || req.socket?.remoteAddress || '';
            const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].some(ip => clientIP.includes(ip) || clientIP === ip);
            if (!isLocalhost) {
                console.warn(`[SPECMEM-API] BLOCKED non-localhost access attempt from: ${clientIP}`);
                return res.status(403).json({ error: 'Access denied - localhost only' });
            }
            next();
        });
        // SECURITY: Encrypted payload middleware for SpecMem API
        // Decrypts Serpent-32 encrypted payloads from SpecMemSecurityBridge
        this.app.use('/api/specmem', (req, res, next) => {
            // Check for encrypted payload header
            if (req.headers['x-specmem-encrypted'] === 'serpent-32' && req.body?._encrypted) {
                try {
                    const { _payload, _timestamp, _nonce } = req.body;
                    // Validate timestamp (prevent replay attacks - max 5 min old)
                    const MAX_AGE_MS = 5 * 60 * 1000;
                    if (Date.now() - _timestamp > MAX_AGE_MS) {
                        console.warn('[SPECMEM-API] Rejected stale encrypted request (replay attack?)');
                        return res.status(400).json({ error: 'Request expired' });
                    }
                    // Decrypt using shared secret + nonce
                    const EncryptedDataCommunication = require('/server/serverModules/security/EncryptedDataCommunication');
                    const apiSecret = process.env.SPECMEM_API_SECRET || 'specmem_serpent_key_2025_security';
                    const decryptor = new EncryptedDataCommunication({ encryptionKey: apiSecret });
                    // Reconstruct the key from shared secret + nonce (same as encryptData does)
                    const decrypted = decryptor.decryptData({
                        encrypted: _payload,
                        nonce: _nonce
                    }, 'specmem-bridge');
                    req.body = decrypted;
                    console.log('[SPECMEM-API] Decrypted incoming encrypted payload');
                }
                catch (err) {
                    console.error('[SPECMEM-API] Decryption failed:', err.message);
                    return res.status(400).json({ error: 'Decryption failed' });
                }
            }
            next();
        });
        this.app.use('/api/specmem', specmemToolsRouter);
        // Task Team Members API - Track Claude Code Task tool deployments
        const taskTeamMembersRouter = createTaskTeamMembersRouter();
        this.app.use('/api/task-team-members', taskTeamMembersRouter);
        // LIVE Session Streaming API - Team Member 2's real-time Claude Code viewer!
        const liveSessionRouter = createLiveSessionRouter(this.requireAuth.bind(this));
        this.app.use('/api/live', liveSessionRouter);
        // File Manager API - FTP-style file browser for codebase management
        const fileManagerRouter = createFileManagerRouter(() => this.db, this.requireAuth.bind(this));
        this.app.use('/api/file-manager', fileManagerRouter);
        // Settings API - Password management and dashboard configuration
        const settingsRouter = createSettingsRouter(this.requireAuth.bind(this));
        this.app.use('/api/settings', settingsRouter);
        // Setup API - Dashboard mode switching and initial setup wizard
        // Note: Some endpoints are public (status), some require auth (mode switch to public)
        const setupRouter = createSetupRouter(this.requireAuth.bind(this));
        this.app.use('/api/setup', setupRouter);
        // Data Export API - Export PostgreSQL tables to JSON
        const dataExportRouter = createDataExportRouter(this.requireAuth.bind(this), this.db);
        this.app.use('/api/admin/export', dataExportRouter);
        // Hot Reload API - Dashboard control for hot reload system
        const hotReloadRouter = createHotReloadRouter(this.requireAuth.bind(this));
        this.app.use('/api/reload', hotReloadRouter);
        // Hooks Management API - User-manageable custom hooks
        this.app.use('/api/hooks', this.requireAuth.bind(this), hooksRouter);
        // Also alias the thinking stream to /api/stream/thinking for backwards compat
        this.app.get('/api/stream/thinking', this.requireAuth.bind(this), (req, res) => {
            // Redirect to the live session thinking endpoint
            res.redirect('/api/live/thinking');
        });
        // Serve prompt console page
        this.app.get('/prompt', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'prompt-console.html'));
        });
        // Serve terminal output page (legacy)
        this.app.get('/terminal-output', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'terminal-output.html'));
        });
        // Serve new terminal emulator page with full ANSI support
        this.app.get('/terminal', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'terminal.html'));
        });
        // Serve data export page
        this.app.get('/data-export', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'data-export.html'));
        });
        // SPA catch-all route: serve React app for all non-API routes (React Router handles routing)
        this.app.get('*', (req, res) => {
            // Don't catch API routes, WebSocket, or specific pages
            if (req.path.startsWith('/api/') || req.path.startsWith('/ws/') ||
                req.path === '/prompt' || req.path === '/terminal' ||
                req.path === '/terminal-output' || req.path === '/health' ||
                req.path === '/data-export') {
                return res.status(404).json({ error: 'Not found' });
            }
            res.sendFile(path.join(__dirname, 'public', 'react-dist', 'index.html'));
        });
        logger.info('Phase 4-6 routes initialized: /api/prompt, /api/terminal, /api/claude');
    }
    /**
     * Setup WebSocket for real-time updates
     */
    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            // Check if this is a team member-specific WebSocket connection
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const isTeamMemberWs = url.pathname === '/ws/team-members';
            const isTerminalWs = url.pathname === '/ws/terminal';
            logger.info({
                pathname: url.pathname,
                isTerminalWs,
                isTeamMemberWs,
                readyState: ws.readyState,
                readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] || 'UNKNOWN',
                remoteAddress: req.socket?.remoteAddress,
                headers: {
                    host: req.headers.host,
                    origin: req.headers.origin,
                    upgrade: req.headers.upgrade
                }
            }, '[WEBSERVER-WS-DEBUG] WebSocket connection established');
            if (isTeamMemberWs) {
                logger.info('[WEBSERVER-WS-DEBUG] Routing to setupTeamMemberWebSocket');
                this.setupTeamMemberWebSocket(ws);
                return;
            }
            // Phase 5: Terminal WebSocket
            if (isTerminalWs) {
                logger.info('[WEBSERVER-WS-DEBUG] Routing to setupTerminalWebSocket');
                this.setupTerminalWebSocket(ws);
                return;
            }
            logger.info('Dashboard WebSocket client connected');
            this.connectedClients.add(ws);
            ws.on('close', () => {
                logger.info('Dashboard WebSocket client disconnected');
                this.connectedClients.delete(ws);
            });
            ws.on('error', (error) => {
                logger.error({ error }, 'Dashboard WebSocket error');
                this.connectedClients.delete(ws);
            });
            // Send initial stats AFTER a delay to let mobile proxies fully establish the connection
            // Mobile carriers often have transparent proxies that kill WebSocket connections if data is sent too quickly
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    this.getStats().then(stats => {
                        ws.send(JSON.stringify({ type: 'stats', data: stats }));
                    }).catch(err => {
                        logger.error({ err }, 'Error sending initial stats');
                    });
                }
            }, 1000);
        });
    }
    /**
     * TeamMember-specific WebSocket clients for live message streaming
     */
    teamMemberWsClients = new Set();
    teamMemberMessageSubscriptions = new Map();
    setupTeamMemberEventForwarding() {
        if (!this.teamMemberTracker)
            return;
        const events = ['teamMember:registered', 'teamMember:status', 'teamMember:log', 'teamMember:tokens', 'teamMember:task'];
        for (const event of events) {
            this.teamMemberTracker.on(event, (data) => {
                this.broadcastUpdate(event.replace(':', '_'), data);
                for (const client of this.connectedClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: event, ...data }));
                    }
                }
            });
        }
        const collabEvents = ['code:shared', 'feedback:given', 'message:sent'];
        for (const event of collabEvents) {
            this.teamMemberTracker.on(event, (data) => {
                this.broadcastUpdate(event.replace(':', '_'), data);
                for (const client of this.connectedClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: event, data }));
                    }
                }
            });
        }
        // Forward limit warnings from TeamMemberDeployment
        if (this.teamMemberDeployment) {
            this.teamMemberDeployment.on('teamMember:limit_warning', (data) => {
                this.broadcastUpdate('teamMember_limit_warning', data);
                for (const client of this.connectedClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'teamMember:limit_warning', teamMemberId: data.teamMemberId, warning: data.warning }));
                    }
                }
            });
            this.teamMemberDeployment.on('teamMember:limit_acknowledged', (data) => {
                this.broadcastUpdate('teamMember_limit_acknowledged', data);
                for (const client of this.connectedClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'teamMember:limit_acknowledged', teamMemberId: data.teamMemberId, limitType: data.type, action: data.action }));
                    }
                }
            });
            // Forward team member responses to connected clients
            this.teamMemberDeployment.on('teamMember:response', (data) => {
                for (const client of this.connectedClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'teamMember:response', teamMemberId: data.teamMemberId, response: data.response }));
                    }
                }
            });
            // Forward team member command events
            this.teamMemberDeployment.on('teamMember:command_sent', (data) => {
                for (const client of this.connectedClients) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'teamMember:command', teamMemberId: data.teamMemberId, command: data.command }));
                    }
                }
            });
        }
    }
    /**
     * Setup WebSocket connection for team member message streaming
     */
    setupTeamMemberWebSocket(ws) {
        logger.info('Team Member WebSocket client connected');
        this.teamMemberWsClients.add(ws);
        this.teamMemberMessageSubscriptions.set(ws, new Set());
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleTeamMemberWsMessage(ws, message);
            }
            catch (error) {
                logger.error({ error }, 'Error parsing team member WebSocket message');
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON message' }));
            }
        });
        ws.on('close', () => {
            logger.info('Team Member WebSocket client disconnected');
            this.teamMemberWsClients.delete(ws);
            this.teamMemberMessageSubscriptions.delete(ws);
        });
        ws.on('error', (error) => {
            logger.error({ error }, 'Team Member WebSocket error');
            this.teamMemberWsClients.delete(ws);
            this.teamMemberMessageSubscriptions.delete(ws);
        });
        // Send initial active team members list AFTER a delay to let mobile proxies fully establish the connection
        // Mobile carriers often have transparent proxies that kill WebSocket connections if data is sent too quickly
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                this.getActiveTeamMemberSessions().then(teamMembers => {
                    ws.send(JSON.stringify({ type: 'active_teamMembers', data: teamMembers }));
                }).catch(err => {
                    logger.error({ err }, 'Error sending initial team members list');
                });
            }
        }, 1000);
    }
    /**
     * Setup WebSocket connection for terminal output streaming (Phase 5)
     * Uses PTY streaming with full ANSI support for colors, formatting, etc.
     */
    setupTerminalWebSocket(ws) {
        logger.info({
            readyState: ws.readyState,
            readyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] || 'UNKNOWN'
        }, '[WEBSERVER-WS-DEBUG] setupTerminalWebSocket called');
        try {
            // Use the new PTY streaming system with full ANSI support
            logger.info('[WEBSERVER-WS-DEBUG] About to call handleTerminalWebSocket...');
            handleTerminalWebSocket(ws, {});
            logger.info('[WEBSERVER-WS-DEBUG] handleTerminalWebSocket returned successfully');
        }
        catch (error) {
            logger.error({
                error,
                stack: error?.stack,
                message: error?.message
            }, '[WEBSERVER-WS-DEBUG] Error in handleTerminalWebSocket call');
            // Try to send error to client
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Server error initializing terminal stream'
                    }));
                    ws.close(1011, 'Internal server error');
                }
            }
            catch (sendError) {
                logger.error({ error: sendError }, '[WEBSERVER-WS-DEBUG] Failed to send error or close ws');
            }
        }
    }
    /**
     * Handle incoming WebSocket messages for team member streaming
     */
    handleTeamMemberWsMessage(ws, message) {
        switch (message.type) {
            case 'subscribe':
                // Subscribe to messages from a specific session
                if (message.sessionId) {
                    const subs = this.teamMemberMessageSubscriptions.get(ws);
                    if (subs) {
                        subs.add(message.sessionId);
                        ws.send(JSON.stringify({ type: 'subscribed', sessionId: message.sessionId }));
                        logger.debug({ sessionId: message.sessionId }, 'Client subscribed to session');
                    }
                }
                break;
            case 'unsubscribe':
                // Unsubscribe from a specific session
                if (message.sessionId) {
                    const subs = this.teamMemberMessageSubscriptions.get(ws);
                    if (subs) {
                        subs.delete(message.sessionId);
                        ws.send(JSON.stringify({ type: 'unsubscribed', sessionId: message.sessionId }));
                    }
                }
                break;
            case 'subscribe_all':
                // Subscribe to all team member messages
                const allSubs = this.teamMemberMessageSubscriptions.get(ws);
                if (allSubs) {
                    allSubs.add('*');
                    ws.send(JSON.stringify({ type: 'subscribed_all' }));
                }
                break;
            case 'get_active':
                // Request current active team members
                this.getActiveTeamMemberSessions().then(teamMembers => {
                    ws.send(JSON.stringify({ type: 'active_teamMembers', data: teamMembers }));
                }).catch(err => {
                    logger.error({ err }, 'Error fetching active team members');
                });
                break;
            case 'get_session_messages':
                // Request recent messages for a session
                if (message.sessionId) {
                    this.getTeamMemberSessionMessages(message.sessionId, 50, 0).then(messages => {
                        ws.send(JSON.stringify({
                            type: 'session_messages',
                            sessionId: message.sessionId,
                            data: messages
                        }));
                    }).catch(err => {
                        logger.error({ err }, 'Error fetching session messages');
                    });
                }
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}` }));
        }
    }
    /**
     * Broadcast team member message to subscribed WebSocket clients
     */
    broadcastTeamMemberMessage(sessionId, message) {
        const payload = JSON.stringify({
            type: 'team_member_message',
            sessionId,
            data: message,
            timestamp: new Date().toISOString()
        });
        for (const [ws, subs] of this.teamMemberMessageSubscriptions) {
            if (ws.readyState === WebSocket.OPEN && (subs.has(sessionId) || subs.has('*'))) {
                ws.send(payload);
            }
        }
    }
    /**
     * Broadcast team member status update to all team member WebSocket clients
     */
    broadcastTeamMemberStatusUpdate(sessionId, status, teamMember) {
        const payload = JSON.stringify({
            type: 'teamMember_status',
            sessionId,
            status,
            data: teamMember,
            timestamp: new Date().toISOString()
        });
        for (const ws of this.teamMemberWsClients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        }
    }
    /**
     * Broadcast message to all connected WebSocket clients
     */
    broadcastUpdate(type, data) {
        const message = JSON.stringify({ type, data });
        for (const client of this.connectedClients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
    /**
     * Get dashboard statistics
     */
    async getStats() {
        let totalMemories = 0;
        let totalSessions = 0;
        let totalFiles = 0;
        let totalSkills = 0;
        let activeTeamMembers = 0;
        try {
            if (this.db) {
                // PROJECT ISOLATION: Only count memories from current project
                const projectPath = getProjectPathForInsert();
                // Get memory count
                const memoryResult = await this.db.query('SELECT COUNT(*) as count FROM memories WHERE project_path = $1', [projectPath]);
                totalMemories = parseInt(memoryResult.rows[0]?.count || '0', 10);
                // Get session count (from memories with session tags)
                const sessionResult = await this.db.query("SELECT COUNT(DISTINCT COALESCE(metadata->>'sessionId', metadata->>'session_id')) as count FROM memories WHERE project_path = $1 AND (metadata->>'sessionId' IS NOT NULL OR metadata->>'session_id' IS NOT NULL)", [projectPath]);
                totalSessions = parseInt(sessionResult.rows[0]?.count || '0', 10);
            }
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching database stats');
        }
        try {
            if (this.codebaseIndexer) {
                const stats = this.codebaseIndexer.getStats();
                totalFiles = stats.totalFiles;
            }
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching codebase stats');
        }
        try {
            if (this.skillScanner) {
                const skills = this.skillScanner.getAllSkills();
                totalSkills = skills.length;
            }
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching skills stats');
        }
        // Try to get team member count from coordination server
        try {
            const response = await fetch(`http://localhost:${this.config.coordinationPort}/teamMembers`);
            if (response.ok) {
                const data = await response.json();
                activeTeamMembers = data.teamMembers?.length || 0;
            }
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching team member stats');
        }
        // Get memory manager stats if available
        let memoryStats;
        try {
            if (this.memoryManager) {
                const memStats = this.memoryManager.getStats();
                memoryStats = {
                    heapUsedMB: Math.round(memStats.heapUsed / 1024 / 1024 * 100) / 100,
                    heapTotalMB: Math.round(memStats.heapTotal / 1024 / 1024 * 100) / 100,
                    maxHeapMB: Math.round(memStats.maxHeap / 1024 / 1024 * 100) / 100,
                    usagePercent: Math.round(memStats.usagePercent * 10000) / 100,
                    pressureLevel: memStats.pressureLevel,
                    embeddingCacheSize: memStats.embeddingCacheSize,
                    totalEvictions: memStats.totalEvictions,
                    totalOverflowed: memStats.totalOverflowed
                };
            }
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching memory manager stats');
        }
        return {
            totalMemories,
            totalSessions,
            totalFiles,
            totalSkills,
            activeTeamMembers,
            uptime: this.isRunning ? Date.now() - this.startTime : 0,
            memory: memoryStats
        };
    }
    /**
     * Persist password change to environment file
     */
    async persistPasswordToEnv(newPassword) {
        // Try common env file locations
        const envPaths = [
            this.envFilePath,
            path.join(process.cwd(), 'specmem.env'),
            path.join(process.cwd(), '.env'),
            path.join(__dirname, '../../specmem.env'),
            path.join(__dirname, '../../.env')
        ].filter(Boolean);
        for (const envPath of envPaths) {
            try {
                const content = await fs.readFile(envPath, 'utf-8');
                // Check if this file has the dashboard password setting
                if (content.includes('SPECMEM_DASHBOARD_PASSWORD')) {
                    const updatedContent = content.replace(/SPECMEM_DASHBOARD_PASSWORD=.*/, `SPECMEM_DASHBOARD_PASSWORD=${newPassword}`);
                    await fs.writeFile(envPath, updatedContent, 'utf-8');
                    logger.info({ envPath }, 'Password persisted to env file');
                    return true;
                }
            }
            catch (error) {
                // File doesn't exist or not readable, try next
                logger.debug({ error, envPath }, 'Could not update env file');
            }
        }
        return false;
    }
    /**
     * Memory configuration state
     */
    memoryConfig = {
        memoryLimit: 100, // MB
        overflowTime: 24, // hours
        cacheSize: 500 // entries
    };
    /**
     * Cache statistics tracking
     */
    cacheStats = {
        queryCacheSize: 0,
        queryCacheHits: 0,
        queryCacheMisses: 0,
        embeddingCacheSize: 0,
        embeddingCacheHits: 0,
        embeddingCacheMisses: 0,
        lastOverflow: null
    };
    /**
     * Get memory configuration
     */
    async getMemoryConfig() {
        // Try to load from env file first
        const envPaths = [
            this.envFilePath,
            path.join(process.cwd(), 'specmem.env'),
            path.join(__dirname, '../../specmem.env')
        ].filter(Boolean);
        for (const envPath of envPaths) {
            try {
                const content = await fs.readFile(envPath, 'utf-8');
                const memoryLimitMatch = content.match(/SPECMEM_MEMORY_LIMIT=(\d+)/);
                const overflowTimeMatch = content.match(/SPECMEM_OVERFLOW_TIME=(\d+)/);
                const cacheSizeMatch = content.match(/SPECMEM_CACHE_SIZE=(\d+)/);
                if (memoryLimitMatch) {
                    this.memoryConfig.memoryLimit = parseInt(memoryLimitMatch[1], 10);
                }
                if (overflowTimeMatch) {
                    this.memoryConfig.overflowTime = parseInt(overflowTimeMatch[1], 10);
                }
                if (cacheSizeMatch) {
                    this.memoryConfig.cacheSize = parseInt(cacheSizeMatch[1], 10);
                }
                break;
            }
            catch (e) {
                // Continue to next path - this is expected when file doesn't exist
                logger.debug({ envPath, error: e }, 'env file not found at this path, trying next');
            }
        }
        return this.memoryConfig;
    }
    /**
     * Persist memory configuration to env file
     */
    async persistMemoryConfig(config) {
        // Update in-memory config
        if (config.memoryLimit !== undefined)
            this.memoryConfig.memoryLimit = config.memoryLimit;
        if (config.overflowTime !== undefined)
            this.memoryConfig.overflowTime = config.overflowTime;
        if (config.cacheSize !== undefined)
            this.memoryConfig.cacheSize = config.cacheSize;
        const envPaths = [
            this.envFilePath,
            path.join(process.cwd(), 'specmem.env'),
            path.join(__dirname, '../../specmem.env')
        ].filter(Boolean);
        for (const envPath of envPaths) {
            try {
                let content = await fs.readFile(envPath, 'utf-8');
                // Update or add memory limit
                if (content.includes('SPECMEM_MEMORY_LIMIT=')) {
                    content = content.replace(/SPECMEM_MEMORY_LIMIT=\d+/, `SPECMEM_MEMORY_LIMIT=${this.memoryConfig.memoryLimit}`);
                }
                else {
                    content += `\nSPECMEM_MEMORY_LIMIT=${this.memoryConfig.memoryLimit}`;
                }
                // Update or add overflow time
                if (content.includes('SPECMEM_OVERFLOW_TIME=')) {
                    content = content.replace(/SPECMEM_OVERFLOW_TIME=\d+/, `SPECMEM_OVERFLOW_TIME=${this.memoryConfig.overflowTime}`);
                }
                else {
                    content += `\nSPECMEM_OVERFLOW_TIME=${this.memoryConfig.overflowTime}`;
                }
                // Update or add cache size
                if (content.includes('SPECMEM_CACHE_SIZE=')) {
                    content = content.replace(/SPECMEM_CACHE_SIZE=\d+/, `SPECMEM_CACHE_SIZE=${this.memoryConfig.cacheSize}`);
                }
                else {
                    content += `\nSPECMEM_CACHE_SIZE=${this.memoryConfig.cacheSize}`;
                }
                await fs.writeFile(envPath, content, 'utf-8');
                logger.info({ envPath, config: this.memoryConfig }, 'Memory configuration persisted');
                return true;
            }
            catch (e) {
                // File not found or not readable, try next path
                logger.debug({ envPath, error: e }, 'couldnt save to env file, trying next');
                continue;
            }
        }
        return false;
    }
    /**
     * Get memory statistics for the dashboard
     * Integrates with the MemoryManager for real heap stats
     */
    async getMemoryStats() {
        let totalMemories = 0;
        let estimatedUsageMB = 0;
        try {
            if (this.db) {
                // PROJECT ISOLATION: Only count memories from current project
                const projectPath = getProjectPathForInsert();
                // Get memory count
                const countResult = await this.db.query('SELECT COUNT(*) as count FROM memories WHERE project_path = $1', [projectPath]);
                totalMemories = parseInt(countResult.rows[0]?.count || '0', 10);
                // Estimate memory usage based on content size
                const sizeResult = await this.db.query(`
          SELECT COALESCE(SUM(LENGTH(content)), 0) as total_size
          FROM memories WHERE project_path = $1
        `, [projectPath]);
                const totalBytes = parseInt(sizeResult.rows[0]?.total_size || '0', 10);
                estimatedUsageMB = Math.round((totalBytes / 1024 / 1024) * 100) / 100;
            }
        }
        catch (error) {
            logger.debug({ error }, 'Error calculating memory stats');
        }
        // Get real heap stats from memory manager
        let heapStats = {
            usedMB: 0,
            totalMB: 0,
            maxMB: 100,
            usagePercent: 0,
            pressureLevel: 'normal',
            rssMB: 0,
            externalMB: 0
        };
        let overflowStats = {
            totalEvictions: 0,
            totalOverflowed: 0,
            lastGC: null
        };
        let embeddingCacheSize = this.cacheStats.embeddingCacheSize;
        try {
            if (this.memoryManager) {
                const memStats = this.memoryManager.getStats();
                heapStats = {
                    usedMB: Math.round(memStats.heapUsed / 1024 / 1024 * 100) / 100,
                    totalMB: Math.round(memStats.heapTotal / 1024 / 1024 * 100) / 100,
                    maxMB: Math.round(memStats.maxHeap / 1024 / 1024 * 100) / 100,
                    usagePercent: Math.round(memStats.usagePercent * 10000) / 100,
                    pressureLevel: memStats.pressureLevel,
                    rssMB: Math.round(memStats.rss / 1024 / 1024 * 100) / 100,
                    externalMB: Math.round(memStats.external / 1024 / 1024 * 100) / 100
                };
                overflowStats = {
                    totalEvictions: memStats.totalEvictions,
                    totalOverflowed: memStats.totalOverflowed,
                    lastGC: memStats.lastGC?.toISOString() || null
                };
                embeddingCacheSize = memStats.embeddingCacheSize;
            }
            else {
                // Fallback to process.memoryUsage if no memory manager
                const mem = process.memoryUsage();
                heapStats = {
                    usedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
                    totalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
                    maxMB: 100, // Default limit
                    usagePercent: Math.round((mem.heapUsed / (100 * 1024 * 1024)) * 10000) / 100,
                    pressureLevel: 'unknown',
                    rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
                    externalMB: Math.round(mem.external / 1024 / 1024 * 100) / 100
                };
            }
        }
        catch (error) {
            logger.debug({ error }, 'Error getting heap stats');
        }
        // Calculate cache hit rate
        const totalHits = this.cacheStats.queryCacheHits + this.cacheStats.embeddingCacheHits;
        const totalMisses = this.cacheStats.queryCacheMisses + this.cacheStats.embeddingCacheMisses;
        const cacheHitRate = totalHits + totalMisses > 0
            ? Math.round((totalHits / (totalHits + totalMisses)) * 100)
            : 0;
        // Determine trend based on pressure level
        let trend = 'STABLE';
        if (heapStats.pressureLevel === 'emergency') {
            trend = 'CRITICAL';
        }
        else if (heapStats.pressureLevel === 'critical') {
            trend = 'UP';
        }
        else if (heapStats.pressureLevel === 'warning') {
            trend = 'RISING';
        }
        return {
            currentUsage: estimatedUsageMB,
            totalMemories,
            cacheHitRate,
            lastOverflow: this.cacheStats.lastOverflow?.toISOString() || overflowStats.lastGC,
            peakUsage: heapStats.usedMB, // Real peak from actual usage
            avgUsage: Math.round(heapStats.usedMB * 0.8 * 100) / 100,
            trend,
            queryCacheSize: this.cacheStats.queryCacheSize,
            embeddingCacheSize: embeddingCacheSize,
            heap: heapStats,
            overflow: overflowStats
        };
    }
    /**
     * Trigger overflow cleanup based on configuration
     * PROJECT ISOLATED: Only cleans up current project's memories
     */
    async triggerOverflowCleanup() {
        if (!this.db) {
            return { deleted: 0, message: 'Database not available' };
        }
        try {
            const cutoffTime = new Date();
            cutoffTime.setHours(cutoffTime.getHours() - this.memoryConfig.overflowTime);
            const projectPath = getProjectPathForInsert();
            // Delete memories older than the overflow time that haven't been accessed recently
            // PROJECT ISOLATED: Only delete from current project
            const result = await this.db.query(`
        DELETE FROM memories
        WHERE updated_at < $1
          AND importance NOT IN ('critical', 'high')
          AND access_count < 5
          AND project_path = $2
        RETURNING id
      `, [cutoffTime.toISOString(), projectPath]);
            const deletedCount = result.rowCount ?? 0;
            this.cacheStats.lastOverflow = new Date();
            logger.info({ deletedCount, cutoffTime, projectPath }, 'Overflow cleanup completed');
            return {
                deleted: deletedCount,
                message: `Cleaned up ${deletedCount} memories older than ${this.memoryConfig.overflowTime} hours`
            };
        }
        catch (error) {
            logger.error({ error }, 'Overflow cleanup failed');
            throw error;
        }
    }
    /**
     * Emergency memory purge - deletes ALL memories
     * PROJECT ISOLATED: Only purges current project's memories
     */
    async emergencyMemoryPurge() {
        if (!this.db) {
            return { deleted: 0, message: 'Database not available' };
        }
        try {
            const projectPath = getProjectPathForInsert();
            // Get count before deletion - only for current project
            const countResult = await this.db.query('SELECT COUNT(*) as count FROM memories WHERE project_path = $1', [projectPath]);
            const totalBefore = parseInt(countResult.rows[0]?.count || '0', 10);
            // Delete all memories for current project only
            await this.db.query('DELETE FROM memories WHERE project_path = $1', [projectPath]);
            // Reset cache stats
            this.cacheStats.queryCacheSize = 0;
            this.cacheStats.embeddingCacheSize = 0;
            this.cacheStats.lastOverflow = new Date();
            logger.warn({ deletedCount: totalBefore, projectPath }, 'Emergency memory purge executed for project');
            return {
                deleted: totalBefore,
                message: `Emergency purge complete. ${totalBefore} memories permanently deleted from current project.`
            };
        }
        catch (error) {
            logger.error({ error }, 'Emergency purge failed');
            throw error;
        }
    }
    /**
     * Clear specific cache type
     */
    async clearCache(type) {
        try {
            if (type === 'query') {
                this.cacheStats.queryCacheSize = 0;
                this.cacheStats.queryCacheHits = 0;
                this.cacheStats.queryCacheMisses = 0;
                logger.info('Query cache cleared');
                return { cleared: true, message: 'Query cache yeeted, clean slate fr' };
            }
            else if (type === 'embedding') {
                this.cacheStats.embeddingCacheSize = 0;
                this.cacheStats.embeddingCacheHits = 0;
                this.cacheStats.embeddingCacheMisses = 0;
                logger.info('Embedding cache cleared');
                return { cleared: true, message: 'Embedding cache wiped clean, let\'s go' };
            }
            return { cleared: false, message: 'Unknown cache type' };
        }
        catch (error) {
            logger.error({ error, type }, 'Failed to clear cache');
            throw error;
        }
    }
    getFileExtension(language) {
        const extMap = {
            typescript: 'ts', javascript: 'js', python: 'py', rust: 'rs',
            go: 'go', java: 'java', cpp: 'cpp', c: 'c', ruby: 'rb',
            php: 'php', sql: 'sql', bash: 'sh', yaml: 'yaml', json: 'json',
            markdown: 'md', html: 'html', css: 'css', text: 'txt'
        };
        return extMap[language] || 'txt';
    }
    /**
     * Get memories with optional search (supports text and semantic search)
     */
    async getMemories(search, limit = 50, offset = 0) {
        if (!this.db) {
            return { memories: [], total: 0 };
        }
        // PROJECT ISOLATION: Filter by project_path
        const projectPath = getProjectPathForInsert();
        // If no search, return paginated results
        if (!search) {
            const query = `
        SELECT id, content, tags, metadata, importance, memory_type, created_at, updated_at, access_count
        FROM memories
        WHERE project_path = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
            const countQuery = `SELECT COUNT(*) as count FROM memories WHERE project_path = $1`;
            const [memoriesResult, countResult] = await Promise.all([
                this.db.query(query, [projectPath, limit, offset]),
                this.db.query(countQuery, [projectPath])
            ]);
            return {
                memories: memoriesResult.rows,
                total: parseInt(countResult.rows[0]?.count || '0', 10)
            };
        }
        // Try semantic search first if embedding provider is available
        if (this.embeddingProvider) {
            try {
                const embedding = await this.embeddingProvider.generateEmbedding(search);
                const embeddingStr = `[${embedding.join(',')}]`;
                // Hybrid search: combine vector similarity with text matching
                // PROJECT ISOLATION: Filter by project_path
                const query = `
          WITH vector_matches AS (
            SELECT
              id, content, tags, metadata, importance, memory_type,
              created_at, updated_at, access_count,
              1 - (embedding <=> $1::vector) AS similarity
            FROM memories
            WHERE project_path = $6
              AND embedding IS NOT NULL
              AND (embedding <=> $1::vector) < 0.5
            ORDER BY embedding <=> $1::vector
            LIMIT $2
          ),
          text_matches AS (
            SELECT
              id, content, tags, metadata, importance, memory_type,
              created_at, updated_at, access_count,
              ts_rank(content_tsv, plainto_tsquery('english', $3)) AS similarity
            FROM memories
            WHERE project_path = $6
              AND (content_tsv @@ plainto_tsquery('english', $3)
               OR content ILIKE $4
               OR $3 = ANY(tags))
            ORDER BY similarity DESC
            LIMIT $2
          ),
          combined AS (
            SELECT * FROM vector_matches
            UNION
            SELECT * FROM text_matches
          )
          SELECT DISTINCT ON (id) *
          FROM combined
          ORDER BY id, similarity DESC
          LIMIT $2 OFFSET $5
        `;
                const countQuery = `
          SELECT COUNT(DISTINCT id) as count FROM (
            SELECT id FROM memories
            WHERE project_path = $4 AND embedding IS NOT NULL AND (embedding <=> $1::vector) < 0.5
            UNION
            SELECT id FROM memories
            WHERE project_path = $4
              AND (content_tsv @@ plainto_tsquery('english', $2)
               OR content ILIKE $3
               OR $2 = ANY(tags))
          ) combined
        `;
                const [memoriesResult, countResult] = await Promise.all([
                    this.db.query(query, [embeddingStr, limit, search, `%${search}%`, offset, projectPath]),
                    this.db.query(countQuery, [embeddingStr, search, `%${search}%`, projectPath])
                ]);
                return {
                    memories: memoriesResult.rows,
                    total: parseInt(countResult.rows[0]?.count || '0', 10),
                    searchType: 'hybrid'
                };
            }
            catch (error) {
                logger.warn({ error }, 'Semantic search failed, falling back to text search');
            }
        }
        // Fallback to text search with full-text search support
        // PROJECT ISOLATION: Filter by project_path
        const query = `
      SELECT id, content, tags, metadata, importance, memory_type, created_at, updated_at, access_count,
             CASE
               WHEN content_tsv @@ plainto_tsquery('english', $1) THEN ts_rank(content_tsv, plainto_tsquery('english', $1))
               ELSE 0
             END AS rank
      FROM memories
      WHERE project_path = $5
        AND (content_tsv @@ plainto_tsquery('english', $1)
         OR content ILIKE $2
         OR $1 = ANY(tags))
      ORDER BY rank DESC, created_at DESC
      LIMIT $3 OFFSET $4
    `;
        const countQuery = `
      SELECT COUNT(*) as count FROM memories
      WHERE project_path = $3
        AND (content_tsv @@ plainto_tsquery('english', $1)
         OR content ILIKE $2
         OR $1 = ANY(tags))
    `;
        const [memoriesResult, countResult] = await Promise.all([
            this.db.query(query, [search, `%${search}%`, limit, offset, projectPath]),
            this.db.query(countQuery, [search, `%${search}%`, projectPath])
        ]);
        return {
            memories: memoriesResult.rows,
            total: parseInt(countResult.rows[0]?.count || '0', 10),
            searchType: 'text'
        };
    }
    /**
     * Get memories for Camera Roll mode with zoom-based similarity threshold
     * Returns results with similarity scores for drilldown functionality
     */
    async getCameraRollMemories(search, similarityThreshold, limit, offset = 0) {
        if (!this.db) {
            return { memories: [], total: 0, searchType: 'none' };
        }
        // PROJECT ISOLATION: Filter by project_path
        const projectPath = getProjectPathForInsert();
        // If no search query, return recent memories with default similarity
        if (!search) {
            const query = `
        SELECT id, content, tags, metadata, importance, memory_type,
               created_at, updated_at, access_count,
               0.5 as similarity
        FROM memories
        WHERE project_path = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
            const countQuery = `SELECT COUNT(*) as count FROM memories WHERE project_path = $1`;
            const [memoriesResult, countResult] = await Promise.all([
                this.db.query(query, [projectPath, limit, offset]),
                this.db.query(countQuery, [projectPath])
            ]);
            return {
                memories: memoriesResult.rows,
                total: parseInt(countResult.rows[0]?.count || '0', 10),
                searchType: 'recent'
            };
        }
        // Try semantic search with zoom-appropriate threshold
        if (this.embeddingProvider) {
            try {
                const embedding = await this.embeddingProvider.generateEmbedding(search);
                const embeddingStr = `[${embedding.join(',')}]`;
                // Calculate distance threshold from similarity threshold
                // similarity = 1 - distance, so distance = 1 - similarity
                const distanceThreshold = 1 - similarityThreshold;
                // Vector search with zoom-based threshold
                // PROJECT ISOLATION: Filter by project_path
                const query = `
          SELECT
            id, content, tags, metadata, importance, memory_type,
            created_at, updated_at, access_count,
            1 - (embedding <=> $1::vector) AS similarity
          FROM memories
          WHERE project_path = $5
            AND embedding IS NOT NULL
            AND (embedding <=> $1::vector) < $2
          ORDER BY embedding <=> $1::vector
          LIMIT $3 OFFSET $4
        `;
                const countQuery = `
          SELECT COUNT(*) as count
          FROM memories
          WHERE project_path = $3
            AND embedding IS NOT NULL
            AND (embedding <=> $1::vector) < $2
        `;
                const [memoriesResult, countResult] = await Promise.all([
                    this.db.query(query, [embeddingStr, distanceThreshold, limit, offset, projectPath]),
                    this.db.query(countQuery, [embeddingStr, distanceThreshold, projectPath])
                ]);
                return {
                    memories: memoriesResult.rows,
                    total: parseInt(countResult.rows[0]?.count || '0', 10),
                    searchType: 'hybrid'
                };
            }
            catch (error) {
                logger.warn({ error }, 'Camera roll semantic search failed, falling back to text search');
            }
        }
        // Fallback to text search
        const query = `
      SELECT id, content, tags, metadata, importance, memory_type,
             created_at, updated_at, access_count,
             CASE
               WHEN content_tsv @@ plainto_tsquery('english', $1)
               THEN ts_rank(content_tsv, plainto_tsquery('english', $1))
               ELSE 0.3
             END AS similarity
      FROM memories
      WHERE content_tsv @@ plainto_tsquery('english', $1)
         OR content ILIKE $2
         OR $1 = ANY(tags)
      ORDER BY similarity DESC, created_at DESC
      LIMIT $3 OFFSET $4
    `;
        const countQuery = `
      SELECT COUNT(*) as count FROM memories
      WHERE content_tsv @@ plainto_tsquery('english', $1)
         OR content ILIKE $2
         OR $1 = ANY(tags)
    `;
        const [memoriesResult, countResult] = await Promise.all([
            this.db.query(query, [search, `%${search}%`, limit, offset]),
            this.db.query(countQuery, [search, `%${search}%`])
        ]);
        return {
            memories: memoriesResult.rows,
            total: parseInt(countResult.rows[0]?.count || '0', 10),
            searchType: 'text'
        };
    }
    /**
     * Get a single memory by ID with full details
     */
    async getMemoryById(id) {
        if (!this.db) {
            return null;
        }
        const result = await this.db.query(`
      SELECT
        id,
        content,
        tags,
        metadata,
        importance,
        memory_type,
        created_at,
        updated_at,
        access_count,
        expires_at,
        embedding[1:5] as embedding_preview
      FROM memories
      WHERE id = $1
    `, [id]);
        if (result.rowCount === 0) {
            return null;
        }
        const row = result.rows[0];
        // Update access count for this memory
        await this.db.query(`
      UPDATE memories
      SET access_count = access_count + 1, updated_at = NOW()
      WHERE id = $1
    `, [id]);
        return {
            id: row.id,
            content: row.content,
            tags: row.tags || [],
            metadata: row.metadata || {},
            importance: row.importance,
            memory_type: row.memory_type,
            created_at: row.created_at,
            updated_at: row.updated_at,
            access_count: row.access_count + 1,
            expires_at: row.expires_at,
            embedding_preview: row.embedding_preview
        };
    }
    /**
     * Delete a memory by ID
     * PROJECT ISOLATED: Only deletes from current project
     */
    async deleteMemory(id) {
        if (!this.db) {
            throw new Error('Database not available');
        }
        const projectPath = getProjectPathForInsert();
        await this.db.query('DELETE FROM memories WHERE id = $1 AND project_path = $2', [id, projectPath]);
        this.broadcastUpdate('memory_deleted', { id });
    }
    /**
     * Bulk delete memories based on criteria
     * PROJECT ISOLATED: Only deletes from current project
     */
    async bulkDeleteMemories(criteria) {
        if (!this.db) {
            throw new Error('Database not available');
        }
        const conditions = [];
        const values = [];
        let paramIndex = 1;
        // PROJECT ISOLATION: Always filter by project_path first
        const projectPath = getProjectPathForInsert();
        conditions.push(`project_path = $${paramIndex}`);
        values.push(projectPath);
        paramIndex++;
        // Delete by IDs
        if (criteria.ids && criteria.ids.length > 0) {
            conditions.push(`id = ANY($${paramIndex})`);
            values.push(criteria.ids);
            paramIndex++;
        }
        // Delete older than date
        if (criteria.olderThan) {
            conditions.push(`created_at < $${paramIndex}`);
            values.push(criteria.olderThan);
            paramIndex++;
        }
        // Delete by tags (memories having any of these tags)
        if (criteria.tags && criteria.tags.length > 0) {
            conditions.push(`tags && $${paramIndex}`);
            values.push(criteria.tags);
            paramIndex++;
        }
        // Delete only expired memories
        if (criteria.expiredOnly) {
            conditions.push('expires_at IS NOT NULL AND expires_at < NOW()');
        }
        // We always have project_path, but need at least one other criterion
        if (conditions.length === 1) {
            throw new Error('At least one deletion criterion required (besides project filter)');
        }
        const query = `DELETE FROM memories WHERE ${conditions.join(' AND ')} RETURNING id`;
        const result = await this.db.query(query, values);
        const deletedCount = result.rowCount ?? 0;
        if (deletedCount > 0) {
            this.broadcastUpdate('memories_bulk_deleted', {
                count: deletedCount,
                criteria
            });
        }
        logger.info({ deletedCount, criteria, projectPath }, 'Bulk delete completed');
        return { deleted: deletedCount };
    }
    /**
     * Get Claude sessions with detailed information
     */
    async getSessions() {
        if (!this.db) {
            return [];
        }
        // Get detailed session information including memory types and importance distribution
        // Get unique sessions with deduplication
        // The DISTINCT ON ensures we get unique session_ids and avoid any edge cases
        const result = await this.db.query(`
      WITH session_memories AS (
        SELECT
          COALESCE(metadata->>'sessionId', metadata->>'session_id') as session_id,
          id,
          memory_type,
          importance,
          tags,
          created_at,
          content,
          metadata
        FROM memories
        WHERE (metadata->>'sessionId' IS NOT NULL AND metadata->>'sessionId' != '')
           OR (metadata->>'session_id' IS NOT NULL AND metadata->>'session_id' != '')
      ),
      session_aggregates AS (
        SELECT
          session_id,
          MIN(created_at) as started_at,
          MAX(created_at) as last_activity,
          COUNT(*) as memory_count,
          COUNT(*) as message_count,
          COUNT(DISTINCT memory_type) as memory_types_used,
          ARRAY_AGG(DISTINCT memory_type) as memory_types,
          ARRAY_AGG(DISTINCT importance) as importance_levels,
          MAX(metadata->>'project') as project,
          MAX(metadata->>'workingDirectory') as working_directory,
          EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))/60 as duration_minutes
        FROM session_memories
        WHERE session_id IS NOT NULL AND session_id != ''
        GROUP BY session_id
      )
      SELECT
        session_id,
        started_at,
        last_activity,
        memory_count,
        message_count,
        memory_types_used,
        memory_types,
        importance_levels,
        project,
        working_directory,
        duration_minutes
      FROM session_aggregates
      ORDER BY last_activity DESC
      LIMIT 100
    `);
        return result.rows;
    }
    /**
     * Get codebase files with content search support
     */
    async getCodebaseFiles(filePath, search) {
        if (!this.codebaseIndexer) {
            return { files: [], stats: {} };
        }
        const stats = this.codebaseIndexer.getStats();
        // Get all files
        const allFiles = this.codebaseIndexer.getAllFiles();
        // Filter by search term or path
        let files = allFiles;
        let searchType;
        if (search) {
            const searchLower = search.toLowerCase();
            // Check if search should include file content
            const includeContent = search.startsWith('content:') || search.startsWith('code:');
            const searchTerm = includeContent ? search.replace(/^(content:|code:)/, '').trim() : search;
            const searchTermLower = searchTerm.toLowerCase();
            if (includeContent) {
                // Content search - search within file contents
                searchType = 'content';
                files = allFiles.filter(f => f.content.toLowerCase().includes(searchTermLower)).slice(0, 50);
                // Extract matching lines for context
                const filesWithMatches = files.map(f => {
                    const lines = f.content.split('\n');
                    const matchingLines = [];
                    lines.forEach((line, index) => {
                        if (line.toLowerCase().includes(searchTermLower)) {
                            matchingLines.push({
                                lineNumber: index + 1,
                                content: line.trim().slice(0, 200)
                            });
                        }
                    });
                    return {
                        path: f.filePath,
                        name: f.fileName,
                        language: f.language,
                        lines: f.lineCount,
                        size: f.sizeBytes,
                        lastModified: f.lastModified,
                        matches: matchingLines.slice(0, 5), // Top 5 matches
                        matchCount: matchingLines.length
                    };
                });
                return {
                    files: filesWithMatches,
                    stats,
                    searchType
                };
            }
            else {
                // Path/name search
                searchType = 'path';
                files = allFiles.filter(f => f.filePath.toLowerCase().includes(searchLower) ||
                    f.fileName.toLowerCase().includes(searchLower) ||
                    f.language.toLowerCase().includes(searchLower)).slice(0, 100);
            }
        }
        else if (filePath) {
            // Filter by path prefix
            files = allFiles.filter(f => f.filePath.startsWith(filePath));
        }
        else {
            // Return most recently modified files
            files = [...allFiles]
                .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
                .slice(0, 100);
        }
        // Map to simpler format for frontend
        const mappedFiles = files.map(f => ({
            path: f.filePath,
            name: f.fileName,
            language: f.language,
            lines: f.lineCount,
            size: f.sizeBytes,
            lastModified: f.lastModified
        }));
        return { files: mappedFiles, stats, searchType };
    }
    /**
     * Get file content from the codebase indexer
     */
    async getFileContent(filePath) {
        if (!this.codebaseIndexer) {
            return null;
        }
        const file = this.codebaseIndexer.getFile(filePath);
        if (!file) {
            return null;
        }
        return {
            path: file.filePath,
            name: file.fileName,
            language: file.language,
            content: file.content,
            lines: file.lineCount,
            size: file.sizeBytes
        };
    }
    /**
     * Get skills
     */
    async getSkills() {
        if (!this.skillScanner) {
            return { skills: [], categories: [] };
        }
        const skills = this.skillScanner.getAllSkills();
        const categories = this.skillScanner.getCategories();
        return {
            skills: skills.map(s => ({
                id: s.id,
                name: s.name,
                category: s.category,
                description: s.description,
                path: s.filePath,
                size: s.content.length,
                content: s.content // Include content so frontend can display/edit it
            })),
            categories
        };
    }
    /**
     * Reload skills
     */
    async reloadSkills() {
        if (!this.skillScanner) {
            throw new Error('Skill scanner not available');
        }
        await this.skillScanner.scan();
        this.broadcastUpdate('skills_reloaded', await this.getSkills());
    }
    /**
     * Get active team members from discovery service (SpecMem-based)
     */
    async getTeamMembers() {
        try {
            // Get team members from discovery service (SpecMem heartbeat-based)
            if (this.dashboardDiscovery) {
                const discovered = await this.dashboardDiscovery.getActiveTeamMembers(120000); // 2 min expiry
                return discovered.map((d) => ({
                    id: d.teamMemberId,
                    name: d.teamMemberId,
                    type: d.teamMemberType,
                    connected: true,
                    lastSeen: d.lastHeartbeat
                }));
            }
            // Fallback to coordination server if discovery not available
            const response = await fetch(`http://localhost:${this.config.coordinationPort}/teamMembers`);
            if (response.ok) {
                const data = await response.json();
                return data.teamMembers || [];
            }
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching team members');
        }
        return [];
    }
    // ==================== TEAM_MEMBER COMMUNICATION DASHBOARD METHODS ====================
    /**
     * Get all currently active team member sessions from database
     */
    async getActiveTeamMemberSessions() {
        if (!this.db) {
            return { sessions: [], count: 0 };
        }
        try {
            const result = await this.db.query(`
        SELECT
          id,
          team_member_id,
          team_member_name,
          team_member_type,
          status,
          started_at,
          last_heartbeat,
          current_task,
          working_directory,
          project_name,
          message_count,
          tool_calls,
          errors_count,
          tokens_used,
          metadata,
          capabilities
        FROM team_member_sessions
        WHERE status IN ('active', 'idle', 'busy')
          AND last_heartbeat > NOW() - INTERVAL '5 minutes'
        ORDER BY last_heartbeat DESC
      `);
            return {
                sessions: result.rows,
                count: result.rowCount ?? 0
            };
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching active team member sessions');
            return { sessions: [], count: 0 };
        }
    }
    /**
     * Get team member session history with pagination and filtering
     */
    async getTeamMemberSessionHistory(limit, offset, teamMemberType, status) {
        if (!this.db) {
            return { sessions: [], total: 0, limit, offset };
        }
        try {
            const conditions = [];
            const values = [];
            let paramIndex = 1;
            if (teamMemberType) {
                conditions.push(`team_member_type = $${paramIndex}`);
                values.push(teamMemberType);
                paramIndex++;
            }
            if (status) {
                conditions.push(`status = $${paramIndex}`);
                values.push(status);
                paramIndex++;
            }
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            // Get total count
            const countResult = await this.db.query(`SELECT COUNT(*) as count FROM team_member_sessions ${whereClause}`, values);
            const total = parseInt(countResult.rows[0]?.count || '0', 10);
            // Get paginated results
            values.push(limit, offset);
            const result = await this.db.query(`
        SELECT
          id,
          team_member_id,
          team_member_name,
          team_member_type,
          status,
          started_at,
          ended_at,
          last_heartbeat,
          current_task,
          project_name,
          message_count,
          tool_calls,
          errors_count,
          tokens_used,
          EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)) as duration_seconds
        FROM team_member_sessions
        ${whereClause}
        ORDER BY started_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, values);
            return {
                sessions: result.rows,
                total,
                limit,
                offset
            };
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching team member session history');
            return { sessions: [], total: 0, limit, offset };
        }
    }
    /**
     * Get detailed information about a specific team member session
     */
    async getTeamMemberSessionDetails(sessionId, includeMessages = true, messageLimit = 100) {
        if (!this.db) {
            return null;
        }
        try {
            // Get session details
            const sessionResult = await this.db.query(`
        SELECT
          s.*,
          EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)) as duration_seconds,
          (SELECT COUNT(*) FROM team_member_messages WHERE session_id = s.id) as total_messages,
          (SELECT COUNT(*) FROM team_member_messages WHERE session_id = s.id AND message_type = 'tool_call') as total_tool_calls,
          (SELECT COUNT(*) FROM team_member_messages WHERE session_id = s.id AND is_error = true) as total_errors
        FROM team_member_sessions s
        WHERE s.id = $1
      `, [sessionId]);
            if (sessionResult.rowCount === 0) {
                return null;
            }
            const session = sessionResult.rows[0];
            const response = { session };
            // Get messages if requested
            if (includeMessages) {
                const messagesResult = await this.db.query(`
          SELECT
            id,
            message_type,
            direction,
            sequence_number,
            content_preview as content,
            tool_name,
            tool_duration_ms,
            role,
            importance,
            input_tokens,
            output_tokens,
            is_error,
            error_message,
            timestamp
          FROM team_member_messages
          WHERE session_id = $1
          ORDER BY sequence_number DESC
          LIMIT $2
        `, [sessionId, messageLimit]);
                response.messages = messagesResult.rows;
                response.messageCount = messagesResult.rowCount ?? 0;
            }
            return response;
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching session details');
            return null;
        }
    }
    /**
     * Get messages for a specific session with pagination
     */
    async getTeamMemberSessionMessages(sessionId, limit = 50, offset = 0, messageType) {
        if (!this.db) {
            return { messages: [], total: 0, limit, offset };
        }
        try {
            const conditions = ['session_id = $1'];
            const values = [sessionId];
            let paramIndex = 2;
            if (messageType) {
                conditions.push(`message_type = $${paramIndex}`);
                values.push(messageType);
                paramIndex++;
            }
            const whereClause = `WHERE ${conditions.join(' AND ')}`;
            // Get total count
            const countResult = await this.db.query(`SELECT COUNT(*) as count FROM team_member_messages ${whereClause}`, values);
            const total = parseInt(countResult.rows[0]?.count || '0', 10);
            // Get paginated results
            values.push(limit, offset);
            const result = await this.db.query(`
        SELECT
          id,
          message_type,
          direction,
          sequence_number,
          content,
          tool_name,
          tool_input,
          tool_output,
          tool_error,
          tool_duration_ms,
          role,
          importance,
          input_tokens,
          output_tokens,
          estimated_cost_cents,
          is_error,
          error_code,
          error_message,
          timestamp
        FROM team_member_messages
        ${whereClause}
        ORDER BY sequence_number DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, values);
            return {
                messages: result.rows,
                total,
                limit,
                offset
            };
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching session messages');
            return { messages: [], total: 0, limit, offset };
        }
    }
    /**
     * Get team member deployments with pagination and filtering
     */
    async getTeamMemberDeployments(limit, offset, status, environment) {
        if (!this.db) {
            return { deployments: [], total: 0, limit, offset };
        }
        try {
            const conditions = [];
            const values = [];
            let paramIndex = 1;
            if (status) {
                conditions.push(`status = $${paramIndex}`);
                values.push(status);
                paramIndex++;
            }
            if (environment) {
                conditions.push(`environment = $${paramIndex}`);
                values.push(environment);
                paramIndex++;
            }
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            // Get total count
            const countResult = await this.db.query(`SELECT COUNT(*) as count FROM team_member_deployments ${whereClause}`, values);
            const total = parseInt(countResult.rows[0]?.count || '0', 10);
            // Get paginated results
            values.push(limit, offset);
            const result = await this.db.query(`
        SELECT
          id,
          deployment_name,
          deployment_type,
          environment,
          team_member_count,
          status,
          health,
          started_at,
          completed_at,
          task_description,
          success,
          result_summary,
          actual_tokens_used,
          actual_cost_cents,
          tags,
          EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) as duration_seconds
        FROM team_member_deployments
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, values);
            return {
                deployments: result.rows,
                total,
                limit,
                offset
            };
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching deployments');
            return { deployments: [], total: 0, limit, offset };
        }
    }
    /**
     * Get aggregate statistics for team members
     */
    async getTeamMemberStats() {
        if (!this.db) {
            return {
                activeSessions: 0,
                totalSessions: 0,
                totalMessages: 0,
                totalToolCalls: 0,
                totalTokens: 0,
                avgSessionDuration: 0,
                errorRate: 0,
                topTeamMemberTypes: [],
                recentActivity: []
            };
        }
        try {
            // Get basic counts
            const countsResult = await this.db.query(`
        SELECT
          (SELECT COUNT(*) FROM team_member_sessions WHERE status IN ('active', 'idle', 'busy')) as active_sessions,
          (SELECT COUNT(*) FROM team_member_sessions) as total_sessions,
          (SELECT COUNT(*) FROM team_member_messages) as total_messages,
          (SELECT COUNT(*) FROM team_member_messages WHERE message_type = 'tool_call') as total_tool_calls,
          (SELECT COALESCE(SUM(tokens_used), 0) FROM team_member_sessions) as total_tokens,
          (SELECT AVG(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)))
           FROM team_member_sessions WHERE started_at IS NOT NULL) as avg_duration,
          (SELECT COUNT(*)::FLOAT / NULLIF(COUNT(*) FILTER (WHERE NOT is_error), 0) * 100
           FROM team_member_messages) as error_rate
      `);
            const counts = countsResult.rows[0] || {};
            // Get top team member types
            const typesResult = await this.db.query(`
        SELECT team_member_type as type, COUNT(*) as count
        FROM team_member_sessions
        GROUP BY team_member_type
        ORDER BY count DESC
        LIMIT 5
      `);
            // Get recent activity (last 24 hours by hour)
            const activityResult = await this.db.query(`
        SELECT
          DATE_TRUNC('hour', s.started_at) as hour,
          COUNT(DISTINCT s.id) as sessions,
          COUNT(m.id) as messages
        FROM team_member_sessions s
        LEFT JOIN team_member_messages m ON m.session_id = s.id
          AND m.timestamp >= NOW() - INTERVAL '24 hours'
        WHERE s.started_at >= NOW() - INTERVAL '24 hours'
        GROUP BY DATE_TRUNC('hour', s.started_at)
        ORDER BY hour DESC
        LIMIT 24
      `);
            return {
                activeSessions: parseInt(counts.active_sessions || '0', 10),
                totalSessions: parseInt(counts.total_sessions || '0', 10),
                totalMessages: parseInt(counts.total_messages || '0', 10),
                totalToolCalls: parseInt(counts.total_tool_calls || '0', 10),
                totalTokens: parseInt(counts.total_tokens || '0', 10),
                avgSessionDuration: parseFloat(counts.avg_duration || '0'),
                errorRate: parseFloat(counts.error_rate || '0'),
                topTeamMemberTypes: typesResult.rows.map((r) => ({
                    type: r.type,
                    count: parseInt(r.count, 10)
                })),
                recentActivity: activityResult.rows.map((r) => ({
                    hour: r.hour,
                    sessions: parseInt(r.sessions, 10),
                    messages: parseInt(r.messages, 10)
                }))
            };
        }
        catch (error) {
            logger.debug({ error }, 'Error fetching team member stats');
            return {
                activeSessions: 0,
                totalSessions: 0,
                totalMessages: 0,
                totalToolCalls: 0,
                totalTokens: 0,
                avgSessionDuration: 0,
                errorRate: 0,
                topTeamMemberTypes: [],
                recentActivity: []
            };
        }
    }
    /**
     * Set database manager
     */
    setDatabase(db) {
        this.db = db;
    }
    /**
     * Set skill scanner
     */
    setSkillScanner(scanner) {
        this.skillScanner = scanner;
    }
    /**
     * Set codebase indexer
     */
    setCodebaseIndexer(indexer) {
        this.codebaseIndexer = indexer;
    }
    /**
     * Set embedding provider for semantic search
     */
    setEmbeddingProvider(provider) {
        this.embeddingProvider = provider;
    }
    /**
     * Set memory manager for heap monitoring
     */
    setMemoryManager(manager) {
        this.memoryManager = manager;
    }
    /**
     * Set embedding overflow handler
     */
    setEmbeddingOverflowHandler(handler) {
        this.embeddingOverflowHandler = handler;
    }
    /**
     * Set path to env file for password persistence
     */
    setEnvFilePath(envPath) {
        this.envFilePath = envPath;
    }
    /**
     * Start the server with port retry logic
     * Will try multiple ports if the base port is in use
     */
    async start() {
        if (this.isRunning) {
            logger.warn('Dashboard server already running');
            return;
        }
        // Try to get database
        try {
            // Build database config from environment variables
            const dbConfig = {
                host: process.env['SPECMEM_DB_HOST'] || 'localhost',
                port: parseInt(process.env['SPECMEM_DB_PORT'] || '5432', 10),
                database: process.env['SPECMEM_DB_NAME'] || 'specmem_westayunprofessional',
                user: process.env['SPECMEM_DB_USER'] || 'specmem_westayunprofessional',
                password: process.env['SPECMEM_DB_PASSWORD'] || '',
                maxConnections: parseInt(process.env['SPECMEM_DB_MAX_CONNECTIONS'] || '20', 10),
                idleTimeout: 30000,
                connectionTimeout: 5000
            };
            this.db = getDatabase(dbConfig);
            if (this.db) {
                await this.db.initialize(); // sets up schema isolation
            }
        }
        catch (error) {
            logger.warn('Database not available for dashboard');
        }
        // Initialize PostgreSQL session store if database is available
        if (this.db) {
            try {
                const store = await createSessionStore(this.db, {
                    tableName: 'dashboard_sessions',
                    cleanupIntervalMs: 15 * 60 * 1000, // 15 minutes
                    pruneOnStart: true
                });
                if (store) {
                    this.sessionStore = store;
                    // Reconfigure session middleware with PostgreSQL store
                    const cookieSecure = process.env.SPECMEM_COOKIE_SECURE === 'true';
                    this.app.use(session({
                        store: this.sessionStore,
                        secret: this.config.sessionSecret,
                        resave: false,
                        saveUninitialized: false,
                        cookie: {
                            secure: cookieSecure,
                            httpOnly: true,
                            maxAge: 24 * 60 * 60 * 1000 // 24 hours
                        }
                    }));
                    logger.info('PostgreSQL session store initialized - no more memory leaks!');
                }
                else {
                    logger.warn('Using in-memory session store - sessions will not persist across restarts');
                }
            }
            catch (error) {
                logger.warn({ error }, 'Failed to initialize PostgreSQL session store - using in-memory store');
            }
        }
        else {
            logger.warn('Using in-memory session store - database not available');
        }
        // Try to get skill scanner
        try {
            this.skillScanner = getSkillScanner();
        }
        catch (error) {
            logger.warn('Skill scanner not available for dashboard');
        }
        // Try to get codebase indexer
        try {
            this.codebaseIndexer = getCodebaseIndexer();
        }
        catch (error) {
            logger.warn('Codebase indexer not available for dashboard');
        }
        // Try to get memory manager
        try {
            this.memoryManager = getMemoryManager();
            logger.info('Memory manager connected to dashboard');
        }
        catch (error) {
            logger.warn('Memory manager not available for dashboard');
        }
        // Initialize team member tracker, deployment, and history manager
        try {
            this.teamMemberTracker = getTeamMemberTracker();
            if (this.db) {
                this.teamMemberTracker.setDatabase(this.db.pool);
            }
            this.teamMemberDeployment = getTeamMemberDeployment();
            this.teamMemberHistoryManager = getTeamMemberHistoryManager();
            // Initialize Task team member logger
            if (this.db) {
                initializeTaskTeamMemberLogger(this.db);
                logger.info('Task team member logger initialized - Claude Code team members will be tracked');
            }
            if (this.db) {
                this.teamMemberHistoryManager.setDatabase(this.db.pool);
            }
            this.setupTeamMemberEventForwarding();
            logger.info('Team Member tracker, deployment, and history manager initialized');
        }
        catch (error) {
            logger.warn({ error }, 'Team Member tracker/deployment/history not available');
        }
        // BUG FIX (Team Member 2): Initialize dashboard communicator and discovery for SpecMem-based team members
        try {
            const dashboardTeamMemberId = `dashboard-${crypto.randomUUID().substring(0, 8)}`;
            this.dashboardCommunicator = createTeamMemberCommunicator(dashboardTeamMemberId);
            this.dashboardDiscovery = createTeamMemberDiscovery(dashboardTeamMemberId, 'dashboard', 'overseer', {
                heartbeatIntervalMs: 60000, // Dashboard heartbeats less frequently
                teamMemberExpiryMs: 120000 // 2 minute expiry for discovered team members
            });
            // Start discovery but don't block on it
            this.dashboardDiscovery.start().catch((err) => {
                logger.debug({ error: err }, 'Dashboard discovery start warning (non-critical)');
            });
            logger.info({ teamMemberId: dashboardTeamMemberId }, 'Dashboard communicator and discovery initialized');
        }
        catch (error) {
            logger.debug({ error }, 'Dashboard communicator/discovery not available (SpecMem may not be running)');
        }
        // Initialize Memory Recall API routes
        if (this.db) {
            try {
                const memoryRecallRouter = createMemoryRecallRouter(this.db);
                this.app.use('/api/memory', (req, res, next) => {
                    // Apply auth middleware to memory recall routes
                    const sess = req.session;
                    if (sess?.authenticated) {
                        next();
                    }
                    else {
                        res.status(401).json({ error: 'Authentication required' });
                    }
                }, memoryRecallRouter);
                logger.info('Memory Recall API routes initialized');
            }
            catch (error) {
                logger.warn({ error }, 'Failed to initialize Memory Recall API');
            }
            // Initialize Team Member History API routes
            try {
                const teamMemberHistoryRouter = createTeamMemberHistoryRouter(this.db);
                this.app.use('/api/teamMembers', (req, res, next) => {
                    // Apply auth middleware to team member history routes
                    const sess = req.session;
                    if (sess?.authenticated) {
                        next();
                    }
                    else {
                        res.status(401).json({ error: 'Authentication required' });
                    }
                }, teamMemberHistoryRouter);
                logger.info('Team Member History API routes initialized');
            }
            catch (error) {
                logger.warn({ error }, 'Failed to initialize Team Member History API');
            }
            // Initialize TeamMember Deploy API routes
            try {
                const teamMemberDeployRouter = createTeamMemberDeployRouter();
                this.app.use('/api/teamMembers', (req, res, next) => {
                    // Apply auth middleware to team member deploy routes
                    const sess = req.session;
                    if (sess?.authenticated) {
                        next();
                    }
                    else {
                        res.status(401).json({ error: 'Authentication required' });
                    }
                }, teamMemberDeployRouter);
                logger.info('Team Member Deploy API routes initialized');
            }
            catch (error) {
                logger.warn({ error }, 'Failed to initialize TeamMember Deploy API');
            }
        }
        // Initialize TeamMember Stream WebSocket
        try {
            this.teamMemberStreamManager = initializeTeamMemberStream(this.server, '/ws/team-members/live');
            logger.info('Team Member Stream WebSocket initialized');
        }
        catch (error) {
            logger.warn({ error }, 'Failed to initialize TeamMember Stream WebSocket');
        }
        // Auto-detect env file path for password persistence
        if (!this.envFilePath) {
            const envPaths = [
                path.join(process.cwd(), 'specmem.env'),
                path.join(process.cwd(), '.env'),
                path.join(__dirname, '../../specmem.env'),
                path.join(__dirname, '../../.env')
            ];
            for (const envPath of envPaths) {
                try {
                    await fs.access(envPath);
                    this.envFilePath = envPath;
                    logger.debug({ envPath }, 'Found env file for password persistence');
                    break;
                }
                catch (e) {
                    // File doesn't exist, try next - expected behavior
                    logger.debug({ envPath, error: e }, 'env file not found at this path, checking next');
                }
            }
        }
        const { maxPortAttempts, maxStartupRetries, retryDelayMs } = this.config;
        for (let portOffset = 0; portOffset < maxPortAttempts; portOffset++) {
            const port = this.config.port + portOffset;
            // Check port availability first
            const available = await isPortAvailable(port, this.config.host);
            if (!available) {
                logger.debug({ port, host: this.config.host }, 'Dashboard port already in use, trying next');
                continue;
            }
            // Try to start the server with retries
            for (let retry = 0; retry < maxStartupRetries; retry++) {
                try {
                    await this.startOnPort(port);
                    this.actualPort = port;
                    return; // Success!
                }
                catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    // Check if it's a port-in-use error (race condition)
                    if (error.message.includes('EADDRINUSE') || error.code === 'EADDRINUSE') {
                        logger.warn({ port }, 'Dashboard port became unavailable during startup, trying next');
                        break; // Try next port
                    }
                    logger.warn({
                        port,
                        retry: retry + 1,
                        maxRetries: maxStartupRetries,
                        error: error.message
                    }, 'Dashboard server startup failed, retrying');
                    // Wait before retry with exponential backoff
                    if (retry < maxStartupRetries - 1) {
                        await sleep(retryDelayMs * Math.pow(2, retry));
                    }
                }
            }
        }
        // All attempts failed
        const errorMsg = `Failed to start dashboard server on any port in range ${this.config.port}-${this.config.port + maxPortAttempts - 1}`;
        logger.error({ basePort: this.config.port, maxPortAttempts }, errorMsg);
        throw new Error(errorMsg);
    }
    /**
     * Internal method to start server on a specific port
     */
    startOnPort(port) {
        return new Promise((resolve, reject) => {
            // Set up error handler before listening to catch EADDRINUSE
            const errorHandler = (error) => {
                // Remove error handler to prevent memory leak
                this.server.removeListener('error', errorHandler);
                logger.error({ error, port }, 'Dashboard server error during startup');
                reject(error);
            };
            this.server.once('error', errorHandler);
            this.server.listen(port, this.config.host, () => {
                // Remove error handler on success
                this.server.removeListener('error', errorHandler);
                this.isRunning = true;
                this.startTime = Date.now();
                this.actualPort = port;
                // Set up server timeouts
                setServerTimeouts(this.server, {
                    keepAliveTimeout: parseInt(process.env['SPECMEM_KEEP_ALIVE_TIMEOUT'] || '5000', 10),
                    headersTimeout: parseInt(process.env['SPECMEM_HEADERS_TIMEOUT'] || '60000', 10),
                    requestTimeout: parseInt(process.env['SPECMEM_SERVER_REQUEST_TIMEOUT'] || '120000', 10)
                });
                // Set up persistent error handler for runtime errors
                this.server.on('error', (error) => {
                    logger.error({ error, port: this.actualPort }, 'Dashboard server runtime error');
                    // Don't crash - just log
                });
                logger.info({
                    port,
                    configuredPort: this.config.port,
                    host: this.config.host,
                    mode: this.config.mode,
                    url: `http://${this.config.host}:${port}`,
                    envFilePath: this.envFilePath || 'none'
                }, 'Dashboard server started - CSGO VIBES ACTIVATED');
                // Security warnings for public mode
                if (this.config.mode === 'public') {
                    logger.warn('========================================');
                    logger.warn('  SECURITY WARNING: PUBLIC MODE ACTIVE  ');
                    logger.warn('========================================');
                    logger.warn(`Dashboard is accessible on the network at ${this.config.host}:${port}`);
                    logger.warn('Ensure SPECMEM_DASHBOARD_PASSWORD is set to a strong password!');
                    logger.warn('Consider using a reverse proxy (nginx/caddy) with HTTPS for production.');
                    // Check for weak/default password
                    if (isUsingDefaultPassword()) {
                        logger.error('========================================');
                        logger.error('  CRITICAL: DEFAULT PASSWORD IN USE!   ');
                        logger.error('========================================');
                        logger.error('You are running in PUBLIC mode with the default password.');
                        logger.error('This is a MAJOR security risk! Anyone on your network can access the dashboard.');
                        logger.error('Set SPECMEM_DASHBOARD_PASSWORD to a strong, unique password immediately.');
                    }
                }
                else {
                    logger.info({ mode: 'private' }, 'Dashboard running in private mode (localhost only)');
                }
                resolve();
            });
        });
    }
    /**
     * Stop the server
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        // Close all WebSocket connections
        for (const client of this.connectedClients) {
            client.close(1001, 'Server shutting down');
        }
        this.connectedClients.clear();
        // Shutdown session store
        if (this.sessionStore) {
            await this.sessionStore.shutdown();
            this.sessionStore = null;
        }
        // Shutdown terminal stream manager
        if (this.terminalStreamManager) {
            this.terminalStreamManager.stop();
            this.terminalStreamManager = null;
        }
        // Shutdown team member stream manager and reset global singleton
        await shutdownTeamMemberStream();
        return new Promise((resolve) => {
            this.server.close(() => {
                this.isRunning = false;
                logger.info('Dashboard server stopped');
                resolve();
            });
        });
    }
    /**
     * Get server status
     */
    getStatus() {
        return {
            running: this.isRunning,
            port: this.actualPort || this.config.port,
            configuredPort: this.config.port,
            uptime: this.isRunning ? Date.now() - this.startTime : 0
        };
    }
    /**
     * Get the actual port the server is bound to
     */
    getActualPort() {
        return this.actualPort || this.config.port;
    }
    /**
     * Get current dashboard mode
     */
    getMode() {
        return this.config.mode;
    }
    /**
     * Get current host binding
     */
    getHost() {
        return this.config.host;
    }
    // ============================================================================
    // Config Persistence and Hot Reload
    // ============================================================================
    /**
     * RebindResult - Result of a server rebind operation
     */
    pendingRebind = false;
    /**
     * updateConfig - Update server configuration with optional rebind
     *
     * Some changes (mode, host, port) require rebinding the server.
     * Password changes can be applied without restart (hot reload).
     *
     * @param newConfig - Partial config to update
     * @returns Object indicating success and whether restart is needed
     */
    async updateConfig(newConfig) {
        const appliedChanges = [];
        let requiresRebind = false;
        // Detect changes that require rebind
        if (newConfig.mode !== undefined && newConfig.mode !== this.config.mode) {
            requiresRebind = true;
            appliedChanges.push(`mode: ${this.config.mode} -> ${newConfig.mode}`);
        }
        if (newConfig.host !== undefined && newConfig.host !== this.config.host) {
            requiresRebind = true;
            appliedChanges.push(`host: ${this.config.host} -> ${newConfig.host}`);
        }
        if (newConfig.port !== undefined && newConfig.port !== this.config.port) {
            requiresRebind = true;
            appliedChanges.push(`port: ${this.config.port} -> ${newConfig.port}`);
        }
        // Password can be hot-reloaded (it's checked on each login)
        if (newConfig.password !== undefined && newConfig.password !== this.config.password) {
            this.config.password = newConfig.password;
            appliedChanges.push('password: (updated)');
            logger.info('Dashboard password updated via hot reload');
        }
        // Session secret can be hot-reloaded but existing sessions will be invalidated
        if (newConfig.sessionSecret !== undefined && newConfig.sessionSecret !== this.config.sessionSecret) {
            this.config.sessionSecret = newConfig.sessionSecret;
            appliedChanges.push('sessionSecret: (updated - existing sessions invalidated)');
            logger.warn('Session secret changed - all existing sessions will be invalidated on next request');
        }
        if (!requiresRebind) {
            return {
                success: true,
                message: 'Configuration updated (hot reload)',
                requiresRebind: false,
                appliedChanges
            };
        }
        // Apply config changes that will take effect on rebind
        if (newConfig.mode !== undefined)
            this.config.mode = newConfig.mode;
        if (newConfig.host !== undefined)
            this.config.host = newConfig.host;
        if (newConfig.port !== undefined)
            this.config.port = newConfig.port;
        return {
            success: true,
            message: 'Configuration updated. Server rebind required to apply binding changes.',
            requiresRebind: true,
            appliedChanges
        };
    }
    /**
     * rebind - Gracefully rebind the server to a new host/port
     *
     * This performs a graceful restart:
     * 1. Mark server as stopping
     * 2. Stop accepting new connections
     * 3. Close existing WebSocket connections with notice
     * 4. Close HTTP server
     * 5. Restart with new configuration
     *
     * @param notifyClients - Whether to notify WebSocket clients before restart
     * @returns Promise<boolean> - true if rebind successful
     */
    async rebind(notifyClients = true) {
        if (this.pendingRebind) {
            return {
                success: false,
                message: 'Rebind already in progress',
                oldBinding: { host: this.config.host, port: this.actualPort },
                newBinding: { host: this.config.host, port: this.config.port }
            };
        }
        this.pendingRebind = true;
        const oldBinding = { host: this.config.host, port: this.actualPort };
        try {
            logger.info({
                oldHost: oldBinding.host,
                oldPort: oldBinding.port,
                newHost: this.config.host,
                newPort: this.config.port,
                mode: this.config.mode
            }, 'initiating graceful server rebind');
            // Notify WebSocket clients about impending restart
            if (notifyClients && this.connectedClients.size > 0) {
                const restartNotice = JSON.stringify({
                    type: 'server_restart',
                    message: 'Server is restarting to apply configuration changes',
                    reconnectIn: 3000
                });
                for (const client of this.connectedClients) {
                    try {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(restartNotice);
                        }
                    }
                    catch (err) {
                        // Ignore individual client errors
                    }
                }
                // Give clients time to receive the message
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            // Stop the server (closes connections)
            await this.stop();
            // Re-apply host based on mode
            if (this.config.mode === 'private') {
                this.config.host = '127.0.0.1';
            }
            else if (!this.config.host || this.config.host === '127.0.0.1') {
                this.config.host = '0.0.0.0';
            }
            // Create new HTTP server instance
            this.server = createServer(this.app);
            // Re-setup WebSocket server
            this.wss = new WebSocketServer({
                noServer: true,
                perMessageDeflate: false,
                clientTracking: true,
                maxPayload: 100 * 1024 * 1024
            });
            // Re-setup upgrade handler
            this.server.on('upgrade', (request, socket, head) => {
                const url = new URL(request.url || '/', `http://${request.headers.host}`);
                const pathname = url.pathname;
                if (pathname === '/ws/team-members/live') {
                    return;
                }
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.wss.emit('connection', ws, request);
                });
            });
            // Start on new binding
            await this.start();
            const newBinding = { host: this.config.host, port: this.actualPort };
            logger.info({
                oldBinding,
                newBinding,
                mode: this.config.mode
            }, 'server rebind completed successfully');
            return {
                success: true,
                message: `Server rebound from ${oldBinding.host}:${oldBinding.port} to ${newBinding.host}:${newBinding.port}`,
                oldBinding,
                newBinding
            };
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.error({ error, oldBinding }, 'server rebind failed - attempting rollback');
            // ROLLBACK: Try to restore server on old binding
            try {
                // Restore config to old values
                this.config.host = oldBinding.host;
                this.config.port = oldBinding.port;
                // Recreate server if needed
                if (!this.isRunning) {
                    this.server = createServer(this.app);
                    this.wss = new WebSocketServer({
                        noServer: true,
                        perMessageDeflate: false,
                        clientTracking: true,
                        maxPayload: 100 * 1024 * 1024
                    });
                    this.server.on('upgrade', (request, socket, head) => {
                        const url = new URL(request.url || '/', `http://${request.headers.host}`);
                        const pathname = url.pathname;
                        if (pathname === '/ws/team-members/live')
                            return;
                        this.wss.handleUpgrade(request, socket, head, (ws) => {
                            this.wss.emit('connection', ws, request);
                        });
                    });
                    await this.start();
                    logger.info({ oldBinding }, 'ROLLBACK SUCCESS: Server restored to previous binding');
                    return {
                        success: false,
                        message: `Rebind failed: ${error.message}. Server rolled back to ${oldBinding.host}:${oldBinding.port}`,
                        oldBinding,
                        newBinding: oldBinding,
                        rolledBack: true
                    };
                }
            }
            catch (rollbackErr) {
                const rollbackError = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
                logger.error({ error: rollbackError, oldBinding }, 'ROLLBACK FAILED: Server may be in inconsistent state');
                return {
                    success: false,
                    message: `Rebind failed: ${error.message}. Rollback also failed: ${rollbackError.message}. Manual restart required.`,
                    oldBinding,
                    newBinding: { host: this.config.host, port: this.config.port },
                    rollbackFailed: true
                };
            }
            return {
                success: false,
                message: `Rebind failed: ${error.message}`,
                oldBinding,
                newBinding: { host: this.config.host, port: this.config.port }
            };
        }
        finally {
            this.pendingRebind = false;
        }
    }
    /**
     * scheduleRebind - Schedule a rebind after a delay
     *
     * Useful for giving clients time to prepare for restart
     *
     * @param delayMs - Delay before rebind in milliseconds
     * @returns Promise resolving when rebind is complete
     */
    async scheduleRebind(delayMs = 2000) {
        logger.info({ delayMs }, 'scheduling server rebind');
        // Notify connected clients
        const scheduleNotice = JSON.stringify({
            type: 'server_restart_scheduled',
            message: `Server will restart in ${delayMs}ms to apply configuration changes`,
            restartTime: Date.now() + delayMs
        });
        for (const client of this.connectedClients) {
            try {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(scheduleNotice);
                }
            }
            catch {
                // Ignore
            }
        }
        // Wait for delay
        await new Promise(resolve => setTimeout(resolve, delayMs));
        // Perform rebind
        const result = await this.rebind(false); // Already notified
        return {
            success: result.success,
            message: result.message
        };
    }
    /**
     * reloadConfig - Reload configuration from environment/files
     *
     * Hot-reloads what can be reloaded without restart,
     * flags what requires restart
     */
    async reloadConfig() {
        const hotReloaded = [];
        const requiresRestart = [];
        // Password can be hot-reloaded (centralized password module handles this)
        const newPassword = getPassword();
        if (newPassword !== this.config.password) {
            this.config.password = newPassword;
            hotReloaded.push('password');
        }
        // Mode changes require restart
        const newMode = getDashboardMode();
        if (newMode !== this.config.mode) {
            requiresRestart.push(`mode: ${this.config.mode} -> ${newMode}`);
        }
        // Host changes require restart
        const newHost = getDashboardHost();
        if (newHost !== this.config.host) {
            requiresRestart.push(`host: ${this.config.host} -> ${newHost}`);
        }
        // Port changes require restart
        const newPort = parseInt(process.env['SPECMEM_DASHBOARD_PORT'] || '8585', 10);
        if (newPort !== this.config.port) {
            requiresRestart.push(`port: ${this.config.port} -> ${newPort}`);
        }
        logger.info({
            hotReloaded,
            requiresRestart
        }, 'config reload check completed');
        return {
            success: true,
            hotReloaded,
            requiresRestart
        };
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let globalDashboard = null;
/**
 * Get the global dashboard server
 */
export function getDashboardServer(config) {
    if (!globalDashboard) {
        globalDashboard = new DashboardWebServer(config);
    }
    return globalDashboard;
}
/**
 * Reset the global dashboard server (for testing)
 */
export async function resetDashboardServer() {
    if (globalDashboard) {
        await globalDashboard.stop();
        globalDashboard = null;
    }
}
//# sourceMappingURL=webServer.js.map