/**
 * Compact XML Response Generator
 *
 * Converts objects/arrays to ONE-LINE-PER-ITEM XML with Chinese token compression.
 * Used for MCP tool responses to maximize token efficiency.
 *
 * Philosophy: Every byte counts when you're working with context limits fr
 */
import { smartCompress } from './tokenCompressor.js';
/**
 * Strip all newlines from a string and replace with spaces
 * Prevents multi-line entries in XML output
 */
export function stripNewlines(str) {
    if (typeof str !== 'string')
        return String(str);
    return str.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}
/**
 * Escape XML special characters
 * Prevents broken XML from user content
 */
function escapeXml(str) {
    if (typeof str !== 'string')
        return String(str);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
/**
 * Convert any value to compact XML attribute format
 * Numbers, booleans, short strings become attributes
 */
function toAttribute(key, value) {
    if (value === null || value === undefined)
        return '';
    // shorten common keys for token efficiency
    // Map common keys to ultra-short versions for max token savings
    const keyMap = {
        'importance': 'imp',
        'similarity': 's',
        'content': 'c',
        'timestamp': 'ts',
        'type': 't',
        'drilldownID': 'id',
        'file': 'f',
        'filePath': 'f',
        'line': 'l',
        'preview': 'p',
        'memoryID': 'mid',
        'sessionID': 'sid',
        'created': 'cr',
        'accessed': 'acc',
        'count': 'n'
    };
    const shortKey = keyMap[key] || key;
    if (typeof value === 'boolean') {
        return value ? ` ${shortKey}="1"` : '';
    }
    if (typeof value === 'number') {
        return ` ${shortKey}="${value}"`;
    }
    if (typeof value === 'string') {
        const cleaned = stripNewlines(value);
        const compressed = smartCompress(cleaned).result;
        const escaped = escapeXml(compressed);
        // only include as attribute if reasonably short
        if (escaped.length < 200) {
            return ` ${shortKey}="${escaped}"`;
        }
    }
    return '';
}
/**
 * Convert object to compact XML element (single line)
 * Format: <tag attr1="val1" attr2="val2">text content</tag>
 */
function objectToXmlLine(obj, tag = 'm') {
    if (typeof obj !== 'object' || obj === null) {
        const escaped = escapeXml(String(obj));
        return `<${tag}>${escaped}</${tag}>`;
    }
    let attrs = '';
    let textContent = '';
    const childElements = [];
    for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined)
            continue;
        // arrays and objects become child elements
        if (Array.isArray(value)) {
            for (const item of value) {
                childElements.push(objectToXmlLine(item, key));
            }
        }
        else if (typeof value === 'object') {
            childElements.push(objectToXmlLine(value, key));
        }
        else if (key === 'content' && typeof value === 'string') {
            // content is special - goes in text node if not too long
            const cleaned = stripNewlines(value);
            const compressed = smartCompress(cleaned).result;
            if (compressed.length < 500) {
                textContent = escapeXml(compressed);
            }
            else {
                // too long for inline, use attribute with truncation
                attrs += ` c="${escapeXml(compressed.substring(0, 200))}..."`;
            }
        }
        else {
            attrs += toAttribute(key, value);
        }
    }
    // build the line
    if (childElements.length > 0) {
        return `<${tag}${attrs}>${childElements.join('')}</${tag}>`;
    }
    else if (textContent) {
        return `<${tag}${attrs}>${textContent}</${tag}>`;
    }
    else {
        return `<${tag}${attrs}/>`;
    }
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
export function compactXmlResponse(data, rootTagOrOptions = 'response') {
    // Determine if we're using new options signature or legacy string signature
    let rootTag;
    let itemTag;
    let hint;
    if (typeof rootTagOrOptions === 'object') {
        // New signature: options object
        rootTag = rootTagOrOptions.root;
        itemTag = rootTagOrOptions.itemTag || 'm';
        hint = rootTagOrOptions.hint;
        // Note: compress is handled by toAttribute which already uses smartCompress
    }
    else {
        // Legacy signature: simple root tag string
        rootTag = rootTagOrOptions;
        itemTag = 'm';
        hint = 'drill_down(id) for full content';
    }
    if (Array.isArray(data)) {
        const items = data.map(item => objectToXmlLine(item, itemTag));
        const count = data.length;
        const hintAttr = hint ? ` hint="${hint}"` : '';
        // ONE LINE per item, no embedded newlines
        return `<${rootTag} n="${count}"${hintAttr}>${items.join('')}</${rootTag}>`;
    }
    if (typeof data === 'object' && data !== null) {
        // Single object on one line
        return `<${rootTag}>${objectToXmlLine(data, itemTag)}</${rootTag}>`;
    }
    // primitive value
    const escaped = escapeXml(String(data));
    return `<${rootTag}>${escaped}</${rootTag}>`;
}
/**
 * Helper: Create compact XML for search results
 * Optimized format for memory/code search responses
 */
export function compactSearchResults(results, type = 'memory') {
    const tag = type === 'memory' ? 'memories' : 'code';
    const itemTag = type === 'memory' ? 'm' : 'c';
    if (results.length === 0) {
        return `<${tag} n="0">No results found</${tag}>`;
    }
    const items = results.map(r => objectToXmlLine(r, itemTag));
    const hint = type === 'memory'
        ? 'Use drill_down(id) for full context'
        : 'Use get_memory(id) or Read tool for full code';
    // ONE LINE per item, no embedded newlines
    return `<${tag} n="${results.length}" hint="${hint}">${items.join('')}</${tag}>`;
}
//# sourceMappingURL=compactXmlResponse.js.map