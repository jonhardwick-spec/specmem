#!/usr/bin/env node
/**
 * SPECMEM TEAM FRAMING CLI
 * ========================
 *
 * CLI entry point for the Team Member Preprompt Hook.
 * This allows the hook to be called directly from  Code settings.
 *
 * Usage in ~/.claude/settings.json:
 *
 * For all tools (general PreToolUse hook):
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       {
 *         "matcher": "*",
 *         "hooks": [
 *           {
 *             "type": "command",
 *             "command": "node /path/to/specmem/dist/hooks/teamFramingCli.js"
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * }
 *
 * Or for targeted Task tool interception only:
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       {
 *         "matcher": "Task",
 *         "hooks": [
 *           {
 *             "type": "command",
 *             "command": "node /path/to/specmem/dist/hooks/teamFramingCli.js"
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * }
 *
 * CLI Commands:
 *   (no args)          Run as hook (read from stdin)
 *   enable             Enable team framing
 *   disable            Disable team framing
 *   status             Show current configuration
 *   set-channel NAME   Set communication channel name
 *   set-preprompt      Set custom preprompt (reads from stdin)
 *   reset              Reset to default configuration
 *   help               Show help
 */
export {};
//# sourceMappingURL=teamFramingCli.d.ts.map