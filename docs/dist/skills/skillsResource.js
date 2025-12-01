/**
 * skillsResource.ts - MCP Resource Provider for Skills
 *
 * exposes all skills as MCP resources so Claude can access them
 * provides list and read endpoints for the MCP protocol
 *
 * Features:
 * - Dynamic resource listing from skill scanner
 * - Individual skill content access
 * - Category-based organization
 * - Auto-update when skills change
 */
import { getSkillScanner } from './skillScanner.js';
import { logger } from '../utils/logger.js';
/**
 * SkillResourceProvider - provides MCP resources for skills
 */
export class SkillResourceProvider {
    scanner;
    baseUri = 'specmem://skills';
    constructor(scanner) {
        this.scanner = scanner || getSkillScanner();
    }
    /**
     * getResources - returns all skills as MCP resources
     */
    getResources() {
        const resources = [];
        // add master skill list resource
        resources.push({
            uri: `${this.baseUri}/list`,
            name: 'All Skills',
            description: 'Complete list of all available skills with descriptions',
            mimeType: 'text/markdown'
        });
        // add category index resource
        resources.push({
            uri: `${this.baseUri}/categories`,
            name: 'Skill Categories',
            description: 'Index of all skill categories',
            mimeType: 'text/markdown'
        });
        // add individual skill resources
        const skills = this.scanner.getAllSkills();
        for (const skill of skills) {
            resources.push({
                uri: `${this.baseUri}/${skill.id}`,
                name: skill.name,
                description: skill.description || `Skill: ${skill.name} (${skill.category})`,
                mimeType: 'text/markdown'
            });
        }
        // add category resources
        const categories = this.scanner.getCategories();
        for (const category of categories) {
            resources.push({
                uri: `${this.baseUri}/category/${category}`,
                name: `Category: ${category}`,
                description: `All skills in the ${category} category`,
                mimeType: 'text/markdown'
            });
        }
        return resources;
    }
    /**
     * readResource - reads content for a specific resource URI
     */
    async readResource(uri) {
        const path = uri.replace(this.baseUri, '').replace(/^\//, '');
        logger.debug({ uri, path }, 'reading skill resource');
        // handle master list
        if (path === 'list' || path === '') {
            return this.getSkillListContent(uri);
        }
        // handle categories index
        if (path === 'categories') {
            return this.getCategoriesContent(uri);
        }
        // handle category listing
        if (path.startsWith('category/')) {
            const category = path.replace('category/', '');
            return this.getCategoryContent(uri, category);
        }
        // handle individual skill
        const skill = this.scanner.getSkillById(path);
        if (skill) {
            return this.getSkillContent(uri, skill);
        }
        throw new Error(`Skill resource not found: ${uri}`);
    }
    /**
     * getSkillListContent - generates master skill list
     */
    getSkillListContent(uri) {
        const skills = this.scanner.getAllSkills();
        const categories = this.scanner.getCategories();
        let content = `# SpecMem Skills Library\n\n`;
        content += `**Total Skills**: ${skills.length}\n`;
        content += `**Categories**: ${categories.length}\n\n`;
        content += `---\n\n`;
        // table of contents
        content += `## Table of Contents\n\n`;
        for (const category of categories) {
            const categorySkills = this.scanner.getSkillsByCategory(category);
            content += `- [${this.capitalize(category)}](#${category}) (${categorySkills.length} skills)\n`;
        }
        content += '\n---\n\n';
        // skill listings by category
        for (const category of categories) {
            const categorySkills = this.scanner.getSkillsByCategory(category);
            content += `## ${this.capitalize(category)}\n\n`;
            for (const skill of categorySkills) {
                content += `### ${skill.name}\n`;
                content += `- **ID**: \`${skill.id}\`\n`;
                content += `- **File**: \`${skill.relativePath}\`\n`;
                if (skill.description) {
                    content += `- **Description**: ${skill.description}\n`;
                }
                content += `- **Tags**: ${skill.tags.join(', ')}\n`;
                content += `- **URI**: \`specmem://skills/${skill.id}\`\n`;
                content += '\n';
            }
        }
        return {
            uri,
            mimeType: 'text/markdown',
            text: content
        };
    }
    /**
     * getCategoriesContent - generates category index
     */
    getCategoriesContent(uri) {
        const categories = this.scanner.getCategories();
        let content = `# Skill Categories\n\n`;
        content += `Total Categories: ${categories.length}\n\n`;
        for (const category of categories) {
            const skills = this.scanner.getSkillsByCategory(category);
            content += `## ${this.capitalize(category)}\n`;
            content += `- **Skills**: ${skills.length}\n`;
            content += `- **URI**: \`specmem://skills/category/${category}\`\n`;
            content += `- **Skills**: ${skills.map(s => s.name).join(', ')}\n\n`;
        }
        return {
            uri,
            mimeType: 'text/markdown',
            text: content
        };
    }
    /**
     * getCategoryContent - generates content for a specific category
     */
    getCategoryContent(uri, category) {
        const skills = this.scanner.getSkillsByCategory(category);
        if (skills.length === 0) {
            throw new Error(`Category not found: ${category}`);
        }
        let content = `# ${this.capitalize(category)} Skills\n\n`;
        content += `Total Skills: ${skills.length}\n\n`;
        content += `---\n\n`;
        for (const skill of skills) {
            content += `## ${skill.name}\n\n`;
            if (skill.description) {
                content += `> ${skill.description}\n\n`;
            }
            content += `**Tags**: ${skill.tags.join(', ')}\n\n`;
            content += `**Full Content**:\n\n`;
            content += '```markdown\n';
            content += skill.content;
            content += '\n```\n\n';
            content += `---\n\n`;
        }
        return {
            uri,
            mimeType: 'text/markdown',
            text: content
        };
    }
    /**
     * getSkillContent - returns full skill content
     */
    getSkillContent(uri, skill) {
        let content = `# ${skill.name}\n\n`;
        content += `**Category**: ${skill.category}\n`;
        if (skill.subcategory) {
            content += `**Subcategory**: ${skill.subcategory}\n`;
        }
        content += `**File**: ${skill.relativePath}\n`;
        content += `**Tags**: ${skill.tags.join(', ')}\n`;
        content += `**Last Modified**: ${skill.lastModified.toISOString()}\n`;
        content += `**Size**: ${skill.sizeBytes} bytes\n\n`;
        content += `---\n\n`;
        content += skill.content;
        return {
            uri,
            mimeType: 'text/markdown',
            text: content
        };
    }
    /**
     * capitalize - capitalizes first letter
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    /**
     * getSkillSummaryForPrompt - returns a compact summary for system prompts
     */
    getSkillSummaryForPrompt() {
        const skills = this.scanner.getAllSkills();
        const categories = this.scanner.getCategories();
        let summary = `## Available Skills (${skills.length})\n\n`;
        for (const category of categories) {
            const categorySkills = this.scanner.getSkillsByCategory(category);
            summary += `### ${this.capitalize(category)}\n`;
            for (const skill of categorySkills) {
                summary += `- **${skill.name}**: ${skill.description || 'No description'}\n`;
                summary += `  - Access via: \`specmem://skills/${skill.id}\`\n`;
            }
            summary += '\n';
        }
        return summary;
    }
    /**
     * getAllSkillsContent - returns ALL skill content combined (for context)
     */
    getAllSkillsContent() {
        const skills = this.scanner.getAllSkills();
        let content = `# Complete Skills Reference\n\n`;
        content += `Total Skills: ${skills.length}\n\n`;
        content += `---\n\n`;
        for (const skill of skills) {
            content += `# ${skill.name} (${skill.category})\n\n`;
            content += skill.content;
            content += '\n\n---\n\n';
        }
        return content;
    }
}
// Singleton instance
let resourceProviderInstance = null;
/**
 * getSkillResourceProvider - returns singleton provider
 */
export function getSkillResourceProvider(scanner) {
    if (!resourceProviderInstance) {
        resourceProviderInstance = new SkillResourceProvider(scanner);
    }
    return resourceProviderInstance;
}
/**
 * resetSkillResourceProvider - resets singleton (for testing)
 */
export function resetSkillResourceProvider() {
    resourceProviderInstance = null;
}
//# sourceMappingURL=skillsResource.js.map