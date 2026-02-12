/**
 * skillsResource.ts - MCP Resource Provider for Skills
 *
 * exposes all skills as MCP resources so  can access them
 * provides list and read endpoints for the MCP protocol
 *
 * Features:
 * - Dynamic resource listing from skill scanner
 * - Individual skill content access
 * - Category-based organization
 * - Auto-update when skills change
 */
import { Resource, TextResourceContents } from '@modelcontextprotocol/sdk/types.js';
import { SkillScanner } from './skillScanner.js';
type SkillResourceContents = TextResourceContents;
/**
 * SkillResourceProvider - provides MCP resources for skills
 */
export declare class SkillResourceProvider {
    private scanner;
    private baseUri;
    constructor(scanner?: SkillScanner);
    /**
     * getResources - returns all skills as MCP resources
     */
    getResources(): Resource[];
    /**
     * readResource - reads content for a specific resource URI
     */
    readResource(uri: string): Promise<SkillResourceContents>;
    /**
     * getSkillListContent - generates master skill list
     */
    private getSkillListContent;
    /**
     * getCategoriesContent - generates category index
     */
    private getCategoriesContent;
    /**
     * getCategoryContent - generates content for a specific category
     */
    private getCategoryContent;
    /**
     * getSkillContent - returns full skill content
     */
    private getSkillContent;
    /**
     * capitalize - capitalizes first letter
     */
    private capitalize;
    /**
     * getSkillSummaryForPrompt - returns a compact summary for system prompts
     */
    getSkillSummaryForPrompt(): string;
    /**
     * getAllSkillsContent - returns ALL skill content combined (for context)
     */
    getAllSkillsContent(): string;
}
/**
 * getSkillResourceProvider - returns singleton provider
 */
export declare function getSkillResourceProvider(scanner?: SkillScanner): SkillResourceProvider;
/**
 * resetSkillResourceProvider - resets singleton (for testing)
 */
export declare function resetSkillResourceProvider(): void;
export {};
//# sourceMappingURL=skillsResource.d.ts.map