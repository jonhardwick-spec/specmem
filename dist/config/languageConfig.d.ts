/**
 * LanguageConfigEntry - configuration for each programming language
 */
export interface LanguageConfigEntry {
    id: string;
    name: string;
    extensions: string[];
    enabled: boolean;
    priority: number;
}
/**
 * DEFAULT_LANGUAGE_CONFIG - the base configuration
 * priorities based on user preferences:
 * - 10: Python, Java, Rust, C/C++ (most important)
 * - 9: TypeScript/JavaScript (very important)
 * - 8: Go
 * - 6: Vue, Svelte (frontend frameworks)
 * - 5: Ruby, PHP, Swift, Kotlin, Scala
 * - 1: C# (user hates it - lowest priority, disabled by default!)
 */
export declare const DEFAULT_LANGUAGE_CONFIG: Record<string, LanguageConfigEntry>;
/**
 * loadLanguageConfig - loads config from disk or returns defaults
 */
export declare function loadLanguageConfig(): Promise<Record<string, LanguageConfigEntry>>;
/**
 * saveLanguageConfig - persists config to disk
 */
export declare function saveLanguageConfig(config: Record<string, LanguageConfigEntry>): Promise<void>;
/**
 * getLanguageConfig - get the current language configuration
 */
export declare function getLanguageConfig(): Promise<Record<string, LanguageConfigEntry>>;
/**
 * setLanguageEnabled - enable or disable a language
 */
export declare function setLanguageEnabled(langId: string, enabled: boolean): Promise<boolean>;
/**
 * setLanguagePriority - change priority of a language (1-10)
 */
export declare function setLanguagePriority(langId: string, priority: number): Promise<boolean>;
/**
 * getEnabledLanguages - get list of enabled languages sorted by priority
 */
export declare function getEnabledLanguages(): Promise<LanguageConfigEntry[]>;
/**
 * getEnabledExtensions - get set of all enabled file extensions
 * This is what codebaseCommands.ts will use!
 */
export declare function getEnabledExtensions(): Promise<Set<string>>;
/**
 * getEnabledExtensionsSync - synchronous version for initialization
 * Uses cached config or defaults
 */
export declare function getEnabledExtensionsSync(): Set<string>;
/**
 * resetLanguageConfig - reset to defaults
 */
export declare function resetLanguageConfig(): Promise<void>;
/**
 * addCustomLanguage - add a new language to the config
 */
export declare function addCustomLanguage(entry: LanguageConfigEntry): Promise<boolean>;
/**
 * removeCustomLanguage - remove a custom language (can't remove built-in ones)
 */
export declare function removeCustomLanguage(langId: string): Promise<boolean>;
//# sourceMappingURL=languageConfig.d.ts.map