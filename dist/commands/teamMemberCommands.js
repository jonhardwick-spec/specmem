/**
 * TeamMemberCommands - multi-team member deployment and coordination
 *
 * Handles /specmem team-member commands for deploying and managing team member swarms
 */
export class TeamMemberCommands {
    db;
    name = 'team-member';
    description = 'Deploy and manage multi-team-member swarms';
    actions = new Map();
    constructor(db) {
        this.db = db;
        this.initializeActions();
    }
    initializeActions() {
        this.actions.set('deploy', {
            name: 'deploy',
            description: 'Deploy a multi-team-member team (overseer + workers + helpers)',
            usage: '/specmem team-member deploy "<mission prompt>"',
            examples: [
                '/specmem team-member deploy "Fix WebSocket disconnect loop"',
                '/specmem team-member deploy "Optimize database queries and add caching"',
                '/specmem team-member deploy "Implement user authentication with JWT"'
            ]
        });
        this.actions.set('list', {
            name: 'list',
            description: 'List all active team members via getActiveTeamMembers',
            usage: '/specmem team member list',
            examples: [
                '/specmem team member list'
            ]
        });
        this.actions.set('help', {
            name: 'help',
            description: 'Show help for team member commands',
            usage: '/specmem team member help',
            examples: [
                '/specmem team member help'
            ]
        });
    }
    async handleAction(action, args) {
        switch (action) {
            case 'deploy':
                return this.handleDeploy(args);
            case 'list':
                return this.handleList();
            case 'help':
                return this.handleHelp();
            default:
                return {
                    success: false,
                    message: `Unknown team member action: ${action}`,
                    suggestions: ['deploy', 'list', 'help'].map(a => `/specmem team member ${a}`)
                };
        }
    }
    async handleDeploy(args) {
        if (args.length === 0) {
            return {
                success: false,
                message: 'Mission prompt required',
                suggestions: ['/specmem team member deploy "your mission here"']
            };
        }
        const missionPrompt = args.join(' ');
        // This will be handled by  Code when it sees this result
        // The actual deployment happens via the Task tool
        return {
            success: true,
            message: 'TEAM_MEMBER_DEPLOYMENT_REQUESTED',
            data: {
                missionPrompt,
                instructions: {
                    step1: 'Ask user for worker count (1-10)',
                    step2: 'Ask model for each worker (haiku/sonnet/opus)',
                    step3: 'Ask helper count (0-10)',
                    step4: 'Ask model for each helper',
                    step5: 'Ask overseer model',
                    step6: 'Calculate helper assignments',
                    step7: 'Deploy all team members in parallel via Task tool',
                    step8: 'Show deployment summary'
                }
            }
        };
    }
    async handleList() {
        // This triggers  to use getActiveTeamMembers SpecMem tool
        return {
            success: true,
            message: 'TEAM_MEMBER_LIST_REQUESTED',
            data: {
                instruction: 'Use getActiveTeamMembers SpecMem MCP tool to list all active team members'
            }
        };
    }
    handleHelp() {
        return {
            success: true,
            message: this.getHelp()
        };
    }
    getHelp() {
        const lines = [
            '## TeamMember Commands',
            '',
            'Deploy and manage multi-team-member swarms for complex tasks.',
            '',
            '### Available Actions:',
            ''
        ];
        for (const [name, action] of this.actions) {
            lines.push(`**${name}** - ${action.description}`);
            lines.push(`  Usage: ${action.usage}`);
            lines.push('');
        }
        lines.push('### Team Member Deployment Flow:');
        lines.push('1. Specify mission prompt');
        lines.push('2. Configure worker count and models');
        lines.push('3. Configure helper count and models');
        lines.push('4. Configure overseer model');
        lines.push('5. TeamMembers deploy and coordinate via SpecMem communication');
        lines.push('');
        lines.push('### TeamMember Types:');
        lines.push('- **Overseer**: Coordinates mission and delegates tasks');
        lines.push('- **Workers**: Execute assigned tasks (1-10 workers)');
        lines.push('- **Helpers**: Assist with codebase searches (0-10 helpers)');
        lines.push('');
        lines.push('### Models:');
        lines.push('- **Haiku**: Fast, cheap (good for helpers)');
        lines.push('- **Sonnet**: Balanced (recommended for workers)');
        lines.push('- **Opus**: Powerful (recommended for overseer)');
        return lines.join('\n');
    }
}
//# sourceMappingURL=teamMemberCommands.js.map