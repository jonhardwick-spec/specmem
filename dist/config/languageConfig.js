// yooo this is the CONFIGURABLE language support system
// no more hardcoded extensions - now we can toggle and prioritize languages
// user preferences matter fr fr
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
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
export const DEFAULT_LANGUAGE_CONFIG = {
    // TIER 1 - the absolute goats (priority 10)
    python: {
        id: 'python',
        name: 'Python',
        extensions: ['.py', '.pyw', '.pyx', '.pxd', '.pyi'],
        enabled: true,
        priority: 10
    },
    java: {
        id: 'java',
        name: 'Java',
        extensions: ['.java'],
        enabled: true,
        priority: 10
    },
    rust: {
        id: 'rust',
        name: 'Rust',
        extensions: ['.rs'],
        enabled: true,
        priority: 10
    },
    c: {
        id: 'c',
        name: 'C',
        extensions: ['.c', '.h'],
        enabled: true,
        priority: 10
    },
    cpp: {
        id: 'cpp',
        name: 'C++',
        extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.h++', '.c++'],
        enabled: true,
        priority: 10
    },
    // TIER 2 - very important (priority 9)
    typescript: {
        id: 'typescript',
        name: 'TypeScript',
        extensions: ['.ts', '.tsx', '.mts', '.cts'],
        enabled: true,
        priority: 9
    },
    javascript: {
        id: 'javascript',
        name: 'JavaScript',
        extensions: ['.js', '.jsx', '.mjs', '.cjs'],
        enabled: true,
        priority: 9
    },
    // TIER 3 - important (priority 8)
    go: {
        id: 'go',
        name: 'Go',
        extensions: ['.go'],
        enabled: true,
        priority: 8
    },
    // TIER 4 - frontend frameworks (priority 6)
    vue: {
        id: 'vue',
        name: 'Vue',
        extensions: ['.vue'],
        enabled: true,
        priority: 6
    },
    svelte: {
        id: 'svelte',
        name: 'Svelte',
        extensions: ['.svelte'],
        enabled: true,
        priority: 6
    },
    // TIER 5 - mid tier languages (priority 5)
    ruby: {
        id: 'ruby',
        name: 'Ruby',
        extensions: ['.rb', '.rake', '.gemspec', '.ru'],
        enabled: true,
        priority: 5
    },
    php: {
        id: 'php',
        name: 'PHP',
        extensions: ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'],
        enabled: true,
        priority: 5
    },
    swift: {
        id: 'swift',
        name: 'Swift',
        extensions: ['.swift'],
        enabled: true,
        priority: 5
    },
    kotlin: {
        id: 'kotlin',
        name: 'Kotlin',
        extensions: ['.kt', '.kts'],
        enabled: true,
        priority: 5
    },
    scala: {
        id: 'scala',
        name: 'Scala',
        extensions: ['.scala', '.sc'],
        enabled: true,
        priority: 5
    },
    // TIER 6 - the one we hate (priority 1, disabled by default)
    csharp: {
        id: 'csharp',
        name: 'C# (ew)',
        extensions: ['.cs', '.csx'],
        enabled: false, // DISABLED BY DEFAULT - user hates this language
        priority: 1
    },
    // Additional languages - mid tier (priority 5)
    shell: {
        id: 'shell',
        name: 'Shell',
        extensions: ['.sh', '.bash', '.zsh', '.fish'],
        enabled: true,
        priority: 5
    },
    powershell: {
        id: 'powershell',
        name: 'PowerShell',
        extensions: ['.ps1', '.psm1', '.psd1'],
        enabled: true,
        priority: 5
    },
    sql: {
        id: 'sql',
        name: 'SQL',
        extensions: ['.sql'],
        enabled: true,
        priority: 5
    },
    graphql: {
        id: 'graphql',
        name: 'GraphQL',
        extensions: ['.graphql', '.gql'],
        enabled: true,
        priority: 5
    },
    r: {
        id: 'r',
        name: 'R',
        extensions: ['.r', '.R', '.Rmd'],
        enabled: true,
        priority: 5
    },
    julia: {
        id: 'julia',
        name: 'Julia',
        extensions: ['.jl'],
        enabled: true,
        priority: 5
    },
    elixir: {
        id: 'elixir',
        name: 'Elixir',
        extensions: ['.ex', '.exs'],
        enabled: true,
        priority: 5
    },
    haskell: {
        id: 'haskell',
        name: 'Haskell',
        extensions: ['.hs', '.lhs'],
        enabled: true,
        priority: 5
    },
    clojure: {
        id: 'clojure',
        name: 'Clojure',
        extensions: ['.clj', '.cljs', '.cljc', '.edn'],
        enabled: true,
        priority: 5
    },
    lua: {
        id: 'lua',
        name: 'Lua',
        extensions: ['.lua'],
        enabled: true,
        priority: 5
    },
    perl: {
        id: 'perl',
        name: 'Perl',
        extensions: ['.pl', '.pm', '.pod'],
        enabled: true,
        priority: 5
    },
    dart: {
        id: 'dart',
        name: 'Dart',
        extensions: ['.dart'],
        enabled: true,
        priority: 5
    },
    objectivec: {
        id: 'objectivec',
        name: 'Objective-C',
        extensions: ['.m', '.mm'],
        enabled: true,
        priority: 5
    },
    erlang: {
        id: 'erlang',
        name: 'Erlang',
        extensions: ['.erl', '.hrl'],
        enabled: true,
        priority: 5
    },
    // Config/DevOps languages (priority 4)
    terraform: {
        id: 'terraform',
        name: 'Terraform',
        extensions: ['.tf', '.tfvars'],
        enabled: true,
        priority: 4
    },
    cmake: {
        id: 'cmake',
        name: 'CMake',
        extensions: ['.cmake'],
        enabled: true,
        priority: 4
    },
    gradle: {
        id: 'gradle',
        name: 'Gradle',
        extensions: ['.gradle'],
        enabled: true,
        priority: 4
    },
    // Web markup (priority 4)
    html: {
        id: 'html',
        name: 'HTML',
        extensions: ['.html', '.htm', '.xhtml'],
        enabled: true,
        priority: 4
    },
    css: {
        id: 'css',
        name: 'CSS',
        extensions: ['.css'],
        enabled: true,
        priority: 4
    },
    scss: {
        id: 'scss',
        name: 'SCSS',
        extensions: ['.scss'],
        enabled: true,
        priority: 4
    },
    less: {
        id: 'less',
        name: 'Less',
        extensions: ['.less'],
        enabled: true,
        priority: 4
    }
};
// In-memory config cache
let currentConfig = null;
/**
 * getConfigFilePath - returns path to language config file
 */
function getConfigFilePath() {
    const homeDir = os.homedir();
    return path.join(homeDir, '.specmem', 'language-config.json');
}
/**
 * ensureConfigDirectory - make sure ~/.specmem exists
 */
async function ensureConfigDirectory() {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.specmem');
    try {
        await fs.mkdir(configDir, { recursive: true });
    }
    catch {
        // directory already exists, we good
    }
}
/**
 * loadLanguageConfig - loads config from disk or returns defaults
 */
export async function loadLanguageConfig() {
    if (currentConfig) {
        return currentConfig;
    }
    const configPath = getConfigFilePath();
    try {
        const content = await fs.readFile(configPath, 'utf-8');
        const savedConfig = JSON.parse(content);
        // merge with defaults to handle any new languages added
        currentConfig = { ...DEFAULT_LANGUAGE_CONFIG };
        for (const [key, value] of Object.entries(savedConfig)) {
            if (currentConfig[key]) {
                currentConfig[key] = { ...currentConfig[key], ...value };
            }
            else {
                currentConfig[key] = value;
            }
        }
        logger.debug({ configPath }, 'loaded language config from file');
        return currentConfig;
    }
    catch {
        // file doesn't exist or is invalid, use defaults
        currentConfig = { ...DEFAULT_LANGUAGE_CONFIG };
        logger.debug('using default language config');
        return currentConfig;
    }
}
/**
 * saveLanguageConfig - persists config to disk
 */
export async function saveLanguageConfig(config) {
    await ensureConfigDirectory();
    const configPath = getConfigFilePath();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    // update cache
    currentConfig = config;
    logger.info({ configPath }, 'saved language config to file');
}
/**
 * getLanguageConfig - get the current language configuration
 */
export async function getLanguageConfig() {
    return loadLanguageConfig();
}
/**
 * setLanguageEnabled - enable or disable a language
 */
export async function setLanguageEnabled(langId, enabled) {
    const config = await loadLanguageConfig();
    if (!config[langId]) {
        logger.warn({ langId }, 'language not found in config');
        return false;
    }
    config[langId].enabled = enabled;
    await saveLanguageConfig(config);
    logger.info({ langId, enabled }, 'language enabled state changed');
    return true;
}
/**
 * setLanguagePriority - change priority of a language (1-10)
 */
export async function setLanguagePriority(langId, priority) {
    const config = await loadLanguageConfig();
    if (!config[langId]) {
        logger.warn({ langId }, 'language not found in config');
        return false;
    }
    // clamp priority to 1-10
    const clampedPriority = Math.max(1, Math.min(10, priority));
    config[langId].priority = clampedPriority;
    await saveLanguageConfig(config);
    logger.info({ langId, priority: clampedPriority }, 'language priority changed');
    return true;
}
/**
 * getEnabledLanguages - get list of enabled languages sorted by priority
 */
export async function getEnabledLanguages() {
    const config = await loadLanguageConfig();
    return Object.values(config)
        .filter(lang => lang.enabled)
        .sort((a, b) => b.priority - a.priority); // higher priority first
}
/**
 * getEnabledExtensions - get set of all enabled file extensions
 * This is what codebaseCommands.ts will use!
 */
export async function getEnabledExtensions() {
    const config = await loadLanguageConfig();
    const extensions = new Set();
    for (const lang of Object.values(config)) {
        if (lang.enabled) {
            for (const ext of lang.extensions) {
                extensions.add(ext);
            }
        }
    }
    return extensions;
}
/**
 * getEnabledExtensionsSync - synchronous version for initialization
 * Uses cached config or defaults
 */
export function getEnabledExtensionsSync() {
    const config = currentConfig ?? DEFAULT_LANGUAGE_CONFIG;
    const extensions = new Set();
    for (const lang of Object.values(config)) {
        if (lang.enabled) {
            for (const ext of lang.extensions) {
                extensions.add(ext);
            }
        }
    }
    return extensions;
}
/**
 * resetLanguageConfig - reset to defaults
 */
export async function resetLanguageConfig() {
    currentConfig = { ...DEFAULT_LANGUAGE_CONFIG };
    await saveLanguageConfig(currentConfig);
    logger.info('language config reset to defaults');
}
/**
 * addCustomLanguage - add a new language to the config
 */
export async function addCustomLanguage(entry) {
    const config = await loadLanguageConfig();
    if (config[entry.id]) {
        logger.warn({ langId: entry.id }, 'language already exists');
        return false;
    }
    config[entry.id] = entry;
    await saveLanguageConfig(config);
    logger.info({ langId: entry.id }, 'custom language added');
    return true;
}
/**
 * removeCustomLanguage - remove a custom language (can't remove built-in ones)
 */
export async function removeCustomLanguage(langId) {
    const config = await loadLanguageConfig();
    if (!config[langId]) {
        logger.warn({ langId }, 'language not found');
        return false;
    }
    if (DEFAULT_LANGUAGE_CONFIG[langId]) {
        logger.warn({ langId }, 'cannot remove built-in language');
        return false;
    }
    delete config[langId];
    await saveLanguageConfig(config);
    logger.info({ langId }, 'custom language removed');
    return true;
}
// Initialize config on module load
loadLanguageConfig().catch(() => {
    // silent fail on init, will use defaults
});
//# sourceMappingURL=languageConfig.js.map