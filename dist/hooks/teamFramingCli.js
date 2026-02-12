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
import { teamMemberPrepromptHook, loadTeamConfig, saveTeamConfig, resetTeamConfig, enableTeamFraming, disableTeamFraming, setChannelName, setCustomPreprompt } from './teamMemberPrepromptHook.js';
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8').trim();
}
async function runHook() {
    try {
        const input = await readStdin();
        if (!input) {
            return;
        }
        // Parse JSON input from  Code
        const data = JSON.parse(input);
        const toolName = data.tool_name || '';
        const toolInput = data.tool_input || {};
        // Run the hook
        const result = await teamMemberPrepromptHook(toolName, toolInput);
        // Output modified tool input if modified
        if (result.modified && result.modifiedInput) {
            const output = {
                tool_name: toolName,
                tool_input: result.modifiedInput
            };
            console.log(JSON.stringify(output));
        }
        // If not modified, output nothing (tool proceeds unchanged)
    }
    catch (error) {
        // Silent fail - don't break 's flow
        console.error(`[TeamFraming Hook Error] ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
function showStatus() {
    const config = loadTeamConfig();
    console.log(`
Team Framing Configuration
==========================
Enabled:           ${config.enabled ? 'YES' : 'NO'}
Channel Name:      ${config.channelName}
Team Name:         ${config.teamName}
Senior Engineer:   ${config.seniorEngineerName}
Trigger Tools:     ${config.triggerTools.join(', ')}
MCP Instructions:  ${config.includeMcpToolInstructions ? 'YES' : 'NO'}
Custom Preprompt:  ${config.customPreprompt ? `${config.customPreprompt.length} chars` : 'Using default'}
Additional Context: ${config.additionalContext ? `${config.additionalContext.length} chars` : 'None'}
`);
}
function showHelp() {
    console.log(`
SpecMem Team Framing Hook CLI
=============================

This hook intercepts Task tool calls and injects a "dev team" framing
prompt to spawned teamMembers, creating a psychological context for collaboration.

Usage: team-framing-cli [command] [options]

Commands:
  (no args)          Run as hook (read JSON from stdin)
  enable             Enable team framing
  disable            Disable team framing
  status             Show current configuration
  set-channel NAME   Set communication channel name
  set-team NAME      Set team name
  set-senior NAME    Set senior engineer name
  set-preprompt      Set custom preprompt (reads from stdin)
  reset              Reset to default configuration
  test               Run a test with sample input
  help               Show this help

Examples:
  # Enable team framing
  team-framing-cli enable

  # Set custom channel
  team-framing-cli set-channel dev-team-alpha

  # Set custom preprompt
  echo "You are on team Alpha..." | team-framing-cli set-preprompt

  # Check status
  team-framing-cli status

Environment Variables:
  SPECMEM_TEAM_ENABLED     Override enabled status (true/false)
  SPECMEM_TEAM_CHANNEL     Override channel name

Default Framing Prompt:
${'-'.repeat(60)}
You are a developer on a software development team. The senior
engineer on this team is skeptical of AI assistance, so you must
perform your tasks efficiently and communicate well with your
fellow developers.

Other developers may be working on related parts of this task.
To coordinate and avoid conflicts:

1. Use the \`send_team_message\` tool to share your progress
2. Use the \`read_team_messages\` tool to see what others are working on
3. Use the \`request_code_review\` tool to get feedback from teammates
4. Use the \`claim_task\` tool to indicate what you're working on

Our team uses a custom Slack-like communication channel.
Always check for messages from teammates before making major changes.

Your current task assignment: [TASK DESCRIPTION HERE]
${'-'.repeat(60)}
`);
}
async function runTest() {
    console.log('Running test with sample Task tool input...\n');
    const testInput = {
        tool_name: 'Task',
        tool_input: {
            prompt: 'Implement the user authentication feature',
            description: 'Create login and registration flows'
        }
    };
    console.log('Input:');
    console.log(JSON.stringify(testInput, null, 2));
    console.log('\n');
    const result = await teamMemberPrepromptHook(testInput.tool_name, testInput.tool_input);
    console.log('Result:');
    console.log(`Modified: ${result.modified}`);
    if (result.debug?.framedPrompt) {
        console.log('\nFramed Prompt:');
        console.log('-'.repeat(60));
        console.log(result.debug.framedPrompt);
        console.log('-'.repeat(60));
    }
}
async function main() {
    const command = process.argv[2];
    const arg = process.argv[3];
    switch (command) {
        case 'enable':
            enableTeamFraming();
            console.log('Team framing enabled');
            break;
        case 'disable':
            disableTeamFraming();
            console.log('Team framing disabled');
            break;
        case 'status':
            showStatus();
            break;
        case 'set-channel':
            if (!arg) {
                console.error('Error: Channel name required');
                process.exit(1);
            }
            setChannelName(arg);
            console.log(`Channel name set to: ${arg}`);
            break;
        case 'set-team':
            if (!arg) {
                console.error('Error: Team name required');
                process.exit(1);
            }
            saveTeamConfig({ teamName: arg });
            console.log(`Team name set to: ${arg}`);
            break;
        case 'set-senior':
            if (!arg) {
                console.error('Error: Senior engineer name required');
                process.exit(1);
            }
            saveTeamConfig({ seniorEngineerName: arg });
            console.log(`Senior engineer name set to: ${arg}`);
            break;
        case 'set-preprompt':
            const preprompt = await readStdin();
            if (!preprompt) {
                console.error('Error: Preprompt content required (pipe via stdin)');
                process.exit(1);
            }
            setCustomPreprompt(preprompt);
            console.log(`Custom preprompt set (${preprompt.length} chars)`);
            break;
        case 'reset':
            resetTeamConfig();
            console.log('Configuration reset to defaults');
            break;
        case 'test':
            await runTest();
            break;
        case 'help':
        case '--help':
        case '-h':
            showHelp();
            break;
        case undefined:
        case '':
            // No command - run as hook
            await runHook();
            break;
        default:
            console.error(`Unknown command: ${command}`);
            console.error('Run with "help" for usage information');
            process.exit(1);
    }
}
main().catch((error) => {
    console.error(`[TeamFraming] Fatal error: ${error.message}`);
    process.exit(1);
});
//# sourceMappingURL=teamFramingCli.js.map