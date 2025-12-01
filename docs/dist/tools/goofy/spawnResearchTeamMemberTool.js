/**
 * SPAWN RESEARCH TEAM_MEMBER TOOL
 *
 * MCP Tool wrapper for spawnResearchTeamMember functionality.
 * Spawns Claude subprocess to research topics on the web and save to SpecMem.
 *
 * Why this exists:
 * - Local embedding model is just a dumb vector generator
 * - Can't actually understand or research things
 * - This spawns Claude to do real web research
 * - Results saved back to SpecMem for future retrieval
 */
import { spawnResearchTeamMember, getActiveResearchTeamMembers } from './spawnResearchTeamMember.js';
import { logger } from '../../utils/logger.js';
/**
 * SpawnResearchTeamMemberTool - spawns Claude to research topics fr fr
 *
 * When SpecMem needs more context than the local AI can provide,
 * this tool spawns a Claude subprocess to do real web research
 */
export class SpawnResearchTeamMemberTool {
    name = 'spawn_research_teamMember';
    description = `Spawn a Claude subprocess to research a topic on the web and save findings to SpecMem.

**IMPORTANT: MUST ASK USER BEFORE SPAWNING**
Before calling this tool, Claude MUST use AskUserQuestion to confirm:
{
  "question": "I need to research '[topic]' on the web. Confirm deployment?",
  "header": "Research Team Member",
  "options": [
    {"label": "Quick Search", "description": "1-2 sources, fast results"},
    {"label": "Medium Search (Recommended)", "description": "3-5 sources, balanced"},
    {"label": "Thorough Search", "description": "5-10 sources, comprehensive"},
    {"label": "Cancel", "description": "Don't spawn research team member"}
  ],
  "multiSelect": false
}

Use this when you need current/accurate information that local memory doesn't have.
The research team member will:
1. Search the web for the topic using WebSearch
2. Fetch and analyze sources using WebFetch
3. Synthesize findings into a summary
4. Save the research to SpecMem for future retrieval

Examples:
- Research "latest React 19 features" to get up-to-date docs
- Research "PostgreSQL pgvector performance tips" for technical info
- Research a specific error message to find solutions

Parameters:
- topic: What to research (required)
- context: Why you need this info (helps focus research)
- depth: quick (1-2 sources), medium (3-5), thorough (5-10)
- saveToMemory: Save findings to SpecMem (default: true)
- tags: Tags for saved memories
- userConfirmed: Set to true after user confirms via AskUserQuestion (required for execution)`;
    inputSchema = {
        type: 'object',
        properties: {
            topic: {
                type: 'string',
                description: 'The topic to research on the web'
            },
            context: {
                type: 'string',
                description: 'Additional context about why this is needed'
            },
            depth: {
                type: 'string',
                enum: ['quick', 'medium', 'thorough'],
                default: 'medium',
                description: 'How deep to research - quick (1-2 sources), medium (3-5), thorough (5-10)'
            },
            saveToMemory: {
                type: 'boolean',
                default: true,
                description: 'Whether to save findings as SpecMem memories'
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags to apply to saved memories'
            },
            userConfirmed: {
                type: 'boolean',
                default: false,
                description: 'REQUIRED: Must be true after user confirms via AskUserQuestion. Tool will return instructions if false.'
            }
        },
        required: ['topic']
    };
    async execute(params) {
        logger.info({ topic: params.topic, depth: params.depth, confirmed: params.userConfirmed }, '[SpawnResearchTeamMemberTool] Execute called');
        // CHECK USER CONFIRMATION FIRST
        if (!params.userConfirmed) {
            logger.info({ topic: params.topic }, '[SpawnResearchTeamMemberTool] User confirmation required');
            return {
                success: false,
                topic: params.topic,
                summary: '',
                sources: [],
                memoriesCreated: 0,
                error: `USER_CONFIRMATION_REQUIRED: Before spawning research team member, use AskUserQuestion:
{
  "questions": [{
    "question": "I want to research '${params.topic}' on the web. Which search depth?",
    "header": "Research",
    "options": [
      {"label": "Quick Search", "description": "1-2 sources, ~30 seconds"},
      {"label": "Medium Search (Recommended)", "description": "3-5 sources, ~1 minute"},
      {"label": "Thorough Search", "description": "5-10 sources, ~2 minutes"},
      {"label": "Cancel", "description": "Don't spawn research team member"}
    ],
    "multiSelect": false
  }]
}
Then call spawn_research_team member again with userConfirmed: true and the selected depth.`
            };
        }
        // User confirmed - proceed with research
        logger.info({ topic: params.topic, depth: params.depth }, '[SpawnResearchTeamMemberTool] Starting research (confirmed)');
        try {
            const result = await spawnResearchTeamMember({
                topic: params.topic,
                context: params.context,
                depth: params.depth || 'medium',
                saveToMemory: params.saveToMemory !== false,
                tags: params.tags
            });
            return result;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ error: errorMsg, topic: params.topic }, '[SpawnResearchTeamMemberTool] Research failed');
            return {
                success: false,
                topic: params.topic,
                summary: '',
                sources: [],
                memoriesCreated: 0,
                error: errorMsg
            };
        }
    }
}
/**
 * GetActiveResearchTeamMembersTool - check what research is in progress
 *
 * FIXED: Now properly awaits the async getActiveResearchTeamMembers() function
 * which queries the database and verifies screen session liveness for accurate results.
 */
export class GetActiveResearchTeamMembersTool {
    name = 'get_active_research_teamMembers';
    description = `Get list of currently running research team members.

Use this to check if research is still in progress or to monitor active research tasks.

Returns:
- List of active research team members with their ID, topic, start time, PID, screen session, and elapsed time
- TeamMember count and status message

The tool now queries the database for team members across all processes and verifies
that the screen session is actually still running before including it in results.`;
    inputSchema = {
        type: 'object',
        properties: {},
        required: []
    };
    async execute() {
        try {
            const rawTeamMembers = await getActiveResearchTeamMembers();
            const now = Date.now();
            // Transform to include elapsedMs and status
            const teamMembers = rawTeamMembers.map(a => ({
                id: a.id,
                topic: a.topic,
                startTime: a.startTime,
                pid: a.pid,
                depth: a.depth,
                screenSession: a.screenSession,
                status: 'running',
                elapsedMs: now - a.startTime
            }));
            const count = teamMembers.length;
            let message;
            if (count === 0) {
                message = 'No research team members currently running.';
            }
            else if (count === 1) {
                const teamMember = teamMembers[0];
                const elapsed = `${Math.round(teamMember.elapsedMs / 1000)}s`;
                message = `1 research team member running: "${teamMember.topic}" (${elapsed} elapsed, screen: ${teamMember.screenSession || 'N/A'})`;
            }
            else {
                message = `${count} research team members currently running:\n${teamMembers.map(a => {
                    const elapsed = `${Math.round(a.elapsedMs / 1000)}s`;
                    return `- "${a.topic}" (${elapsed} elapsed, screen: ${a.screenSession || 'N/A'})`;
                }).join('\n')}`;
            }
            logger.info({ count }, '[GetActiveResearchTeamMembersTool] Returning active team members');
            return { teamMembers, count, message };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ error: errorMsg }, '[GetActiveResearchTeamMembersTool] Failed to get active team members');
            return {
                teamMembers: [],
                count: 0,
                message: `Error getting active teamMembers: ${errorMsg}`
            };
        }
    }
}
//# sourceMappingURL=spawnResearchTeamMemberTool.js.map