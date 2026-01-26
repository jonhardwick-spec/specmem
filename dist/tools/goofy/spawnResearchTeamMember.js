/**
 * SPAWN RESEARCH TEAM_MEMBER
 *
 * Spawns a  Code subprocess to research information on the web.
 * The local embedding model is just a dumb vector generator - it can't
 * actually understand or research things. This tool bridges that gap.
 *
 * When SpecMem needs more context on a topic:
 *   1. This tool spawns a  subprocess via deployTeamMember (with MCP access!)
 *   2.  researches using WebSearch/WebFetch
 *   3. Findings are saved back to SpecMem as memories
 *   4. The local embedding model can then find these researched facts
 *
 * FIXED: Now uses deployTeamMember from teamMemberDeployer.ts which:
 * - Spawns team members in screen sessions (persistent)
 * - Gives team members full SpecMem MCP access
 * - Properly tracks team member PIDs
 *
 * FIX 2024-12: Added database persistence for research team member tracking.
 *
 * FIX 2024-12 (CRITICAL): Changed from spawn('claude', ['--print', ...]) to
 * deployTeamMember() which properly gives team members MCP access. The old --print mode
 * ran  WITHOUT any tools, so WebSearch/WebFetch were never available!
 *
 * Security:  subprocess inherits parent permissions. This is
 * intentional - we want  to have web access for research.
 */
import { execSync } from 'child_process';
import { logger } from '../../utils/logger.js';
import { getDatabase } from '../../database.js';
import { z } from 'zod';
import { deployTeamMember } from '../teamMemberDeployer.js';
const SpawnResearchTeamMemberSchema = z.object({
    topic: z.string().describe('The topic to research on the web'),
    context: z.string().optional().describe('Additional context about why this is needed'),
    depth: z.enum(['quick', 'medium', 'thorough']).default('medium').describe('How deep to research'),
    saveToMemory: z.boolean().default(true).describe('Whether to save findings as SpecMem memories'),
    tags: z.array(z.string()).optional().describe('Tags to apply to saved memories')
});
// Track active research team members (in-memory cache, also persisted to DB)
const activeResearchTeamMembers = new Map();
let dbSchemaInitialized = false;
async function ensureResearchTeamMemberSchema() {
    if (dbSchemaInitialized)
        return;
    try {
        const db = getDatabase();
        await db.query(`
      CREATE TABLE IF NOT EXISTS research_teamMembers (
        id VARCHAR(100) PRIMARY KEY,
        topic TEXT NOT NULL,
        context TEXT,
        depth VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) NOT NULL DEFAULT 'running',
        pid INTEGER,
        screen_session VARCHAR(100),
        model VARCHAR(50),
        start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        end_time TIMESTAMPTZ,
        result_summary TEXT,
        sources_count INTEGER DEFAULT 0,
        memories_created INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_research_teamMembers_status ON research_teamMembers(status) WHERE status = 'running'`);
        dbSchemaInitialized = true;
        logger.info('[Research] Database schema initialized');
    }
    catch (err) {
        logger.error({ error: err }, '[Research] Failed to initialize schema');
    }
}
async function registerResearchTeamMemberInDb(researchId, topic, pid, depth, model, screenSession, context) {
    try {
        await ensureResearchTeamMemberSchema();
        const db = getDatabase();
        await db.query(`
      INSERT INTO research_teamMembers (id, topic, context, depth, status, pid, screen_session, model, start_time)
      VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, NOW())
      ON CONFLICT (id) DO UPDATE SET status = 'running', pid = EXCLUDED.pid, screen_session = EXCLUDED.screen_session
    `, [researchId, topic, context || null, depth, pid, screenSession || null, model]);
    }
    catch (err) {
        logger.error({ error: err, researchId }, '[Research] Failed to register team member in DB');
    }
}
function isScreenSessionRunning(sessionName) {
    if (!sessionName)
        return false;
    try {
        execSync(`screen -ls | grep -q "${sessionName}"`, { encoding: 'utf-8', timeout: 5000 });
        return true;
    }
    catch {
        return false;
    }
}
function generateResearchPrompt(input) {
    const depthInstructions = {
        quick: 'Do a quick search (1-2 sources) and provide a brief summary.',
        medium: 'Search multiple sources (3-5) and provide a comprehensive summary.',
        thorough: 'Do extensive research (5-10 sources), verify information across sources.'
    };
    return `# Research Task

**Topic:** ${input.topic}
${input.context ? `**Context:** ${input.context}` : ''}

**Depth:** ${input.depth}
${depthInstructions[input.depth]}

## Instructions

1. Use WebSearch to find current information about this topic
2. Use WebFetch to get details from relevant sources
3. Synthesize the information into a clear summary
4. Include source URLs for verification
5. SAVE YOUR FINDINGS to SpecMem using save_memory tool!

## Output Format

---RESEARCH_START---
SUMMARY:
[Your synthesized summary here]

KEY_POINTS:
- [Key point 1]
- [Key point 2]
- [Key point 3]

SOURCES:
- [URL 1]
- [URL 2]
---RESEARCH_END---

## CRITICAL: Save Your Findings

After completing your research, use the save_memory MCP tool:
- content: Your full research findings
- importance: "high"
- memoryType: "semantic"
- tags: ["research", "web-sourced"${input.tags ? ', ' + input.tags.map(t => `"${t}"`).join(', ') : ''}]

Be factual and cite sources.
`;
}
/**
 * Spawn  subprocess to do research
 *
 * FIXED: Now uses deployTeamMember() which properly spawns team members with:
 * - Full MCP access (SpecMem, WebSearch, WebFetch, etc.)
 * - Screen sessions for persistence
 * - Proper tracking and monitoring
 *
 * The OLD implementation used spawn('claude', ['--print', '-p', prompt])
 * which runs  in print-only mode WITHOUT MCP tools access!
 */
export async function spawnResearchTeamMember(input) {
    const researchId = `research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({
        topic: input.topic,
        depth: input.depth,
        researchId
    }, '[Research] Spawning research team member via deployTeamMember (with MCP access!)');
    const modelMap = {
        quick: 'haiku',
        medium: 'sonnet',
        thorough: 'opus'
    };
    const model = modelMap[input.depth] || 'sonnet';
    const prompt = generateResearchPrompt(input);
    try {
        // Deploy team member using deployTeamMember which gives MCP access!
        const result = await deployTeamMember({
            teamMemberId: researchId,
            teamMemberName: `Research: ${input.topic.slice(0, 50)}`,
            teamMemberType: 'helper',
            model: model,
            prompt: prompt,
            background: true
        });
        if (result.success) {
            activeResearchTeamMembers.set(researchId, {
                topic: input.topic,
                startTime: Date.now(),
                pid: result.pid || 0,
                status: 'running',
                depth: input.depth,
                context: input.context,
                screenSession: result.screenSession
            });
            await registerResearchTeamMemberInDb(researchId, input.topic, result.pid || 0, input.depth || 'medium', model, result.screenSession, input.context);
            logger.info({
                topic: input.topic, researchId, screenSession: result.screenSession, model
            }, '[Research] Research team member deployed successfully with MCP access');
            return {
                success: true,
                topic: input.topic,
                summary: `Research team member deployed successfully!

TeamMember ID: ${researchId}
Screen Session: ${result.screenSession || 'N/A'}
Model: ${model}

The team member is now researching "${input.topic}" using WebSearch/WebFetch with FULL MCP ACCESS.
Results will be saved to SpecMem with tags: ["research", "web-sourced"]

To monitor: screen -r ${result.screenSession}
To retrieve results: Use find_memory with query "${input.topic}" or tags ["research"]`,
                sources: [],
                memoriesCreated: 0,
                teamMemberId: researchId,
                screenSession: result.screenSession
            };
        }
        else {
            logger.error({ topic: input.topic, researchId, error: result.message }, '[Research] Failed to deploy');
            return {
                success: false,
                topic: input.topic,
                summary: '',
                sources: [],
                memoriesCreated: 0,
                error: `Failed to deploy research teamMember: ${result.message}`
            };
        }
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error: errorMsg, researchId }, '[Research] Exception while deploying');
        return {
            success: false,
            topic: input.topic,
            summary: '',
            sources: [],
            memoriesCreated: 0,
            error: `Exception: ${errorMsg}`
        };
    }
}
export async function getActiveResearchTeamMembers() {
    const teamMembers = [];
    for (const [id, data] of activeResearchTeamMembers.entries()) {
        teamMembers.push({
            id, topic: data.topic, startTime: data.startTime, pid: data.pid,
            screenSession: data.screenSession, depth: data.depth
        });
    }
    try {
        await ensureResearchTeamMemberSchema();
        const db = getDatabase();
        const result = await db.query(`
      SELECT id, topic, depth, pid, screen_session,
             EXTRACT(EPOCH FROM start_time) * 1000 as start_time_ms
      FROM research_teamMembers WHERE status = 'running' ORDER BY start_time DESC LIMIT 50
    `);
        for (const row of result.rows) {
            if (!teamMembers.find(a => a.id === row.id)) {
                const screenAlive = row.screen_session ? isScreenSessionRunning(row.screen_session) : false;
                if (screenAlive) {
                    teamMembers.push({
                        id: row.id, topic: row.topic, startTime: Number(row.start_time_ms),
                        pid: row.pid, screenSession: row.screen_session, depth: row.depth
                    });
                }
            }
        }
    }
    catch (err) {
        logger.error({ error: err }, '[Research] Failed to query DB for active team members');
    }
    return teamMembers;
}
export const spawnResearchTeamMemberTool = {
    name: 'spawn_research_teamMember',
    description: `Spawn a  subprocess to research a topic on the web and save findings to SpecMem.

The research team member runs in a background screen session with FULL MCP ACCESS (WebSearch, WebFetch, save_memory).

Examples:
- Research "latest React 19 features" for up-to-date docs
- Research "PostgreSQL vector extension performance" for technical info`,
    inputSchema: SpawnResearchTeamMemberSchema,
    handler: spawnResearchTeamMember
};
export { SpawnResearchTeamMemberSchema };
//# sourceMappingURL=spawnResearchTeamMember.js.map