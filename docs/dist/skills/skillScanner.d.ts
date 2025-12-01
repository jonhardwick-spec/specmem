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
/**
 * Skill - represents a single skill file
 */
export interface Skill {
    id: string;
    name: string;
    category: string;
    subcategory?: string;
    filePath: string;
    relativePath: string;
    content: string;
    description?: string;
    lastModified: Date;
    sizeBytes: number;
    tags: string[];
}
/**
 * SkillScannerConfig - configuration options
 */
export interface SkillScannerConfig {
    skillsPath: string;
    autoReload: boolean;
    debounceMs: number;
    maxDepth: number;
    extensions: string[];
}
/**
 * SkillScanResult - result of a scan operation
 */
export interface SkillScanResult {
    skills: Skill[];
    categories: Map<string, Skill[]>;
    totalCount: number;
    scanDuration: number;
    errors: Array<{
        path: string;
        error: string;
    }>;
}
/**
 * SkillChangeEvent - emitted when skills change
 */
export interface SkillChangeEvent {
    type: 'added' | 'modified' | 'removed';
    skill: Skill | null;
    path: string;
    timestamp: Date;
}
export type SkillChangeHandler = (event: SkillChangeEvent) => void;
/**
 * SkillScanner - the BEAST that discovers all your skills
 *
 * just drop .md files in your skills directory and we handle the rest
 * categories are auto-detected from subdirectories
 */
export declare class SkillScanner {
    private config;
    private skills;
    private categories;
    private watcher;
    private isWatching;
    private changeHandlers;
    private scanInProgress;
    private lastScanTime;
    constructor(config?: Partial<SkillScannerConfig>);
    /**
     * initialize - starts the scanner and optionally the watcher
     */
    initialize(): Promise<SkillScanResult>;
    /**
     * scan - recursively scans the skills directory
     */
    scan(): Promise<SkillScanResult>;
    /**
     * findSkillFiles - recursively finds all skill files
     */
    private findSkillFiles;
    /**
     * processSkillFile - reads and parses a single skill file
     */
    private processSkillFile;
    /**
     * humanizeName - converts filename to human-readable name
     */
    private humanizeName;
    /**
     * extractDescription - gets first meaningful text from content
     */
    private extractDescription;
    /**
     * extractTags - finds tags from content and metadata
     */
    private extractTags;
    /**
     * createSkillId - generates unique ID from path
     */
    private createSkillId;
    /**
     * startWatching - begins watching for file changes
     */
    private startWatching;
    /**
     * stopWatching - stops the file watcher
     */
    stopWatching(): Promise<void>;
    /**
     * isSkillFile - checks if path is a valid skill file
     */
    private isSkillFile;
    /**
     * handleFileAdded - processes new skill file
     */
    private handleFileAdded;
    /**
     * handleFileModified - updates existing skill
     */
    private handleFileModified;
    /**
     * handleFileRemoved - removes skill from registry
     */
    private handleFileRemoved;
    /**
     * onSkillChange - registers a change handler
     */
    onSkillChange(handler: SkillChangeHandler): () => void;
    /**
     * emitChange - notifies all handlers of change
     */
    private emitChange;
    /**
     * ensureSkillsDirectory - creates skills directory if missing
     */
    private ensureSkillsDirectory;
    /**
     * getResult - returns current scan result
     */
    private getResult;
    /**
     * getAllSkills - returns all discovered skills
     */
    getAllSkills(): Skill[];
    /**
     * getSkillById - retrieves a specific skill
     */
    getSkillById(id: string): Skill | undefined;
    /**
     * getSkillsByCategory - returns skills in a category
     */
    getSkillsByCategory(category: string): Skill[];
    /**
     * getCategories - returns all categories
     */
    getCategories(): string[];
    /**
     * searchSkills - searches skills by query
     */
    searchSkills(query: string): Skill[];
    /**
     * getSkillsForContext - returns skills formatted for Claude context
     */
    getSkillsForContext(): string;
    /**
     * getSkillContent - returns full content of a skill
     */
    getSkillContent(id: string): string | undefined;
    /**
     * getStats - returns scanner statistics
     */
    getStats(): {
        totalSkills: number;
        categoryCount: number;
        isWatching: boolean;
        lastScanTime: Date | null;
        skillsPath: string;
    };
    /**
     * shutdown - cleanup resources
     */
    shutdown(): Promise<void>;
}
/**
 * getSkillScanner - returns singleton scanner instance
 */
export declare function getSkillScanner(config?: Partial<SkillScannerConfig>): SkillScanner;
/**
 * resetSkillScanner - resets the singleton (for testing)
 */
export declare function resetSkillScanner(): void;
//# sourceMappingURL=skillScanner.d.ts.map