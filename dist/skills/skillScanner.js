/**
 * skillScanner.ts - Dynamic Skill Discovery System
 *
 * yo this scanner is GOATED - finds all .md files in the skills directory
 * and subdirectories, auto-reloads when files change, tracks categories
 * by subdirectory name fr fr
 *
 * Features:
 * - Recursive scanning of skills directory (configurable via SPECMEM_SKILLS_PATH)
 * - Auto-detection of categories from subdirectory names
 * - File watching for hot-reload on changes
 * - Metadata extraction from skill files
 * - Support for nested categories (skills/category/subcategory/skill.md)
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import chokidar from 'chokidar';
import { logger } from '../utils/logger.js';
/**
 * Default config that slaps
 * Uses environment variable or current working directory for skills path
 */
const DEFAULT_CONFIG = {
    skillsPath: process.env['SPECMEM_SKILLS_PATH'] || path.join(process.cwd(), 'skills'),
    autoReload: true,
    debounceMs: 500,
    maxDepth: 10,
    extensions: ['.md', '.markdown']
};
/**
 * SkillScanner - the BEAST that discovers all your skills
 *
 * just drop .md files in your skills directory and we handle the rest
 * categories are auto-detected from subdirectories
 */
export class SkillScanner {
    config;
    skills = new Map();
    categories = new Map();
    watcher = null;
    isWatching = false;
    changeHandlers = [];
    scanInProgress = false;
    lastScanTime = null;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * initialize - starts the scanner and optionally the watcher
     */
    async initialize() {
        logger.info({ skillsPath: this.config.skillsPath }, 'initializing skill scanner...');
        // ensure skills directory exists
        await this.ensureSkillsDirectory();
        // perform initial scan
        const result = await this.scan();
        // start watcher if auto-reload enabled
        if (this.config.autoReload) {
            await this.startWatching();
        }
        logger.info({
            skillCount: result.totalCount,
            categoryCount: result.categories.size,
            watching: this.config.autoReload
        }, 'skill scanner initialized - we ready fr fr');
        return result;
    }
    /**
     * scan - recursively scans the skills directory
     */
    async scan() {
        if (this.scanInProgress) {
            logger.warn('scan already in progress - skipping');
            return this.getResult();
        }
        this.scanInProgress = true;
        const startTime = Date.now();
        const errors = [];
        try {
            // clear existing data
            this.skills.clear();
            this.categories.clear();
            // recursively find all skill files
            const files = await this.findSkillFiles(this.config.skillsPath, 0);
            // process each file
            for (const filePath of files) {
                try {
                    const skill = await this.processSkillFile(filePath);
                    if (skill) {
                        this.skills.set(skill.id, skill);
                        // add to category map
                        const categorySkills = this.categories.get(skill.category) || [];
                        categorySkills.push(skill);
                        this.categories.set(skill.category, categorySkills);
                    }
                }
                catch (error) {
                    errors.push({ path: filePath, error: String(error) });
                    logger.warn({ error, filePath }, 'failed to process skill file');
                }
            }
            this.lastScanTime = new Date();
            const result = this.getResult();
            result.scanDuration = Date.now() - startTime;
            result.errors = errors;
            logger.info({
                totalSkills: result.totalCount,
                categories: Array.from(this.categories.keys()),
                duration: result.scanDuration
            }, 'skill scan complete');
            return result;
        }
        finally {
            this.scanInProgress = false;
        }
    }
    /**
     * findSkillFiles - recursively finds all skill files
     */
    async findSkillFiles(dirPath, depth) {
        if (depth > this.config.maxDepth) {
            return [];
        }
        const files = [];
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                // skip hidden files/directories
                if (entry.name.startsWith('.')) {
                    continue;
                }
                if (entry.isDirectory()) {
                    // recurse into subdirectory
                    const subFiles = await this.findSkillFiles(fullPath, depth + 1);
                    files.push(...subFiles);
                }
                else if (entry.isFile()) {
                    // check if it's a skill file
                    const ext = path.extname(entry.name).toLowerCase();
                    if (this.config.extensions.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        }
        catch (error) {
            logger.warn({ dirPath, error }, 'failed to read directory');
        }
        return files;
    }
    /**
     * processSkillFile - reads and parses a single skill file
     */
    async processSkillFile(filePath) {
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        // calculate relative path from skills root
        const relativePath = path.relative(this.config.skillsPath, filePath);
        const pathParts = relativePath.split(path.sep);
        // determine category from directory structure
        let category = 'general';
        let subcategory;
        if (pathParts.length > 1) {
            category = pathParts[0];
            if (pathParts.length > 2) {
                subcategory = pathParts.slice(1, -1).join('/');
            }
        }
        // extract filename without extension
        const fileName = path.basename(filePath, path.extname(filePath));
        // create readable name from filename
        const name = this.humanizeName(fileName);
        // extract description from content (first heading or paragraph)
        const description = this.extractDescription(content);
        // extract tags from content and filename
        const tags = this.extractTags(content, fileName, category);
        // create unique ID
        const id = this.createSkillId(relativePath);
        return {
            id,
            name,
            category,
            subcategory,
            filePath,
            relativePath,
            content,
            description,
            lastModified: stats.mtime,
            sizeBytes: stats.size,
            tags
        };
    }
    /**
     * humanizeName - converts filename to human-readable name
     */
    humanizeName(filename) {
        return filename
            .replace(/[-_]/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
    /**
     * extractDescription - gets first meaningful text from content
     */
    extractDescription(content) {
        const lines = content.split('\n');
        // look for first heading or non-empty paragraph
        for (const line of lines) {
            const trimmed = line.trim();
            // skip empty lines and code blocks
            if (!trimmed || trimmed.startsWith('```')) {
                continue;
            }
            // extract heading text
            if (trimmed.startsWith('#')) {
                return trimmed.replace(/^#+\s*/, '');
            }
            // use first paragraph (non-heading text)
            if (!trimmed.startsWith('-') && !trimmed.startsWith('*')) {
                return trimmed.slice(0, 200) + (trimmed.length > 200 ? '...' : '');
            }
        }
        return '';
    }
    /**
     * extractTags - finds tags from content and metadata
     */
    extractTags(content, filename, category) {
        const tags = new Set();
        // add category as tag
        tags.add(category);
        // look for tags in content (common formats)
        const tagPatterns = [
            /tags?:\s*\[([^\]]+)\]/gi, // tags: [tag1, tag2]
            /tags?:\s*(.+)$/gim, // tags: tag1, tag2
            /#(\w+)/g // #hashtags
        ];
        for (const pattern of tagPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const tagStr = match[1];
                if (tagStr) {
                    const extractedTags = tagStr.split(/[,\s]+/).filter(t => t.length > 1);
                    extractedTags.forEach(t => tags.add(t.toLowerCase().replace(/^#/, '')));
                }
            }
        }
        // add words from filename as potential tags
        const filenameWords = filename.split(/[-_]/).filter(w => w.length > 2);
        filenameWords.forEach(w => tags.add(w.toLowerCase()));
        return Array.from(tags).slice(0, 20); // limit to 20 tags
    }
    /**
     * createSkillId - generates unique ID from path
     */
    createSkillId(relativePath) {
        return relativePath
            .replace(/\\/g, '/')
            .replace(/\.(md|markdown)$/i, '')
            .replace(/[^a-zA-Z0-9/]/g, '-')
            .toLowerCase();
    }
    /**
     * startWatching - begins watching for file changes
     */
    async startWatching() {
        if (this.isWatching) {
            return;
        }
        logger.info({ skillsPath: this.config.skillsPath }, 'starting skill file watcher...');
        this.watcher = chokidar.watch(this.config.skillsPath, {
            ignored: [
                '**/node_modules/**',
                '**/.git/**',
                '**/.*'
            ],
            ignoreInitial: true,
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: this.config.debounceMs,
                pollInterval: 100
            }
        });
        // file added
        this.watcher.on('add', async (filePath) => {
            if (this.isSkillFile(filePath)) {
                await this.handleFileAdded(filePath);
            }
        });
        // file modified
        this.watcher.on('change', async (filePath) => {
            if (this.isSkillFile(filePath)) {
                await this.handleFileModified(filePath);
            }
        });
        // file removed
        this.watcher.on('unlink', async (filePath) => {
            if (this.isSkillFile(filePath)) {
                await this.handleFileRemoved(filePath);
            }
        });
        this.watcher.on('error', (error) => {
            logger.error({ error }, 'skill watcher error');
        });
        this.isWatching = true;
        logger.info('skill watcher started - hot reload enabled');
    }
    /**
     * stopWatching - stops the file watcher
     */
    async stopWatching() {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        this.isWatching = false;
        logger.info('skill watcher stopped');
    }
    /**
     * isSkillFile - checks if path is a valid skill file
     */
    isSkillFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.config.extensions.includes(ext);
    }
    /**
     * handleFileAdded - processes new skill file
     */
    async handleFileAdded(filePath) {
        try {
            const skill = await this.processSkillFile(filePath);
            if (skill) {
                this.skills.set(skill.id, skill);
                const categorySkills = this.categories.get(skill.category) || [];
                categorySkills.push(skill);
                this.categories.set(skill.category, categorySkills);
                this.emitChange({ type: 'added', skill, path: filePath, timestamp: new Date() });
                logger.info({ skillId: skill.id, category: skill.category }, 'new skill added');
            }
        }
        catch (error) {
            logger.error({ error, filePath }, 'failed to process added skill');
        }
    }
    /**
     * handleFileModified - updates existing skill
     */
    async handleFileModified(filePath) {
        try {
            const skill = await this.processSkillFile(filePath);
            if (skill) {
                const oldSkill = this.skills.get(skill.id);
                this.skills.set(skill.id, skill);
                // update category map if category changed
                if (oldSkill && oldSkill.category !== skill.category) {
                    // remove from old category
                    const oldCategorySkills = this.categories.get(oldSkill.category) || [];
                    this.categories.set(oldSkill.category, oldCategorySkills.filter(s => s.id !== skill.id));
                }
                // add/update in new category
                const categorySkills = this.categories.get(skill.category) || [];
                const existingIndex = categorySkills.findIndex(s => s.id === skill.id);
                if (existingIndex >= 0) {
                    categorySkills[existingIndex] = skill;
                }
                else {
                    categorySkills.push(skill);
                }
                this.categories.set(skill.category, categorySkills);
                this.emitChange({ type: 'modified', skill, path: filePath, timestamp: new Date() });
                logger.info({ skillId: skill.id }, 'skill updated');
            }
        }
        catch (error) {
            logger.error({ error, filePath }, 'failed to process modified skill');
        }
    }
    /**
     * handleFileRemoved - removes skill from registry
     */
    async handleFileRemoved(filePath) {
        const relativePath = path.relative(this.config.skillsPath, filePath);
        const skillId = this.createSkillId(relativePath);
        const skill = this.skills.get(skillId);
        if (skill) {
            this.skills.delete(skillId);
            // remove from category
            const categorySkills = this.categories.get(skill.category) || [];
            this.categories.set(skill.category, categorySkills.filter(s => s.id !== skillId));
            this.emitChange({ type: 'removed', skill: null, path: filePath, timestamp: new Date() });
            logger.info({ skillId }, 'skill removed');
        }
    }
    /**
     * onSkillChange - registers a change handler
     */
    onSkillChange(handler) {
        this.changeHandlers.push(handler);
        return () => {
            const index = this.changeHandlers.indexOf(handler);
            if (index >= 0) {
                this.changeHandlers.splice(index, 1);
            }
        };
    }
    /**
     * emitChange - notifies all handlers of change
     */
    emitChange(event) {
        for (const handler of this.changeHandlers) {
            try {
                handler(event);
            }
            catch (error) {
                logger.error({ error }, 'skill change handler error');
            }
        }
    }
    /**
     * ensureSkillsDirectory - creates skills directory if missing
     */
    async ensureSkillsDirectory() {
        try {
            await fs.access(this.config.skillsPath);
        }
        catch {
            logger.info({ path: this.config.skillsPath }, 'creating skills directory');
            await fs.mkdir(this.config.skillsPath, { recursive: true });
        }
    }
    /**
     * getResult - returns current scan result
     */
    getResult() {
        return {
            skills: Array.from(this.skills.values()),
            categories: new Map(this.categories),
            totalCount: this.skills.size,
            scanDuration: 0,
            errors: []
        };
    }
    // === PUBLIC API ===
    /**
     * getAllSkills - returns all discovered skills
     */
    getAllSkills() {
        return Array.from(this.skills.values());
    }
    /**
     * getSkillById - retrieves a specific skill
     */
    getSkillById(id) {
        return this.skills.get(id);
    }
    /**
     * getSkillsByCategory - returns skills in a category
     */
    getSkillsByCategory(category) {
        return this.categories.get(category) || [];
    }
    /**
     * getCategories - returns all categories
     */
    getCategories() {
        return Array.from(this.categories.keys());
    }
    /**
     * searchSkills - searches skills by query
     */
    searchSkills(query) {
        const normalizedQuery = query.toLowerCase();
        return Array.from(this.skills.values()).filter(skill => {
            return (skill.name.toLowerCase().includes(normalizedQuery) ||
                skill.description?.toLowerCase().includes(normalizedQuery) ||
                skill.content.toLowerCase().includes(normalizedQuery) ||
                skill.tags.some(tag => tag.includes(normalizedQuery)) ||
                skill.category.toLowerCase().includes(normalizedQuery));
        });
    }
    /**
     * getSkillsForContext - returns skills formatted for  context
     */
    getSkillsForContext() {
        const skills = this.getAllSkills();
        if (skills.length === 0) {
            return 'No skills currently loaded.';
        }
        const categories = this.getCategories();
        let output = `# Available Skills (${skills.length} total)\n\n`;
        for (const category of categories) {
            const categorySkills = this.getSkillsByCategory(category);
            output += `## ${category.charAt(0).toUpperCase() + category.slice(1)} (${categorySkills.length})\n\n`;
            for (const skill of categorySkills) {
                output += `### ${skill.name}\n`;
                output += `- **ID**: ${skill.id}\n`;
                output += `- **Path**: ${skill.relativePath}\n`;
                if (skill.description) {
                    output += `- **Description**: ${skill.description}\n`;
                }
                output += `- **Tags**: ${skill.tags.join(', ')}\n`;
                output += '\n';
            }
        }
        return output;
    }
    /**
     * getSkillContent - returns full content of a skill
     */
    getSkillContent(id) {
        return this.skills.get(id)?.content;
    }
    /**
     * getStats - returns scanner statistics
     */
    getStats() {
        return {
            totalSkills: this.skills.size,
            categoryCount: this.categories.size,
            isWatching: this.isWatching,
            lastScanTime: this.lastScanTime,
            skillsPath: this.config.skillsPath
        };
    }
    /**
     * shutdown - cleanup resources
     */
    async shutdown() {
        await this.stopWatching();
        this.skills.clear();
        this.categories.clear();
        this.changeHandlers = [];
        logger.info('skill scanner shut down');
    }
}
// Singleton instance
let scannerInstance = null;
/**
 * getSkillScanner - returns singleton scanner instance
 */
export function getSkillScanner(config) {
    if (!scannerInstance) {
        scannerInstance = new SkillScanner(config);
    }
    return scannerInstance;
}
/**
 * resetSkillScanner - resets the singleton (for testing)
 */
export function resetSkillScanner() {
    if (scannerInstance) {
        scannerInstance.shutdown();
        scannerInstance = null;
    }
}
//# sourceMappingURL=skillScanner.js.map