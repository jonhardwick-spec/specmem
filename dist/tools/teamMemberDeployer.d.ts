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
export type NativeAgentType = 'explorer' | 'bug-hunter' | 'researcher' | 'feature-dev' | 'fixer' | 'refactor' | 'test-writer' | 'qa' | 'overseer' | 'architect';
interface DeployTeamMemberArgs {
    teamMemberId: string;
    teamMemberName: string;
    teamMemberType: 'overseer' | 'worker' | 'helper';
    model: 'haiku' | 'sonnet' | 'opus';
    prompt: string;
    background?: boolean;
    /** Parent task ID for team communication (enables team features) */
    parentTaskId?: string;
    /** Enable team communication features (default: true if parentTaskId provided) */
    enableTeamComms?: boolean;
    /** Native Claude agent type (optional - uses Claude's --agent flag) */
    nativeAgentType?: NativeAgentType;
}
interface TeamMemberDeployResult {
    success: boolean;
    teamMemberId: string;
    teamMemberName: string;
    pid?: number;
    screenSession?: string;
    message: string;
    /** Team comms member ID (if team comms enabled) */
    teamCommsMemberId?: string;
    /** Team channel ID (if team comms enabled) */
    teamChannelId?: string;
}
/**
 * Deploy a team member with full SpecMem MCP access
 *
 * This is basically the Task tool but it actually fucking works
 * because we spawn team members with MCP configured
 *
 * Now with team communication support for coordinated multi-team-member work
 */
export declare function deployTeamMember(args: DeployTeamMemberArgs): Promise<TeamMemberDeployResult>;
/**
 * Get output from a running teamMember
 */
export declare function getTeamMemberOutput(teamMemberId: string, lines?: number): Promise<string>;
/**
 * Get detailed team member status
 */
export declare function getTeamMemberStatus(teamMemberId: string): Promise<{
    running: boolean;
    screenSession?: string;
    output?: string;
    monitorLog?: string;
    promptFile?: string;
    startTime?: string;
}>;
/**
 * List all running team members with details
 */
export declare function listRunningTeamMembers(): Promise<Array<{
    teamMemberId: string;
    screenSession: string;
    startTime?: string;
    hasOutput: boolean;
}>>;
/**
 * Intervene in a running team member by sending input to its screen session
 */
export declare function interveneTeamMember(teamMemberId: string, input: string): Promise<{
    success: boolean;
    message: string;
}>;
/**
 * Get screen hardcopy (current screen contents) for a team member
 */
export declare function getTeamMemberScreen(teamMemberId: string): Promise<string>;
/**
 * Kill a team member
 *
 * SAFETY: Uses safeKillScreenSession which verifies ownership before killing.
 * Legacy team-member-* sessions are allowed for backwards compatibility.
 */
export declare function killTeamMember(teamMemberId: string): Promise<boolean>;
/**
 * Notify team member completion for a background team member
 * Call this when monitoring detects the team member has finished
 */
export declare function notifyTeamMemberCompletion(teamMemberId: string, success: boolean, message?: string): Promise<boolean>;
/**
 * Get team member info for a team member
 */
export declare function getTeamMemberTeamInfo(teamMemberId: string): Promise<{
    memberId?: string;
    channelId?: string;
    parentTaskId?: string;
    spawnedAt?: string;
} | null>;
/**
 * Spawn a team member with full team communication setup
 * This is a convenience wrapper around deployTeamMember for team-based work
 */
export declare function spawnTeamMember(config: {
    parentTaskId: string;
    name: string;
    prompt: string;
    model?: 'haiku' | 'sonnet' | 'opus';
    teamMemberType?: 'worker' | 'helper';
}): Promise<TeamMemberDeployResult>;
export {};
//# sourceMappingURL=teamMemberDeployer.d.ts.map