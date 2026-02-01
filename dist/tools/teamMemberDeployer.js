/**
 * Team Member Deployer Tool
 *
 * "Skidded" version of Claude Code's Task tool that actually works with MCP
 * Spawns team members with full SpecMem MCP access
 *
 * Now integrates with TeamCommsService for team-based team member coordination:
 * - Auto-creates team channels for spawned team members
 * - Injects team member IDs and communication context
 * - Adds team communication tools
 * - Handles completion notifications and task cleanup
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { getSpecmemRoot } from '../config.js';
import { getProjectEnvOnly } from '../utils/projectEnv.js';
import { safeKillScreenSession, } from '../utils/safeProcessTermination.js';
import { getTeamCommsService, } from '../team-members/teamCommsService.js';
import { ClearTeamMessages } from '../mcp/tools/teamComms.js';
import { getAgentsJson, isValidAgentType } from './agentDefinitions.js';
/**
 * Deploy a team member with full SpecMem MCP access
 *
 * This is basically the Task tool but it actually fucking works
 * because we spawn team members with MCP configured
 *
 * Now with team communication support for coordinated multi-team-member work
 */
export async function deployTeamMember(args) {
    const { teamMemberId, teamMemberName, teamMemberType, model, prompt, background = true, parentTaskId, enableTeamComms = !!parentTaskId, nativeAgentType, } = args;
    // Build native agent flags if specified (Claude 2.1.19+)
    let agentFlags = '';
    if (nativeAgentType && isValidAgentType(nativeAgentType)) {
        const agentsJson = getAgentsJson().replace(/'/g, "'\\''"); // Escape for bash
        agentFlags = `--agents '${agentsJson}' --agent ${nativeAgentType}`;
    }
    let teamSpawnResult;
    let finalPrompt = prompt;
    try {
        // =========================================================================
        // AUTO-CLEAR: Wipe team messages before deploying new agents
        // This ensures agents start fresh without old noise/context
        // =========================================================================
        try {
            const clearTool = new ClearTeamMessages();
            await clearTool.execute({ confirm: true, clear_claims: true, clear_help_requests: true });
            logger.info({ teamMemberId }, '[TeamMemberDeployer] Cleared team messages before deploy');
        }
        catch (clearError) {
            // Non-fatal - continue deployment even if clear fails
            logger.warn({ error: clearError, teamMemberId }, '[TeamMemberDeployer] Failed to clear team messages (non-fatal)');
        }
        // =========================================================================
        // Team Communication Setup (if enabled)
        // =========================================================================
        if (enableTeamComms && parentTaskId) {
            try {
                const teamComms = getTeamCommsService();
                teamSpawnResult = await teamComms.prepareTeamMemberSpawn({
                    parentTaskId,
                    name: teamMemberName,
                    prompt,
                    metadata: {
                        teamMemberId,
                        teamMemberType,
                        model,
                    },
                });
                // Use enhanced prompt with team context
                finalPrompt = teamSpawnResult.enhancedPrompt;
                logger.info({
                    teamMemberId,
                    teamCommsMemberId: teamSpawnResult.memberId,
                    channelId: teamSpawnResult.channelId,
                }, '[TeamMemberDeployer] Team communication context injected');
            }
            catch (teamError) {
                logger.warn({ error: teamError, teamMemberId }, '[TeamMemberDeployer] Team comms setup failed, continuing without');
                // Continue without team features if setup fails
            }
        }
        // Create team member workspace
        const teamMemberDir = join(getSpecmemRoot(), 'data', 'team-members', teamMemberId);
        mkdirSync(teamMemberDir, { recursive: true });
        // Get project environment to pass to team member
        const projectEnv = getProjectEnvOnly();
        // Create MCP config for this team member
        // CRITICAL: Pass project environment so team member shares the same project context
        const mcpConfig = {
            mcpServers: {
                specmem: {
                    command: 'node',
                    args: [join(getSpecmemRoot(), 'dist', 'index.js')],
                    env: {
                        // Project isolation - team member inherits parent's project path
                        ...projectEnv,
                        // Database configuration
                        SPECMEM_DB_HOST: process.env.SPECMEM_DB_HOST || 'localhost',
                        SPECMEM_DB_PORT: process.env.SPECMEM_DB_PORT || '5432',
                        SPECMEM_DB_NAME: process.env.SPECMEM_DB_NAME || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
                        SPECMEM_DB_USER: process.env.SPECMEM_DB_USER || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
                        SPECMEM_DB_PASSWORD: process.env.SPECMEM_DB_PASSWORD || process.env['SPECMEM_PASSWORD'] || 'specmem_westayunprofessional',
                        NODE_ENV: 'production'
                    }
                }
            }
        };
        const mcpConfigPath = join(teamMemberDir, 'mcp-config.json');
        writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
        // Create settings.json with bypass permissions for auto-approval
        const settingsConfig = {
            permissions: {
                allow: ['*'],
                deny: [],
                ask: [],
                defaultMode: 'acceptEdits'
            },
            defaultMode: 'acceptEdits',
            model: model,
            alwaysThinkingEnabled: false,
            hooks: {},
            mcpServers: mcpConfig.mcpServers
        };
        const settingsPath = join(teamMemberDir, 'settings.json');
        writeFileSync(settingsPath, JSON.stringify(settingsConfig, null, 2));
        // Create team member prompt file (use enhanced prompt with team context if available)
        const promptPath = join(teamMemberDir, 'prompt.txt');
        writeFileSync(promptPath, finalPrompt);
        // If team comms enabled, save team member info for tracking
        if (teamSpawnResult) {
            const teamInfoPath = join(teamMemberDir, 'team-info.json');
            writeFileSync(teamInfoPath, JSON.stringify({
                memberId: teamSpawnResult.memberId,
                channelId: teamSpawnResult.channelId,
                parentTaskId,
                spawnedAt: new Date().toISOString(),
            }, null, 2));
        }
        // Map model names to Claude API model IDs
        const modelMap = {
            haiku: 'claude-3-5-haiku-20241022',
            sonnet: 'claude-sonnet-4-5-20250929',
            opus: 'claude-opus-4-5-20251101'
        };
        const modelId = modelMap[model];
        if (background) {
            // Spawn in screen session so it persists
            const screenName = `team-member-${teamMemberId}`;
            // Create a startup script with permission monitor
            // The monitor auto-accepts WebFetch/tool permission prompts in screen
            const startupScript = `#!/bin/bash
cd ${getSpecmemRoot()}
echo "=== TEAM_MEMBER ${teamMemberId} (${teamMemberName}) ==="
echo "Model: ${modelId}"
echo "Type: ${teamMemberType}"
echo "MCP Config: ${mcpConfigPath}"
echo ""

# Start permission monitor in background
bash ${join(getSpecmemRoot(), 'team-member-permission-monitor.sh')} "team-member-${teamMemberId}" 600 > "${teamMemberDir}/monitor.log" 2>&1 &
MONITOR_PID=$!
echo "Permission monitor started (PID: $MONITOR_PID)"

# Run team member and capture output
cat "${promptPath}" | claude --print --model ${modelId} ${agentFlags} --mcp-config "${mcpConfigPath}" --setting-sources user 2>&1 | tee "${teamMemberDir}/output.log"
TEAM_MEMBER_EXIT=$\{PIPESTATUS[1]}

# Kill monitor
kill $MONITOR_PID 2>/dev/null || true

echo ""
echo "=== TEAM_MEMBER ${teamMemberId} COMPLETED (exit: $TEAM_MEMBER_EXIT) ==="
exit $TEAM_MEMBER_EXIT
`;
            const scriptPath = join(teamMemberDir, 'start.sh');
            writeFileSync(scriptPath, startupScript);
            execSync(`chmod +x "${scriptPath}"`);
            // Launch in detached screen session with proper error checking
            // yooo this was silently swallowing errors fr fr, fixed now
            try {
                execSync(`screen -dmS "${screenName}" bash "${scriptPath}"`, {
                    encoding: 'utf-8',
                    timeout: 10000
                });
            }
            catch (screenError) {
                const errorMsg = screenError instanceof Error ? screenError.message : 'screen command failed';
                logger.error({ error: screenError, screenName, scriptPath }, '[TeamMemberDeployer] screen -dmS failed');
                return {
                    success: false,
                    teamMemberId,
                    teamMemberName,
                    message: `Screen launch failed: ${errorMsg}`
                };
            }
            // Verify screen session actually started - dont trust blind success
            // screen -dmS can return 0 even if session creation failed sometimes
            try {
                const screenCheck = execSync(`screen -ls | grep "${screenName}" || echo ""`, {
                    encoding: 'utf-8',
                    timeout: 5000
                }).toString();
                if (!screenCheck.includes(screenName)) {
                    logger.error({ screenName }, '[TeamMemberDeployer] screen session not found after launch - silent failure');
                    return {
                        success: false,
                        teamMemberId,
                        teamMemberName,
                        message: `Screen session "${screenName}" failed to start - session not found after launch`
                    };
                }
            }
            catch (verifyError) {
                logger.warn({ error: verifyError, screenName }, '[TeamMemberDeployer] Could not verify screen session (non-fatal)');
                // Continue anyway since screen might just be slow to register
            }
            // Update team member status to 'working' now that team member is running
            if (teamSpawnResult) {
                try {
                    const teamComms = getTeamCommsService();
                    await teamComms.updateMemberStatus(teamSpawnResult.memberId, 'working');
                }
                catch (statusError) {
                    logger.warn({ error: statusError }, '[TeamMemberDeployer] Failed to update team member status');
                }
            }
            logger.info({
                teamMemberId,
                teamMemberName,
                teamMemberType,
                model,
                screenSession: screenName,
                teamCommsMemberId: teamSpawnResult?.memberId,
                teamChannelId: teamSpawnResult?.channelId,
            }, 'team member deployed in background');
            return {
                success: true,
                teamMemberId,
                teamMemberName,
                screenSession: screenName,
                message: `TeamMember ${teamMemberId} deployed in screen session '${screenName}' with SpecMem MCP access` +
                    (teamSpawnResult ? ` (Team Member: ${teamSpawnResult.memberId}, Channel: ${teamSpawnResult.channelId})` : ''),
                teamCommsMemberId: teamSpawnResult?.memberId,
                teamChannelId: teamSpawnResult?.channelId,
            };
        }
        else {
            // Run synchronously (blocking)
            // Note: Synchronous mode doesn't support permission monitoring
            // Use background: true for team members that need WebFetch/web tools
            // Update team member status for sync run
            if (teamSpawnResult) {
                try {
                    const teamComms = getTeamCommsService();
                    await teamComms.updateMemberStatus(teamSpawnResult.memberId, 'working');
                }
                catch (statusError) {
                    logger.warn({ error: statusError }, '[TeamMemberDeployer] Failed to update team member status');
                }
            }
            // Timeout for synchronous team member tasks - configurable via SPECMEM_TEAM_MEMBER_SYNC_TIMEOUT_MS
            const syncTimeout = parseInt(process.env['SPECMEM_TEAM_MEMBER_SYNC_TIMEOUT_MS'] || '60000', 10);
            const result = execSync(`cat "${promptPath}" | claude --print --model ${modelId} --mcp-config "${mcpConfigPath}" --setting-sources user`, {
                cwd: '/server',
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024, // 10MB
                timeout: syncTimeout
            });
            // Handle completion for sync mode
            if (teamSpawnResult) {
                try {
                    const teamComms = getTeamCommsService();
                    await teamComms.handleMemberCompletion(teamSpawnResult.memberId, {
                        success: true,
                        message: 'Synchronous task completed',
                    });
                }
                catch (completionError) {
                    logger.warn({ error: completionError }, '[TeamMemberDeployer] Failed to handle team member completion');
                }
            }
            return {
                success: true,
                teamMemberId,
                teamMemberName,
                message: result,
                teamCommsMemberId: teamSpawnResult?.memberId,
                teamChannelId: teamSpawnResult?.channelId,
            };
        }
    }
    catch (error) {
        // Handle failure for team member
        if (teamSpawnResult) {
            try {
                const teamComms = getTeamCommsService();
                await teamComms.handleMemberCompletion(teamSpawnResult.memberId, {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
            catch (completionError) {
                logger.warn({ error: completionError }, '[TeamMemberDeployer] Failed to handle team member failure');
            }
        }
        logger.error({ error, teamMemberId }, 'team member deployment failed');
        return {
            success: false,
            teamMemberId,
            teamMemberName,
            message: error instanceof Error ? error.message : 'Unknown deployment error',
            teamCommsMemberId: teamSpawnResult?.memberId,
            teamChannelId: teamSpawnResult?.channelId,
        };
    }
}
/**
 * Get output from a running teamMember
 */
export async function getTeamMemberOutput(teamMemberId, lines = 100) {
    try {
        const logPath = `/server/data/team-members/${teamMemberId}/output.log`;
        const result = execSync(`tail -n ${lines} "${logPath}" 2>/dev/null || echo "No output yet"`);
        return result.toString();
    }
    catch (error) {
        return 'Error reading team member output';
    }
}
/**
 * Get detailed team member status
 */
export async function getTeamMemberStatus(teamMemberId) {
    try {
        const teamMemberDir = `/server/data/team-members/${teamMemberId}`;
        const screenName = `team-member-${teamMemberId}`;
        // Check if screen session exists
        const screenCheck = execSync(`screen -ls | grep "${screenName}" || echo ""`).toString();
        const running = screenCheck.includes(screenName);
        const status = {
            running,
            screenSession: running ? screenName : undefined
        };
        // Get recent output
        try {
            status.output = execSync(`tail -n 50 "${teamMemberDir}/output.log" 2>/dev/null || echo "No output"`).toString();
        }
        catch { }
        // Get monitor log
        try {
            status.monitorLog = execSync(`tail -n 20 "${teamMemberDir}/monitor.log" 2>/dev/null || echo "No monitor log"`).toString();
        }
        catch { }
        // Get prompt
        try {
            status.promptFile = execSync(`cat "${teamMemberDir}/prompt.txt" 2>/dev/null || echo "No prompt"`).toString();
        }
        catch { }
        // Get start time from screen if running
        if (running) {
            try {
                const screenInfo = execSync(`screen -ls | grep "${screenName}"`).toString();
                const match = screenInfo.match(/\((\d+\/\d+\/\d+ \d+:\d+:\d+)\)/);
                if (match) {
                    status.startTime = match[1];
                }
            }
            catch { }
        }
        return status;
    }
    catch (error) {
        return { running: false };
    }
}
/**
 * List all running team members with details
 */
export async function listRunningTeamMembers() {
    try {
        const screenList = execSync('screen -ls 2>/dev/null || echo ""').toString();
        const teamMemberLines = screenList.split('\n').filter(line => line.includes('team-member-'));
        return teamMemberLines.map(line => {
            const match = line.match(/(\d+)\.teamMember-([^\s]+)\s+\(([^)]+)\)/);
            if (!match)
                return null;
            const [, pid, teamMemberId, timeStr] = match;
            const teamMemberDir = `/server/data/team-members/${teamMemberId}`;
            // Check if output.log exists and has content
            let hasOutput = false;
            try {
                const stat = execSync(`stat -c %s "${teamMemberDir}/output.log" 2>/dev/null || echo 0`).toString().trim();
                hasOutput = parseInt(stat) > 0;
            }
            catch { }
            return {
                teamMemberId,
                screenSession: `team-member-${teamMemberId}`,
                startTime: timeStr,
                hasOutput
            };
        }).filter(Boolean);
    }
    catch (error) {
        return [];
    }
}
/**
 * Intervene in a running team member by sending input to its screen session
 */
export async function interveneTeamMember(teamMemberId, input) {
    try {
        const screenName = `team-member-${teamMemberId}`;
        // Check if screen exists
        const screenCheck = execSync(`screen -ls | grep "${screenName}" || echo ""`).toString();
        if (!screenCheck.includes(screenName)) {
            return {
                success: false,
                message: `TeamMember ${teamMemberId} is not running`
            };
        }
        // Send input to screen with proper error handling
        try {
            execSync(`screen -S "${screenName}" -X stuff ${JSON.stringify(input + '\n')}`, {
                encoding: 'utf-8',
                timeout: 5000
            });
        }
        catch (stuffError) {
            const errorMsg = stuffError instanceof Error ? stuffError.message : 'screen stuff command failed';
            logger.error({ error: stuffError, teamMemberId, screenName }, '[TeamMemberDeployer] screen -X stuff failed');
            return {
                success: false,
                message: `Failed to send input: ${errorMsg}`
            };
        }
        logger.info({ teamMemberId, input }, 'sent input to team member');
        return {
            success: true,
            message: `Sent input to team member ${teamMemberId}`
        };
    }
    catch (error) {
        logger.error({ error, teamMemberId }, 'failed to intervene in team member');
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
/**
 * Get screen hardcopy (current screen contents) for a team member
 */
export async function getTeamMemberScreen(teamMemberId) {
    const screenName = `team-member-${teamMemberId}`;
    const tmpFile = `/tmp/team-member-screen-${teamMemberId}-${Date.now()}.txt`;
    // First check if screen session exists
    try {
        const screenCheck = execSync(`screen -ls | grep "${screenName}" || echo ""`, {
            encoding: 'utf-8',
            timeout: 5000
        }).toString();
        if (!screenCheck.includes(screenName)) {
            logger.warn({ teamMemberId, screenName }, '[TeamMemberDeployer] getTeamMemberScreen - session not found');
            return `Error: Screen session "${screenName}" not found - team member may not be running`;
        }
    }
    catch (checkError) {
        const errorMsg = checkError instanceof Error ? checkError.message : 'check failed';
        logger.error({ error: checkError, teamMemberId }, '[TeamMemberDeployer] getTeamMemberScreen - screen -ls failed');
        return `Error checking screen session: ${errorMsg}`;
    }
    // Take hardcopy
    try {
        execSync(`screen -S "${screenName}" -X hardcopy "${tmpFile}"`, {
            encoding: 'utf-8',
            timeout: 5000
        });
    }
    catch (hardcopyError) {
        const errorMsg = hardcopyError instanceof Error ? hardcopyError.message : 'hardcopy failed';
        logger.error({ error: hardcopyError, teamMemberId, screenName }, '[TeamMemberDeployer] screen hardcopy failed');
        return `Error taking screen hardcopy: ${errorMsg}`;
    }
    // Read and cleanup
    try {
        const contents = execSync(`cat "${tmpFile}" && rm "${tmpFile}"`, {
            encoding: 'utf-8',
            timeout: 5000
        }).toString();
        return contents || 'Screen is empty';
    }
    catch (readError) {
        // Try to clean up temp file even if read failed
        try {
            execSync(`rm -f "${tmpFile}"`);
        }
        catch { }
        const errorMsg = readError instanceof Error ? readError.message : 'read failed';
        logger.error({ error: readError, tmpFile }, '[TeamMemberDeployer] Failed to read hardcopy file');
        return `Error reading screen contents: ${errorMsg}`;
    }
}
/**
 * Kill a team member
 *
 * SAFETY: Uses safeKillScreenSession which verifies ownership before killing.
 * Legacy team-member-* sessions are allowed for backwards compatibility.
 */
export async function killTeamMember(teamMemberId) {
    try {
        // Check for team member info and handle completion
        const teamMemberDir = `/server/data/team-members/${teamMemberId}`;
        const teamInfoPath = join(teamMemberDir, 'team-info.json');
        if (existsSync(teamInfoPath)) {
            try {
                const teamInfo = JSON.parse(execSync(`cat "${teamInfoPath}"`).toString());
                if (teamInfo.memberId) {
                    const teamComms = getTeamCommsService();
                    await teamComms.handleMemberCompletion(teamInfo.memberId, {
                        success: false,
                        error: 'Team Member was killed',
                    });
                }
            }
            catch (teamError) {
                logger.warn({ error: teamError, teamMemberId }, '[TeamMemberDeployer] Failed to handle team member on kill');
            }
        }
        // Use safe kill with ownership verification
        // Legacy session names (team-member-*) are allowed for backwards compatibility
        const sessionName = `team-member-${teamMemberId}`;
        const result = safeKillScreenSession(sessionName);
        if (result.success) {
            logger.info({ teamMemberId, sessionName }, 'team member killed');
            return true;
        }
        else {
            logger.error({ teamMemberId, error: result.error }, 'failed to kill team member - ownership check failed');
            return false;
        }
    }
    catch (error) {
        logger.error({ error, teamMemberId }, 'failed to kill team member');
        return false;
    }
}
/**
 * Notify team member completion for a background team member
 * Call this when monitoring detects the team member has finished
 */
export async function notifyTeamMemberCompletion(teamMemberId, success, message) {
    try {
        const teamMemberDir = `/server/data/team-members/${teamMemberId}`;
        const teamInfoPath = join(teamMemberDir, 'team-info.json');
        if (!existsSync(teamInfoPath)) {
            logger.debug({ teamMemberId }, '[TeamMemberDeployer] No team info found for completion');
            return false;
        }
        const teamInfo = JSON.parse(execSync(`cat "${teamInfoPath}"`).toString());
        if (!teamInfo.memberId) {
            return false;
        }
        const teamComms = getTeamCommsService();
        await teamComms.handleMemberCompletion(teamInfo.memberId, {
            success,
            message: success ? message || 'Task completed' : undefined,
            error: !success ? message || 'Task failed' : undefined,
        });
        logger.info({ teamMemberId, teamCommsMemberId: teamInfo.memberId, success }, '[TeamMemberDeployer] Team member completion notified');
        return true;
    }
    catch (error) {
        logger.error({ error, teamMemberId }, '[TeamMemberDeployer] Failed to notify team member completion');
        return false;
    }
}
/**
 * Get team member info for a team member
 */
export async function getTeamMemberTeamInfo(teamMemberId) {
    try {
        const teamMemberDir = `/server/data/team-members/${teamMemberId}`;
        const teamInfoPath = join(teamMemberDir, 'team-info.json');
        if (!existsSync(teamInfoPath)) {
            return null;
        }
        return JSON.parse(execSync(`cat "${teamInfoPath}"`).toString());
    }
    catch (error) {
        return null;
    }
}
/**
 * Spawn a team member with full team communication setup
 * This is a convenience wrapper around deployTeamMember for team-based work
 */
export async function spawnTeamMember(config) {
    const teamMemberId = `team-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    return deployTeamMember({
        teamMemberId,
        teamMemberName: config.name,
        teamMemberType: config.teamMemberType || 'worker',
        model: config.model || 'sonnet',
        prompt: config.prompt,
        background: true,
        parentTaskId: config.parentTaskId,
        enableTeamComms: true,
    });
}
//# sourceMappingURL=teamMemberDeployer.js.map