/**
 * codeAnalyzer.ts - Advanced Code Analysis for Semantic Search
 *
 * yo this analyzer SLAPS - extracts definitions, dependencies, chunks, and complexity
 * from code files for storage in PostgreSQL with vector embeddings
 *
 * Features:
 * - Function/class/variable definition extraction
 * - Import/dependency tracking
 * - Code chunking for semantic search
 * - Complexity metrics calculation
 * - Multi-language support (TypeScript, JavaScript, Python, etc.)
 */
/**
 * CodeDefinition - represents a function, class, variable, etc.
 */
export interface CodeDefinition {
    id: string;
    fileId: string;
    filePath: string;
    name: string;
    qualifiedName?: string;
    definitionType: DefinitionType;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
    signature?: string;
    docstring?: string;
    returnType?: string;
    visibility: VisibilityType;
    isExported: boolean;
    isAsync: boolean;
    isStatic: boolean;
    isAbstract: boolean;
    parentDefinitionId?: string;
    parameters: ParameterInfo[];
    language: string;
    decorators: string[];
    metadata: Record<string, unknown>;
}
/**
 * CodeDependency - represents an import/require statement
 */
export interface CodeDependency {
    id: string;
    sourceFileId: string;
    sourceFilePath: string;
    targetPath: string;
    resolvedPath?: string;
    targetFileId?: string;
    importType: ImportType;
    importStatement: string;
    importedNames: string[];
    importedAs: string[];
    isDefaultImport: boolean;
    isNamespaceImport: boolean;
    isTypeImport: boolean;
    isSideEffectImport: boolean;
    lineNumber: number;
    columnNumber?: number;
    isExternal: boolean;
    isBuiltin: boolean;
    isRelative: boolean;
    isAbsolute: boolean;
    isDynamic: boolean;
    packageName?: string;
    packageVersion?: string;
    language: string;
    metadata: Record<string, unknown>;
}
/**
 * CodeChunk - a chunk of code for semantic search
 */
export interface CodeChunk {
    id: string;
    fileId: string;
    filePath: string;
    chunkIndex: number;
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
    content: string;
    language: string;
    chunkType: ChunkType;
    contextBefore?: string;
    contextAfter?: string;
    metadata: Record<string, unknown>;
    embedding?: number[];
}
/**
 * CodeComplexity - complexity metrics for a file or definition
 */
export interface CodeComplexity {
    id: string;
    fileId: string;
    filePath: string;
    definitionId?: string;
    definitionName?: string;
    scopeType: ScopeType;
    linesOfCode: number;
    logicalLines: number;
    commentLines: number;
    blankLines: number;
    cyclomaticComplexity?: number;
    cognitiveComplexity?: number;
    halsteadDifficulty?: number;
    halsteadEffort?: number;
    halsteadVolume?: number;
    maintainabilityIndex?: number;
    parameterCount?: number;
    returnStatementCount?: number;
    nestingDepth?: number;
    couplingScore?: number;
    issuesCount: number;
    issues: CodeIssue[];
    duplicateBlocks: number;
    duplicateLines: number;
    language: string;
    metadata: Record<string, unknown>;
    analyzedAt: Date;
    analyzerVersion: string;
}
/**
 * CodeIssue - a potential code quality issue
 */
export interface CodeIssue {
    type: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    line?: number;
    column?: number;
}
/**
 * ParameterInfo - function/method parameter details
 */
export interface ParameterInfo {
    name: string;
    type?: string;
    defaultValue?: string;
    optional?: boolean;
}
/**
 * AnalysisResult - complete analysis of a file
 */
export interface AnalysisResult {
    fileId: string;
    filePath: string;
    language: string;
    definitions: CodeDefinition[];
    dependencies: CodeDependency[];
    chunks: CodeChunk[];
    complexity: CodeComplexity;
    analyzedAt: Date;
}
export type DefinitionType = 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'constant' | 'property' | 'getter' | 'setter' | 'constructor' | 'decorator' | 'module' | 'namespace' | 'trait' | 'struct' | 'protocol' | 'extension' | 'mixin' | 'alias';
export type VisibilityType = 'public' | 'private' | 'protected' | 'internal' | 'package';
export type ImportType = 'import' | 'require' | 'include' | 'from' | 'dynamic' | 'import_type' | 'import_value' | 'reexport' | 'side_effect';
export type ChunkType = 'code' | 'comment' | 'docstring' | 'mixed' | 'import' | 'definition';
export type ScopeType = 'file' | 'function' | 'method' | 'class' | 'module' | 'chunk';
/**
 * CodeAnalyzer - extracts semantic information from code
 *
 * yo this class is the BRAIN of semantic code search
 * parses code and extracts definitions, dependencies, chunks
 */
export declare class CodeAnalyzer {
    private readonly chunkSize;
    private readonly chunkOverlap;
    private readonly analyzerVersion;
    constructor(options?: {
        chunkSize?: number;
        chunkOverlap?: number;
    });
    /**
     * analyzeFile - performs complete analysis of a code file
     */
    analyzeFile(fileId: string, filePath: string, content: string, language: string): Promise<AnalysisResult>;
    /**
     * extractDefinitions - extracts function/class/variable definitions
     */
    private extractDefinitions;
    /**
     * extractTSJSDefinitions - extracts TypeScript/JavaScript definitions
     *
     * Uses a definition stack to track nested functions/classes/methods
     * so inner functions get proper parentDefinitionId linkage
     */
    private extractTSJSDefinitions;
    /**
     * extractPythonDefinitions - extracts Python definitions
     *
     * Uses indentation-based stack to track nested functions/classes
     * Python's indentation makes this cleaner than brace-based languages
     */
    private extractPythonDefinitions;
    /**
     * extractGoDefinitions - extracts Go definitions
     */
    private extractGoDefinitions;
    /**
     * extractRustDefinitions - extracts Rust definitions
     */
    private extractRustDefinitions;
    /**
     * extractGenericDefinitions - generic extraction for unknown languages
     */
    private extractGenericDefinitions;
    /**
     * extractDependencies - extracts import/require statements
     */
    private extractDependencies;
    /**
     * extractTSJSDependencies - extracts TypeScript/JavaScript imports
     */
    private extractTSJSDependencies;
    /**
     * extractPythonDependencies - extracts Python imports
     */
    private extractPythonDependencies;
    /**
     * extractGoDependencies - extracts Go imports
     */
    private extractGoDependencies;
    /**
     * extractRustDependencies - extracts Rust use statements
     */
    private extractRustDependencies;
    /**
     * extractGenericDependencies - generic extraction for unknown languages
     */
    private extractGenericDependencies;
    /**
     * createChunks - splits code into chunks for semantic search
     */
    private createChunks;
    /**
     * determineChunkType - determines the type of a code chunk
     */
    private determineChunkType;
    /**
     * calculateComplexity - calculates complexity metrics for a file
     */
    private calculateComplexity;
    private createDefinition;
    private createDependency;
    private createChunk;
    private parseParameters;
    private parsePythonParameters;
    private detectVisibility;
    private classifyImport;
    private isComment;
    private isImport;
}
/**
 * getCodeAnalyzer - returns project-scoped analyzer instance
 * uses Map<projectPath, CodeAnalyzer> pattern for proper isolation
 */
export declare function getCodeAnalyzer(options?: {
    chunkSize?: number;
    chunkOverlap?: number;
}, projectPath?: string): CodeAnalyzer;
/**
 * resetCodeAnalyzer - resets the analyzer for a specific project (for testing)
 */
export declare function resetCodeAnalyzer(projectPath?: string): void;
/**
 * resetAllCodeAnalyzers - resets all project analyzers (for testing)
 */
export declare function resetAllCodeAnalyzers(): void;
//# sourceMappingURL=codeAnalyzer.d.ts.map