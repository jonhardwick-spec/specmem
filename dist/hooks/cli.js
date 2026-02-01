#!/usr/bin/env node
/**
 * SPECMEM HOOKS CLI
 * =================
 *
 * CLI entry point for SpecMem hooks.
 * This allows hooks to be called from  Code settings.
 *
 * Usage in ~/.claude/settings.json:
 * {
 *   "hooks": {
 *     "UserPromptSubmit": {
 *       "command": "npx specmem-hook"
 *     }
 *   }
 * }
 *
 * Or if installed globally:
 * {
 *   "hooks": {
 *     "UserPromptSubmit": {
 *       "command": "specmem-hook"
 *     }
 *   }
 * }
 */
import { contextInjectionHook } from './contextInjectionHook.js';
import { startDrilldown, getFinalContext, DRILLDOWN_DEPTHS } from './drilldownHook.js';
async function main() {
    // Read input from stdin
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
        input += chunk;
    }
    // Determine hook mode from args
    const mode = process.argv[2] || 'context';
    // Parse input - could be JSON or plain text
    let prompt = '';
    let sessionId = `hook_${Date.now()}`;
    try {
        const data = JSON.parse(input);
        prompt = data.prompt || data.message || data.content || '';
        sessionId = data.sessionId || sessionId;
    }
    catch {
        prompt = input.trim();
    }
    // Skip if prompt too short
    if (!prompt || prompt.length < 5) {
        process.exit(0);
    }
    try {
        switch (mode) {
            case 'context':
                // Default mode: inject context
                const context = await contextInjectionHook(prompt);
                if (context) {
                    console.log(context);
                }
                break;
            case 'drilldown':
                // Interactive drilldown mode
                const depth = process.argv[3] || 'standard';
                if (!DRILLDOWN_DEPTHS[depth]) {
                    console.error(`Invalid depth: ${depth}. Use: light, standard, deep, exhaustive`);
                    process.exit(1);
                }
                const state = await startDrilldown(sessionId, prompt, depth);
                const drillContext = getFinalContext(sessionId);
                console.log(drillContext);
                break;
            case 'help':
                console.log(`
SpecMem Hooks CLI
=================

Usage: specmem-hook [mode] [options]

Modes:
  context     (default) Inject related SpecMem context into prompt
  drilldown   Start interactive drilldown session
  help        Show this help

Drilldown depths:
  light       10 memories, 0.4 threshold, 50MB RAM
  standard    20 memories, 0.3 threshold, 100MB RAM
  deep        50 memories, 0.2 threshold, 150MB RAM
  exhaustive  100 memories, 0.1 threshold, 150MB RAM

Environment variables:
  SPECMEM_DB_HOST       Database host (default: localhost)
  SPECMEM_DB_PORT       Database port (default: 5432)
  SPECMEM_DB_NAME       Database name (default: specmem)
  SPECMEM_DB_USER       Database user (default: specmem)
  SPECMEM_DB_PASSWORD   Database password (default: specmem)
  SPECMEM_CONFIG_PATH   Path to config file (default: ~/.specmem/config.json)
  SPECMEM_CONTEXT_HOOK  Enable/disable hook (default: true)
  SPECMEM_COMPRESS      Enable Chinese Compactor (default: true)

Examples:
  echo "how does auth work" | specmem-hook
  echo "explain the database schema" | specmem-hook drilldown deep
        `);
                break;
            default:
                console.error(`Unknown mode: ${mode}`);
                process.exit(1);
        }
    }
    catch (error) {
        // Silent fail - don't break the prompt
        console.error(`[SpecMem Hook Error] ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(0);
    }
}
main().catch(() => process.exit(0));
//# sourceMappingURL=cli.js.map