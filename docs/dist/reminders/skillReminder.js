/**
 * skillReminder.ts - Auto-Reminder System for Claude Skills
 *
 * yo this system makes it IMPOSSIBLE for Claude to forget skills fr fr
 * provides constant context about available skills through MCP prompts
 *
 * Features:
 * - Auto-generates skill reminders on startup
 * - Creates MCP prompts for skill awareness
 * - Periodic skill refresh notifications
 * - Category-based skill summaries
 * - Integration with skill scanner for live updates
 */
import { getSkillScanner } from '../skills/skillScanner.js';
import { getSkillResourceProvider } from '../skills/skillsResource.js';
import { logger } from '../utils/logger.js';
/**
 * Default config
 */
const DEFAULT_CONFIG = {
    enabled: true,
    includeFullSkillContent: true,
    maxSkillsInPrompt: 50,
    includeCodebaseOverview: true,
    refreshIntervalMinutes: 30
};
/**
 * SkillReminder - the brain's memory system for skills
 *
 * ensures Claude ALWAYS knows what skills are available
 * like having sticky notes everywhere fr fr
 */
export class SkillReminder {
    config;
    scanner;
    resourceProvider;
    codebaseIndexer = null;
    lastRefresh = null;
    refreshTimer = null;
    constructor(config = {}, scanner, codebaseIndexer) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.scanner = scanner || getSkillScanner();
        this.resourceProvider = getSkillResourceProvider(this.scanner);
        this.codebaseIndexer = codebaseIndexer || null;
    }
    /**
     * initialize - starts the reminder system
     */
    async initialize() {
        if (!this.config.enabled) {
            logger.info('skill reminder disabled');
            return;
        }
        logger.info('initializing skill reminder system...');
        // listen for skill changes
        this.scanner.onSkillChange((event) => {
            logger.info({
                type: event.type,
                path: event.path
            }, 'skill changed - updating reminders');
            this.lastRefresh = new Date();
        });
        // set up periodic refresh
        if (this.config.refreshIntervalMinutes > 0) {
            this.refreshTimer = setInterval(() => this.refreshReminders(), this.config.refreshIntervalMinutes * 60 * 1000);
        }
        this.lastRefresh = new Date();
        logger.info({
            refreshInterval: this.config.refreshIntervalMinutes
        }, 'skill reminder system initialized');
    }
    /**
     * refreshReminders - refreshes the skill reminders
     */
    async refreshReminders() {
        logger.debug('refreshing skill reminders');
        await this.scanner.scan();
        this.lastRefresh = new Date();
    }
    /**
     * getPrompts - returns all MCP prompts for skill awareness
     */
    getPrompts() {
        const prompts = [];
        // master skills awareness prompt
        prompts.push({
            name: 'skill-awareness',
            description: 'Complete overview of all available skills - use this to understand what capabilities are available',
            arguments: []
        });
        // quick skills reference
        prompts.push({
            name: 'quick-skills',
            description: 'Quick reference of skill names and categories',
            arguments: []
        });
        // skill by category
        prompts.push({
            name: 'skills-by-category',
            description: 'Get skills for a specific category',
            arguments: [
                {
                    name: 'category',
                    description: 'The skill category to retrieve',
                    required: true
                }
            ]
        });
        // specific skill detail
        prompts.push({
            name: 'skill-detail',
            description: 'Get detailed content for a specific skill',
            arguments: [
                {
                    name: 'skill_id',
                    description: 'The skill ID to retrieve',
                    required: true
                }
            ]
        });
        // codebase context
        if (this.codebaseIndexer) {
            prompts.push({
                name: 'codebase-context',
                description: 'Overview of the indexed codebase structure and contents',
                arguments: []
            });
        }
        // combined context
        prompts.push({
            name: 'full-context',
            description: 'Complete context including all skills and codebase overview',
            arguments: []
        });
        return prompts;
    }
    /**
     * getPromptMessages - returns messages for a specific prompt
     */
    getPromptMessages(promptName, args) {
        switch (promptName) {
            case 'skill-awareness':
                return this.getSkillAwarenessMessages();
            case 'quick-skills':
                return this.getQuickSkillsMessages();
            case 'skills-by-category':
                return this.getSkillsByCategoryMessages(args?.category || '');
            case 'skill-detail':
                return this.getSkillDetailMessages(args?.skill_id || '');
            case 'codebase-context':
                return this.getCodebaseContextMessages();
            case 'full-context':
                return this.getFullContextMessages();
            default:
                throw new Error(`Unknown prompt: ${promptName}`);
        }
    }
    /**
     * getSkillAwarenessMessages - complete skill overview
     */
    getSkillAwarenessMessages() {
        const skills = this.scanner.getAllSkills();
        const categories = this.scanner.getCategories();
        let content = `# Available Skills Library\n\n`;
        content += `You have access to ${skills.length} skills across ${categories.length} categories.\n\n`;
        content += `**Important**: These skills are your capabilities. Reference them when handling tasks.\n\n`;
        content += `---\n\n`;
        // category overview
        content += `## Categories\n\n`;
        for (const category of categories) {
            const categorySkills = this.scanner.getSkillsByCategory(category);
            content += `### ${this.capitalize(category)} (${categorySkills.length} skills)\n\n`;
            for (const skill of categorySkills.slice(0, this.config.maxSkillsInPrompt)) {
                content += `#### ${skill.name}\n`;
                if (skill.description) {
                    content += `> ${skill.description}\n\n`;
                }
                content += `- **ID**: \`${skill.id}\`\n`;
                content += `- **Tags**: ${skill.tags.slice(0, 5).join(', ')}\n`;
                // include full content if configured
                if (this.config.includeFullSkillContent) {
                    content += `\n**Content**:\n\`\`\`markdown\n${skill.content}\n\`\`\`\n`;
                }
                content += '\n';
            }
        }
        return [{
                role: 'user',
                content: { type: 'text', text: content }
            }];
    }
    /**
     * getQuickSkillsMessages - compact skill reference
     */
    getQuickSkillsMessages() {
        const skills = this.scanner.getAllSkills();
        const categories = this.scanner.getCategories();
        let content = `# Quick Skills Reference\n\n`;
        content += `Total: ${skills.length} skills in ${categories.length} categories\n\n`;
        for (const category of categories) {
            const categorySkills = this.scanner.getSkillsByCategory(category);
            content += `## ${this.capitalize(category)}\n`;
            for (const skill of categorySkills) {
                content += `- **${skill.name}** (\`${skill.id}\`): ${skill.description || 'No description'}\n`;
            }
            content += '\n';
        }
        return [{
                role: 'user',
                content: { type: 'text', text: content }
            }];
    }
    /**
     * getSkillsByCategoryMessages - skills for a specific category
     */
    getSkillsByCategoryMessages(category) {
        const skills = this.scanner.getSkillsByCategory(category);
        if (skills.length === 0) {
            return [{
                    role: 'user',
                    content: { type: 'text', text: `No skills found in category: ${category}` }
                }];
        }
        let content = `# ${this.capitalize(category)} Skills\n\n`;
        content += `${skills.length} skills in this category:\n\n`;
        for (const skill of skills) {
            content += `## ${skill.name}\n\n`;
            if (skill.description) {
                content += `> ${skill.description}\n\n`;
            }
            content += skill.content;
            content += '\n\n---\n\n';
        }
        return [{
                role: 'user',
                content: { type: 'text', text: content }
            }];
    }
    /**
     * getSkillDetailMessages - single skill details
     */
    getSkillDetailMessages(skillId) {
        const skill = this.scanner.getSkillById(skillId);
        if (!skill) {
            return [{
                    role: 'user',
                    content: { type: 'text', text: `Skill not found: ${skillId}` }
                }];
        }
        let content = `# ${skill.name}\n\n`;
        content += `**Category**: ${skill.category}\n`;
        content += `**File**: ${skill.relativePath}\n`;
        content += `**Tags**: ${skill.tags.join(', ')}\n\n`;
        content += `---\n\n`;
        content += skill.content;
        return [{
                role: 'user',
                content: { type: 'text', text: content }
            }];
    }
    /**
     * getCodebaseContextMessages - codebase overview
     */
    getCodebaseContextMessages() {
        if (!this.codebaseIndexer) {
            return [{
                    role: 'user',
                    content: { type: 'text', text: 'Codebase indexer not available.' }
                }];
        }
        const overview = this.codebaseIndexer.getCodebaseOverview();
        return [{
                role: 'user',
                content: { type: 'text', text: overview }
            }];
    }
    /**
     * getFullContextMessages - complete context
     */
    getFullContextMessages() {
        let content = `# SpecMem Full Context\n\n`;
        content += `*Generated: ${new Date().toISOString()}*\n\n`;
        content += `---\n\n`;
        // add skills
        const skillsContent = this.getSkillAwarenessMessages()[0]?.content.text || '';
        content += skillsContent;
        // add codebase if available
        if (this.codebaseIndexer) {
            content += '\n---\n\n';
            const codebaseContent = this.getCodebaseContextMessages()[0]?.content.text || '';
            content += codebaseContent;
        }
        return [{
                role: 'user',
                content: { type: 'text', text: content }
            }];
    }
    /**
     * getStartupReminder - returns reminder content for startup
     */
    getStartupReminder() {
        const skills = this.scanner.getAllSkills();
        const categories = this.scanner.getCategories();
        let reminder = `\n${'='.repeat(60)}\n`;
        reminder += `SPECMEM SKILLS LOADED\n`;
        reminder += `${'='.repeat(60)}\n\n`;
        reminder += `You have ${skills.length} skills available across ${categories.length} categories:\n\n`;
        for (const category of categories) {
            const categorySkills = this.scanner.getSkillsByCategory(category);
            reminder += `  ${this.capitalize(category)}: ${categorySkills.map(s => s.name).join(', ')}\n`;
        }
        reminder += `\nUse prompt 'skill-awareness' for full details.\n`;
        reminder += `Use prompt 'skill-detail' with skill_id for specific skills.\n`;
        if (this.codebaseIndexer) {
            const stats = this.codebaseIndexer.getStats();
            reminder += `\nCodebase indexed: ${stats.totalFiles} files, ${stats.totalLines} lines\n`;
        }
        reminder += `\n${'='.repeat(60)}\n`;
        return reminder;
    }
    /**
     * getSystemPromptAddition - returns text to add to system prompt
     */
    getSystemPromptAddition() {
        const skills = this.scanner.getAllSkills();
        const categories = this.scanner.getCategories();
        let addition = `\n## Available Skills\n\n`;
        addition += `You have ${skills.length} skills available. `;
        addition += `Categories: ${categories.map(c => this.capitalize(c)).join(', ')}.\n\n`;
        addition += `To access skills:\n`;
        addition += `- Use MCP resource \`specmem://skills/list\` for complete list\n`;
        addition += `- Use MCP resource \`specmem://skills/{skill-id}\` for specific skill\n`;
        addition += `- Use MCP prompt \`skill-awareness\` for full context\n\n`;
        addition += `Key skills:\n`;
        for (const skill of skills.slice(0, 10)) {
            addition += `- **${skill.name}** (${skill.category}): ${skill.description || 'No description'}\n`;
        }
        if (skills.length > 10) {
            addition += `\n...and ${skills.length - 10} more skills.\n`;
        }
        return addition;
    }
    /**
     * capitalize - capitalizes first letter
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    /**
     * setCodebaseIndexer - sets the codebase indexer reference
     */
    setCodebaseIndexer(indexer) {
        this.codebaseIndexer = indexer;
    }
    /**
     * shutdown - cleanup resources
     */
    async shutdown() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        logger.info('skill reminder shut down');
    }
}
// Singleton instance
let reminderInstance = null;
/**
 * getSkillReminder - returns singleton reminder instance
 */
export function getSkillReminder(config, scanner, codebaseIndexer) {
    if (!reminderInstance) {
        reminderInstance = new SkillReminder(config, scanner, codebaseIndexer);
    }
    return reminderInstance;
}
/**
 * resetSkillReminder - resets the singleton (for testing)
 */
export function resetSkillReminder() {
    if (reminderInstance) {
        reminderInstance.shutdown();
        reminderInstance = null;
    }
}
//# sourceMappingURL=skillReminder.js.map