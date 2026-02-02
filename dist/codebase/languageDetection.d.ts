/**
 * LanguageInfo - what we know about a detected language
 */
export interface LanguageInfo {
    id: string;
    name: string;
    extensions: string[];
    aliases: string[];
    type: 'programming' | 'markup' | 'data' | 'config' | 'prose';
    lineCommentStart?: string;
    blockCommentStart?: string;
    blockCommentEnd?: string;
    supportsEmbeddings: boolean;
}
/**
 * the BIG language registry - all the langs we recognize
 * ordered roughly by popularity cuz why not
 */
declare const LANGUAGE_REGISTRY: Record<string, LanguageInfo>;
declare const FILENAME_MAPPINGS: Record<string, string>;
declare const EXTENSION_INDEX: Map<string, string>;
/**
 * WhatLanguageIsThis - the language detection engine
 *
 * detection priority:
 * 1. filename exact match (Dockerfile, Makefile, etc)
 * 2. file extension
 * 3. shebang line (#!/usr/bin/env python)
 * 4. content heuristics (fallback)
 */
export declare class WhatLanguageIsThis {
    private stats;
    /**
     * detect - main detection function
     */
    detect(filePath: string, content?: string): LanguageInfo;
    /**
     * detectFromExtension - just checks extension
     */
    detectFromExtension(filePath: string): LanguageInfo | null;
    /**
     * getLanguageById - get info for a known language
     */
    getLanguageById(id: string): LanguageInfo | null;
    /**
     * getAllLanguages - returns all known languages
     */
    getAllLanguages(): LanguageInfo[];
    /**
     * getProgrammingLanguages - just the programming ones
     */
    getProgrammingLanguages(): LanguageInfo[];
    /**
     * getStats - detection statistics
     */
    getStats(): {
        detected: number;
        byExtension: number;
        byFilename: number;
        byShebang: number;
        byHeuristics: number;
        unknown: number;
    };
    /**
     * resetStats - clear statistics
     */
    resetStats(): void;
    private detectFromShebang;
    private detectFromContent;
    private looksLikeJson;
}
export declare function getLanguageDetector(): WhatLanguageIsThis;
export declare function resetLanguageDetector(): void;
export { LANGUAGE_REGISTRY, EXTENSION_INDEX, FILENAME_MAPPINGS };
//# sourceMappingURL=languageDetection.d.ts.map