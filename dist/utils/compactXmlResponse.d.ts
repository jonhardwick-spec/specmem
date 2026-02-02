/**
 * Compact XML Response Generator
 *
 * Converts objects/arrays to ONE-LINE-PER-ITEM XML with Chinese token compression.
 * Used for MCP tool responses to maximize token efficiency.
 *
 * Philosophy: Every byte counts when you're working with context limits fr
 */
/**
 * Strip all newlines from a string and replace with spaces
 * Prevents multi-line entries in XML output
 */
export declare function stripNewlines(str: string): string;
/**
 * Options interface for compactXmlResponse
 */
export interface XmlOptions {
    root: string;
    itemTag: string;
    hint?: string;
    compress?: boolean;
}
/**
 * Main export: Convert data to compact XML
 *
 * Supports two signatures for backward compatibility:
 * 1. compactXmlResponse(data, rootTag) - legacy signature
 * 2. compactXmlResponse(data, options) - new options object signature
 *
 * @param data - Any object or array to convert
 * @param rootTagOrOptions - Root XML element name OR options object
 * @returns Compact XML string with ONE LINE PER ITEM
 *
 * Example:
 * ```typescript
 * const memories = [
 *   {id: 'abc', type: 'semantic', similarity: 0.85, content: 'Auth flow\nexplanation'},
 *   {id: 'def', type: 'procedural', similarity: 0.72, content: 'DB fix'}
 * ];
 *
 * // Legacy signature
 * compactXmlResponse(memories, 'memories');
 *
 * // New signature with options
 * compactXmlResponse(xmlData, { root: 'code', itemTag: 'p', hint: 'zoom=0-100' });
 *
 * // Output:
 * // <memories n="2">
 * // <m id="abc" t="semantic" s="0.85" c="Auth flow explanation"/>
 * // <m id="def" t="procedural" s="0.72" c="DB fix"/>
 * // </memories>
 * ```
 */
export declare function compactXmlResponse(data: any, rootTagOrOptions?: string | XmlOptions): string;
/**
 * Helper: Create compact XML for search results
 * Optimized format for memory/code search responses
 */
export declare function compactSearchResults(results: any[], type?: 'memory' | 'code'): string;
//# sourceMappingURL=compactXmlResponse.d.ts.map