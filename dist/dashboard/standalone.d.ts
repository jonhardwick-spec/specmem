/**
 * Standalone Dashboard Server Entry Point
 *
 * This file is the entry point for running the SpecMem dashboard as a standalone process.
 * Can be run directly with Node.js when running the dashboard separately from the main MCP server.
 *
 * Usage: node dist/dashboard/standalone.js
 *        scripts/dashboard-standalone.sh           (foreground mode)
 *        scripts/dashboard-standalone.sh -d        (daemon mode)
 *
 * Features:
 * - NO PM2 DEPENDENCY - uses native Node.js process management
 * - Project-scoped ports via portAllocator (based on SPECMEM_PROJECT_PATH)
 * - Simple daemon mode with nohup + PID file (via shell script)
 * - Graceful shutdown on SIGTERM/SIGINT
 *
 * Environment Variables (loaded automatically from .env file):
 *   SPECMEM_PROJECT_PATH - Project path for per-project isolation (default: cwd)
 *   SPECMEM_DASHBOARD_PORT - Port to listen on (default: auto-allocated per-project)
 *   SPECMEM_DASHBOARD_HOST - Host to bind to (default: 127.0.0.1)
 *   SPECMEM_PASSWORD - Login password for dashboard
 *   SPECMEM_DASHBOARD_PASSWORD - Alternate password config (fallback)
 *   SPECMEM_COORDINATION_PORT - Coordination server port (default: auto-allocated per-project)
 *   SPECMEM_DASHBOARD_MAX_RETRIES - Max startup retries (default: 3)
 */
export {};
//# sourceMappingURL=standalone.d.ts.map