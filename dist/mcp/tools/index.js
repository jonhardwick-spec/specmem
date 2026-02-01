/**
 * MCP Tools Index
 *
 * Central export point for all MCP tools.
 *
 * NOTE: Team communication tools REPLACE HTTP-based team member communication.
 * All inter-team-member communication should use these MCP tools, NOT HTTP.
 */
// Team communication tools (REPLACES HTTP team member communication)
export { 
// Individual tool classes
SendTeamMessage, ReadTeamMessages, BroadcastToTeam, ClaimTask, ReleaseTask, GetTeamStatus, RequestHelp, RespondToHelp, 
// Factory functions
createTeamCommTools, createTeamCommToolsWithDB, initTeamCommsDB, 
// Tool list for registration
teamCommTools } from './teamComms.js';
//# sourceMappingURL=index.js.map