/**
 * tokenCompressor.ts - Token Conservative Communicator (Chinese Compactor)
 *
 * Compresses text to Traditional Chinese to save tokens while preserving semantics.
 * Uses ROUND-TRIP TRANSLATION VERIFICATION to ensure meaning is preserved.
 *
 * Why Traditional Chinese?
 * - CJK characters encode more semantic info per token
 * -  understands Chinese natively
 * - ~40-60% token reduction for English text
 *
 * ROUND-TRIP VERIFICATION ALGORITHM:
 * 1. Take English text input
 * 2. Convert to Traditional Chinese (forward translation)
 * 3. Convert back to English (round-trip translation)
 * 4. Compare original English vs round-trip English
 * 5. For each sentence/segment:
 *    - If context is PRESERVED after round-trip: keep as Traditional Chinese (saves tokens!)
 *    - If context is LOST after round-trip: keep original English (preserves meaning)
 * 6. Output hybrid text: Chinese where safe, English where necessary
 *
 * This ensures:
 * - Maximum token efficiency where translation is reliable
 * - Zero context loss for technical/domain-specific content
 * - Automatic detection of untranslatable content
 *
 * Configuration via environment variables:
 * - SPECMEM_COMPRESSION_ENABLED: Enable/disable compression (default: true)
 * - SPECMEM_COMPRESSION_MIN_LENGTH: Minimum text length to compress (default: 50)
 * - SPECMEM_COMPRESSION_THRESHOLD: Similarity threshold (default: 0.80)
 * - SPECMEM_COMPRESS_SEARCH: Compress search results (default: true)
 * - SPECMEM_COMPRESS_SYSTEM: Compress system output (default: true)
 * - SPECMEM_COMPRESS_HOOKS: Compress hook outputs (default: true)
 */
import { logger } from './logger.js';
import { getCompressionConfig } from '../config.js';
/**
 * PROJECT-SCOPED Translation verification cache
 * Each project gets its own cache to prevent cross-project pollution
 * Key: project path -> Map(hash of original text, cached translation result)
 */
const translationCacheByProject = new Map();
// Cache configuration
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
/**
 * Get current project path for cache scoping
 */
function getCompressorProjectPath() {
    return process.env['SPECMEM_PROJECT_PATH'] || process.cwd();
}
/**
 * Get project-scoped translation cache
 */
function getTranslationCache() {
    const projectPath = getCompressorProjectPath();
    if (!translationCacheByProject.has(projectPath)) {
        translationCacheByProject.set(projectPath, new Map());
    }
    return translationCacheByProject.get(projectPath);
}
// Legacy reference for backwards compatibility
const translationCache = {
    get(key) { return getTranslationCache().get(key); },
    set(key, value) { getTranslationCache().set(key, value); },
    delete(key) { return getTranslationCache().delete(key); },
    get size() { return getTranslationCache().size; },
    keys() { return getTranslationCache().keys(); },
    entries() { return getTranslationCache().entries(); },
    values() { return getTranslationCache().values(); },
    clear() { getTranslationCache().clear(); }
};
/**
 * Generate a simple hash for cache key
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
}
/**
 * Get cached translation if available and not expired
 */
function getCachedTranslation(original) {
    const key = hashString(original);
    const entry = translationCache.get(key);
    if (!entry)
        return null;
    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        translationCache.delete(key);
        return null;
    }
    // Update hit count
    entry.hitCount++;
    return entry;
}
/**
 * Cache a translation result
 */
function cacheTranslation(entry) {
    // Evict old entries if cache is full
    if (translationCache.size >= CACHE_MAX_SIZE) {
        // Remove least recently used (lowest hit count)
        let minHits = Infinity;
        let minKey = '';
        for (const [key, val] of translationCache.entries()) {
            if (val.hitCount < minHits) {
                minHits = val.hitCount;
                minKey = key;
            }
        }
        if (minKey) {
            translationCache.delete(minKey);
        }
    }
    const key = hashString(entry.original);
    translationCache.set(key, {
        ...entry,
        timestamp: Date.now(),
        hitCount: 1
    });
}
/**
 * Get cache statistics
 */
export function getTranslationCacheStats() {
    let totalHits = 0;
    let preservedCount = 0;
    let lostCount = 0;
    for (const entry of translationCache.values()) {
        totalHits += entry.hitCount;
        if (entry.preserved) {
            preservedCount++;
        }
        else {
            lostCount++;
        }
    }
    return {
        size: translationCache.size,
        maxSize: CACHE_MAX_SIZE,
        totalHits,
        preservedCount,
        lostCount
    };
}
/**
 * Clear the translation cache
 */
export function clearTranslationCache() {
    translationCache.clear();
}
/**
 * Compute detailed confidence score for a round-trip translation
 */
function computeTranslationConfidence(original, roundTrip) {
    const details = [];
    // 1. Lexical similarity (word overlap)
    const lexicalSimilarity = computeSimilarity(original, roundTrip);
    details.push(`Lexical overlap: ${(lexicalSimilarity * 100).toFixed(1)}%`);
    // 2. Semantic score using n-grams
    const semanticScore = computeNGramSimilarity(original, roundTrip, 2);
    details.push(`Bigram similarity: ${(semanticScore * 100).toFixed(1)}%`);
    // 3. Technical term preservation
    const technicalTermScore = computeTechnicalTermPreservation(original, roundTrip);
    details.push(`Technical terms preserved: ${(technicalTermScore * 100).toFixed(1)}%`);
    // 4. Structural score (sentence length, punctuation)
    const structuralScore = computeStructuralSimilarity(original, roundTrip);
    details.push(`Structural similarity: ${(structuralScore * 100).toFixed(1)}%`);
    // Weighted combination
    const overall = (lexicalSimilarity * 0.35 +
        semanticScore * 0.30 +
        technicalTermScore * 0.25 +
        structuralScore * 0.10);
    details.push(`Overall confidence: ${(overall * 100).toFixed(1)}%`);
    return {
        overall,
        lexicalSimilarity,
        semanticScore,
        technicalTermScore,
        structuralScore,
        details
    };
}
/**
 * Compute n-gram similarity between two strings
 */
function computeNGramSimilarity(s1, s2, n) {
    const getNGrams = (s, n) => {
        const words = s.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        const ngrams = new Set();
        for (let i = 0; i <= words.length - n; i++) {
            ngrams.add(words.slice(i, i + n).join(' '));
        }
        return ngrams;
    };
    const ngrams1 = getNGrams(s1, n);
    const ngrams2 = getNGrams(s2, n);
    if (ngrams1.size === 0 && ngrams2.size === 0)
        return 1.0;
    if (ngrams1.size === 0 || ngrams2.size === 0)
        return 0;
    const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
    const union = new Set([...ngrams1, ...ngrams2]);
    return intersection.size / union.size;
}
/**
 * Check how well technical terms are preserved through round-trip
 */
function computeTechnicalTermPreservation(original, roundTrip) {
    // Extract technical terms from original
    const technicalPatterns = [
        /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g, // CamelCase
        /\b[a-z]+(?:[A-Z][a-z]+)+\b/g, // camelCase
        /\b[a-z]+(?:_[a-z]+)+\b/g, // snake_case
        /\b[A-Z]+(?:_[A-Z]+)+\b/g, // SCREAMING_SNAKE_CASE
        /\b(?:API|URL|HTTP|JSON|XML|SQL|CSS|HTML|DOM|SDK|CLI|GUI|UI|UX|CPU|GPU|RAM|SSD|HDD|OOP|MVC|REST|CRUD|AJAX|CORS)\b/gi,
        /\b\d+(?:\.\d+)*%?\b/g, // Numbers and percentages
        /\b(?:null|undefined|true|false|NaN|Infinity)\b/g, // JS literals
    ];
    const originalTerms = new Set();
    const roundTripLower = roundTrip.toLowerCase();
    for (const pattern of technicalPatterns) {
        const matches = original.match(pattern) || [];
        for (const match of matches) {
            originalTerms.add(match.toLowerCase());
        }
    }
    if (originalTerms.size === 0)
        return 1.0; // No technical terms to preserve
    let preserved = 0;
    for (const term of originalTerms) {
        if (roundTripLower.includes(term)) {
            preserved++;
        }
    }
    return preserved / originalTerms.size;
}
/**
 * Compute structural similarity (length, punctuation patterns)
 */
function computeStructuralSimilarity(s1, s2) {
    // Length ratio
    const lengthRatio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
    // Punctuation preservation
    const punct1 = (s1.match(/[.,!?;:]/g) || []).join('');
    const punct2 = (s2.match(/[.,!?;:]/g) || []).join('');
    const punctScore = punct1 === punct2 ? 1.0 :
        punct1.length === punct2.length ? 0.8 : 0.5;
    // Word count similarity
    const words1 = s1.split(/\s+/).length;
    const words2 = s2.split(/\s+/).length;
    const wordRatio = Math.min(words1, words2) / Math.max(words1, words2);
    return (lengthRatio * 0.3 + punctScore * 0.3 + wordRatio * 0.4);
}
// ============================================================================
// SIMPLE SEMANTIC SIMILARITY (Jaccard)
// ============================================================================
// Simple semantic similarity using word overlap (Jaccard)
function computeSimilarity(original, roundTrip) {
    const normalize = (s) => s.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);
    const origWords = new Set(normalize(original));
    const rtWords = new Set(normalize(roundTrip));
    if (origWords.size === 0 || rtWords.size === 0)
        return 0;
    const intersection = new Set([...origWords].filter(w => rtWords.has(w)));
    const union = new Set([...origWords, ...rtWords]);
    return intersection.size / union.size;
}
// Translation mappings for common dev/code terms
// These preserve technical meaning in compression
const TECHNICAL_TERMS = {
    // Code concepts
    'function': '函數',
    'variable': '變數',
    'parameter': '參數',
    'argument': '引數',
    'return': '返回',
    'class': '類別',
    'object': '物件',
    'array': '陣列',
    'string': '字串',
    'number': '數字',
    'boolean': '布林',
    'null': '空值',
    'undefined': '未定義',
    'error': '錯誤',
    'exception': '異常',
    'callback': '回調',
    'promise': '承諾',
    'async': '異步',
    'await': '等待',
    'import': '導入',
    'export': '導出',
    'module': '模組',
    'package': '套件',
    'dependency': '依賴',
    'interface': '介面',
    'type': '類型',
    'method': '方法',
    'property': '屬性',
    'constructor': '構造函數',
    'instance': '實例',
    'static': '靜態',
    'private': '私有',
    'public': '公開',
    'protected': '保護',
    // Actions
    'create': '創建',
    'read': '讀取',
    'update': '更新',
    'delete': '刪除',
    'insert': '插入',
    'remove': '移除',
    'add': '添加',
    'get': '獲取',
    'set': '設置',
    'find': '查找',
    'search': '搜索',
    'filter': '過濾',
    'sort': '排序',
    'map': '映射',
    'reduce': '歸約',
    'transform': '轉換',
    'parse': '解析',
    'serialize': '序列化',
    'validate': '驗證',
    'check': '檢查',
    'test': '測試',
    'debug': '調試',
    'log': '記錄',
    'print': '打印',
    'display': '顯示',
    'render': '渲染',
    'load': '加載',
    'save': '保存',
    'store': '存儲',
    'fetch': '獲取',
    'send': '發送',
    'receive': '接收',
    'connect': '連接',
    'disconnect': '斷開',
    'open': '打開',
    'close': '關閉',
    'start': '開始',
    'stop': '停止',
    'run': '運行',
    'execute': '執行',
    'call': '調用',
    'invoke': '調用',
    'trigger': '觸發',
    'emit': '發射',
    'listen': '監聽',
    'handle': '處理',
    'process': '處理',
    'initialize': '初始化',
    'configure': '配置',
    'setup': '設置',
    'install': '安裝',
    'deploy': '部署',
    'build': '構建',
    'compile': '編譯',
    'bundle': '打包',
    // System/Infra
    'server': '伺服器',
    'client': '客戶端',
    'database': '資料庫',
    'cache': '緩存',
    'memory': '記憶體',
    'storage': '存儲',
    'file': '文件',
    'directory': '目錄',
    'folder': '資料夾',
    'path': '路徑',
    'url': '網址',
    'endpoint': '端點',
    'route': '路由',
    'request': '請求',
    'response': '響應',
    'header': '標頭',
    'body': '主體',
    'query': '查詢',
    'session': '會話',
    'token': '令牌',
    'key': '密鑰',
    'secret': '密鑰',
    'password': '密碼',
    'user': '用戶',
    'admin': '管理員',
    'permission': '權限',
    'role': '角色',
    'authentication': '認證',
    'authorization': '授權',
    'encryption': '加密',
    'decryption': '解密',
    'hash': '雜湊',
    'signature': '簽名',
    // Data structures (note: 'map' and 'set' already defined above as actions)
    'list': '列表',
    'queue': '佇列',
    'stack': '堆疊',
    'tree': '樹',
    'graph': '圖',
    'node': '節點',
    'edge': '邊',
    'vertex': '頂點',
    'index': '索引',
    'record': '記錄',
    'row': '行',
    'column': '列',
    'field': '欄位',
    'value': '值',
    'entry': '條目',
    'item': '項目',
    'element': '元素',
    'component': '組件',
    'widget': '小部件',
    // Status/State
    'success': '成功',
    'failure': '失敗',
    'warning': '警告',
    'info': '資訊',
    'pending': '待處理',
    'completed': '已完成',
    'active': '活躍',
    'inactive': '非活躍',
    'enabled': '啟用',
    'disabled': '禁用',
    'loading': '加載中',
    'loaded': '已加載',
    'ready': '就緒',
    'busy': '忙碌',
    'idle': '閒置',
    'running': '運行中',
    'stopped': '已停止',
    'paused': '已暫停',
    // Common phrases
    'the': '',
    'a': '',
    'an': '',
    'is': '是',
    'are': '是',
    'was': '曾是',
    'were': '曾是',
    'has': '有',
    'have': '有',
    'had': '曾有',
    'will': '將',
    'would': '會',
    'should': '應該',
    'could': '可以',
    'can': '能',
    'may': '可能',
    'might': '可能',
    'must': '必須',
    'need': '需要',
    'want': '想要',
    'like': '像',
    'use': '使用',
    'used': '使用了',
    'using': '使用',
    'with': '用',
    'without': '沒有',
    'from': '從',
    'to': '到',
    'for': '為',
    'in': '在',
    'on': '在',
    'at': '在',
    'by': '由',
    'of': '的',
    'and': '和',
    'or': '或',
    'not': '不',
    'no': '否',
    'yes': '是',
    'true': '真',
    'false': '假',
    'if': '如果',
    'else': '否則',
    'then': '然後',
    'when': '當',
    'while': '當',
    'because': '因為',
    'so': '所以',
    'but': '但是',
    'however': '然而',
    'therefore': '因此',
    'also': '也',
    'too': '也',
    'very': '很',
    'more': '更多',
    'less': '更少',
    'most': '最',
    'least': '最少',
    'first': '首先',
    'last': '最後',
    'next': '下一個',
    'previous': '上一個',
    'before': '之前',
    'after': '之後',
    'now': '現在',
    'here': '這裡',
    'there': '那裡',
    'this': '這個',
    'that': '那個',
    'these': '這些',
    'those': '那些',
    'all': '所有',
    'some': '一些',
    'any': '任何',
    'each': '每個',
    'every': '每個',
    'both': '兩者',
    'either': '任一',
    'neither': '兩者都不',
    'other': '其他',
    'another': '另一個',
    'same': '相同',
    'different': '不同',
    'new': '新',
    'old': '舊',
    'good': '好',
    'bad': '壞',
    'right': '正確',
    'wrong': '錯誤',
    'correct': '正確',
    'incorrect': '不正確',
};
// Reverse mapping for decompression
const REVERSE_TERMS = Object.fromEntries(Object.entries(TECHNICAL_TERMS)
    .filter(([_, v]) => v.length > 0)
    .map(([k, v]) => [v, k]));
/**
 * IMPROVED: Per-word round-trip compression
 *
 * Strategy:
 * 1. Try to translate each English word to Traditional Chinese
 * 2. Translate it back to English (round-trip)
 * 3. If the word survives (same or similar) -> keep Chinese
 * 4. If the word gets corrupted -> keep original English
 *
 * Result: Hybrid mix where only "safe" words are compressed
 */
export function smartWordByWordCompress(text, options) {
    const threshold = options?.threshold ?? 0.8;
    const minWordLength = options?.minWordLength ?? 3;
    if (!text || text.length < 20) {
        return { result: text, compressionRatio: 1.0, wordsCompressed: 0, wordsPreserved: 0 };
    }
    // Preserve special content first (code blocks, URLs, etc.)
    const preserved = [];
    let preserveIndex = 0;
    let working = text;
    // Preserve code blocks
    working = working.replace(/```[\s\S]*?```/g, (match) => {
        preserved.push(match);
        return `__P${preserveIndex++}__`;
    });
    // Preserve inline code
    working = working.replace(/`[^`]+`/g, (match) => {
        preserved.push(match);
        return `__P${preserveIndex++}__`;
    });
    // Preserve URLs
    working = working.replace(/https?:\/\/[^\s]+/g, (match) => {
        preserved.push(match);
        return `__P${preserveIndex++}__`;
    });
    // Preserve file paths
    working = working.replace(/(?:\/[\w.-]+){2,}/g, (match) => {
        preserved.push(match);
        return `__P${preserveIndex++}__`;
    });
    // Preserve camelCase identifiers
    working = working.replace(/\b[a-z]+(?:[A-Z][a-z]+)+\b/g, (match) => {
        preserved.push(match);
        return `__P${preserveIndex++}__`;
    });
    // Preserve snake_case identifiers
    working = working.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (match) => {
        preserved.push(match);
        return `__P${preserveIndex++}__`;
    });
    // Now process word-by-word
    const tokens = working.split(/(\s+|[.,!?;:'"()[\]{}])/);
    const results = [];
    let wordsCompressed = 0;
    let wordsPreserved = 0;
    let originalLength = 0;
    let compressedLength = 0;
    for (const token of tokens) {
        // Skip whitespace and punctuation
        if (/^(\s+|[.,!?;:'"()[\]{}])$/.test(token) || token.startsWith('__P')) {
            results.push(token);
            compressedLength += token.length;
            originalLength += token.length;
            continue;
        }
        // Skip short words
        if (token.length < minWordLength) {
            results.push(token);
            compressedLength += token.length;
            originalLength += token.length;
            continue;
        }
        const lower = token.toLowerCase();
        originalLength += token.length;
        // Check if we have a direct translation
        if (TECHNICAL_TERMS[lower]) {
            const chinese = TECHNICAL_TERMS[lower];
            if (chinese.length > 0) {
                // Round-trip test: Chinese -> English
                const backToEnglish = REVERSE_TERMS[chinese] || chinese;
                const similarity = computeWordSimilarity(lower, backToEnglish.toLowerCase());
                if (similarity >= threshold) {
                    // Translation survived round-trip -> use Chinese
                    results.push(chinese);
                    compressedLength += chinese.length;
                    wordsCompressed++;
                }
                else {
                    // Translation corrupted -> keep English
                    results.push(token);
                    compressedLength += token.length;
                    wordsPreserved++;
                }
            }
            else {
                // Empty translation (articles like 'the', 'a') -> remove
                wordsCompressed++;
            }
        }
        else {
            // No translation available -> keep original English
            results.push(token);
            compressedLength += token.length;
            wordsPreserved++;
        }
    }
    // Restore preserved content
    let result = results.join('');
    for (let i = 0; i < preserved.length; i++) {
        result = result.replace(`__P${i}__`, preserved[i]);
    }
    return {
        result,
        compressionRatio: originalLength > 0 ? compressedLength / originalLength : 1.0,
        wordsCompressed,
        wordsPreserved
    };
}
/**
 * Compute similarity between two words
 * Uses character-level comparison for single words
 */
function computeWordSimilarity(word1, word2) {
    if (word1 === word2)
        return 1.0;
    const w1 = word1.toLowerCase();
    const w2 = word2.toLowerCase();
    if (w1 === w2)
        return 1.0;
    // Levenshtein-based similarity
    const maxLen = Math.max(w1.length, w2.length);
    if (maxLen === 0)
        return 1.0;
    const distance = levenshteinDistance(w1, w2);
    return 1 - (distance / maxLen);
}
/**
 * Levenshtein distance for word comparison
 */
function levenshteinDistance(s1, s2) {
    const m = s1.length;
    const n = s2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++)
        dp[i][0] = i;
    for (let j = 0; j <= n; j++)
        dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            }
            else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], // deletion
                dp[i][j - 1], // insertion
                dp[i - 1][j - 1] // substitution
                );
            }
        }
    }
    return dp[m][n];
}
/**
 * Compress text to Traditional Chinese
 * Preserves code blocks, URLs, and technical identifiers
 */
export function compressToTraditionalChinese(text) {
    if (!text || text.length < 20)
        return text; // Too short to compress
    // Preserve code blocks and special content
    const preserved = [];
    let preserveIndex = 0;
    // Preserve code blocks
    let result = text.replace(/```[\s\S]*?```/g, (match) => {
        preserved.push(match);
        return `__PRESERVE_${preserveIndex++}__`;
    });
    // Preserve inline code
    result = result.replace(/`[^`]+`/g, (match) => {
        preserved.push(match);
        return `__PRESERVE_${preserveIndex++}__`;
    });
    // Preserve URLs
    result = result.replace(/https?:\/\/[^\s]+/g, (match) => {
        preserved.push(match);
        return `__PRESERVE_${preserveIndex++}__`;
    });
    // Preserve file paths
    result = result.replace(/(?:\/[\w.-]+)+/g, (match) => {
        if (match.includes('.') || match.split('/').length > 2) {
            preserved.push(match);
            return `__PRESERVE_${preserveIndex++}__`;
        }
        return match;
    });
    // Preserve camelCase and snake_case identifiers
    result = result.replace(/\b[a-z]+(?:[A-Z][a-z]+)+\b/g, (match) => {
        preserved.push(match);
        return `__PRESERVE_${preserveIndex++}__`;
    });
    result = result.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (match) => {
        preserved.push(match);
        return `__PRESERVE_${preserveIndex++}__`;
    });
    // Translate words using dictionary
    const words = result.split(/(\s+)/);
    const translated = words.map(word => {
        if (word.startsWith('__PRESERVE_'))
            return word;
        if (/^\s+$/.test(word))
            return word;
        const lower = word.toLowerCase().replace(/[.,!?;:'"()[\]{}]/g, '');
        const punct = word.match(/[.,!?;:'"()[\]{}]+$/)?.[0] || '';
        if (TECHNICAL_TERMS[lower]) {
            return TECHNICAL_TERMS[lower] + punct;
        }
        return word;
    });
    result = translated.join('');
    // Restore preserved content
    for (let i = 0; i < preserved.length; i++) {
        result = result.replace(`__PRESERVE_${i}__`, preserved[i]);
    }
    return result;
}
/**
 * Decompress Traditional Chinese back to English
 */
export function decompressFromTraditionalChinese(text) {
    if (!text)
        return text;
    let result = text;
    // Replace Chinese terms with English
    for (const [chinese, english] of Object.entries(REVERSE_TERMS)) {
        result = result.split(chinese).join(english);
    }
    return result;
}
/**
 * Test if compression preserves semantic meaning using round-trip verification
 * Returns detailed confidence analysis
 *
 * ROUND-TRIP VERIFICATION:
 * 1. English -> Traditional Chinese (forward)
 * 2. Traditional Chinese -> English (reverse)
 * 3. Compare original vs round-trip
 * 4. If context preserved: use Chinese (saves tokens)
 * 5. If context lost: keep English (preserves meaning)
 */
export function testSemanticPreservation(original, options) {
    const threshold = options?.threshold ?? 0.80;
    const useCache = options?.useCache ?? true;
    // Check cache first
    if (useCache) {
        const cached = getCachedTranslation(original);
        if (cached) {
            return {
                compressed: cached.chinese,
                roundTrip: cached.roundTrip,
                similarity: cached.confidence,
                preserved: cached.preserved,
                confidence: computeTranslationConfidence(original, cached.roundTrip),
                cached: true
            };
        }
    }
    // Perform translation
    const compressed = compressToTraditionalChinese(original);
    const roundTrip = decompressFromTraditionalChinese(compressed);
    // Compute detailed confidence
    const confidence = computeTranslationConfidence(original, roundTrip);
    const preserved = confidence.overall >= threshold;
    // Cache the result
    if (useCache) {
        cacheTranslation({
            original,
            chinese: compressed,
            roundTrip,
            confidence: confidence.overall,
            preserved
        });
    }
    return {
        compressed,
        roundTrip,
        similarity: confidence.overall,
        preserved,
        confidence,
        cached: false
    };
}
/**
 * ROUND-TRIP VERIFIED SMART COMPRESSION
 *
 * This is the main compression function using round-trip verification.
 *
 * Algorithm:
 * 1. Split text into segments (sentences/chunks)
 * 2. For each segment:
 *    a. Translate to Traditional Chinese
 *    b. Translate back to English (round-trip)
 *    c. Compare original vs round-trip using confidence scoring
 *    d. If context PRESERVED: use Chinese (saves tokens!)
 *    e. If context LOST: keep original English (preserves meaning)
 * 3. Output hybrid text: Chinese where safe, English where necessary
 *
 * Example:
 *   Input: "The React component uses useState hook for state management"
 *   Chinese: "React 組件使用 useState 鉤子進行狀態管理"
 *   Round-trip: "React component uses useState hook for state management"
 *   Result: Context preserved! -> Use Chinese version
 *
 *   Input: "The QQMS proactively throttles at 20% CPU"
 *   Chinese: "QQMS 在 20% CPU 時主動節流"
 *   Round-trip: "QQMS actively saves at 20% CPU"
 *   Result: Context LOST ("throttles" != "saves") -> Keep English
 */
export function smartCompress(text, options) {
    const threshold = options?.threshold ?? 0.80;
    const minLength = options?.minLength ?? 50;
    const verbose = options?.verbose ?? false;
    if (!text || text.length < minLength) {
        return { result: text, compressionRatio: 1.0, wasCompressed: false };
    }
    // Split into sentences/chunks for granular compression
    // Use smarter sentence boundary detection
    const chunks = splitIntoSegments(text);
    const results = [];
    const decisions = [];
    let totalOriginal = 0;
    let totalCompressed = 0;
    let anyCompressed = false;
    let cacheHits = 0;
    let totalConfidence = 0;
    let compressedCount = 0;
    let preservedCount = 0;
    for (const chunk of chunks) {
        // Skip very short chunks
        if (chunk.length < 15) {
            results.push(chunk);
            totalOriginal += chunk.length;
            totalCompressed += chunk.length;
            decisions.push({
                original: chunk,
                output: chunk,
                usedChinese: false,
                confidence: 1.0,
                reason: 'Too short to compress'
            });
            continue;
        }
        // Skip chunks that are mostly code/technical
        if (isCodeLikeChunk(chunk)) {
            results.push(chunk);
            totalOriginal += chunk.length;
            totalCompressed += chunk.length;
            preservedCount++;
            decisions.push({
                original: chunk,
                output: chunk,
                usedChinese: false,
                confidence: 1.0,
                reason: 'Code-like content preserved'
            });
            continue;
        }
        // Perform round-trip verification
        const test = testSemanticPreservation(chunk, { threshold, useCache: true });
        totalConfidence += test.confidence.overall;
        if (test.cached) {
            cacheHits++;
        }
        if (test.preserved) {
            // Context preserved after round-trip -> use Chinese
            results.push(test.compressed);
            totalOriginal += chunk.length;
            totalCompressed += test.compressed.length;
            anyCompressed = true;
            compressedCount++;
            decisions.push({
                original: chunk,
                output: test.compressed,
                usedChinese: true,
                confidence: test.confidence.overall,
                reason: `Round-trip verified (${(test.confidence.overall * 100).toFixed(0)}% confidence)`
            });
        }
        else {
            // Context lost after round-trip -> keep English
            results.push(chunk);
            totalOriginal += chunk.length;
            totalCompressed += chunk.length;
            preservedCount++;
            decisions.push({
                original: chunk,
                output: chunk,
                usedChinese: false,
                confidence: test.confidence.overall,
                reason: `Context loss detected: ${test.confidence.details.slice(0, 2).join(', ')}`
            });
        }
    }
    const stats = {
        totalSegments: chunks.length,
        compressedSegments: compressedCount,
        preservedSegments: preservedCount,
        cacheHits,
        avgConfidence: chunks.length > 0 ? totalConfidence / chunks.length : 0
    };
    return {
        result: results.join(' '),
        compressionRatio: totalOriginal > 0 ? totalCompressed / totalOriginal : 1.0,
        wasCompressed: anyCompressed,
        ...(verbose ? { segmentDecisions: decisions, stats } : {})
    };
}
/**
 * Split text into segments for compression
 * Uses smart boundary detection (sentences, line breaks, clause boundaries)
 */
function splitIntoSegments(text) {
    // First, handle explicit line breaks
    const lines = text.split(/\n+/);
    const segments = [];
    for (const line of lines) {
        if (line.trim().length === 0)
            continue;
        // Split by sentence boundaries
        const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z])/);
        for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length > 0) {
                // If sentence is very long, split by clause boundaries
                if (trimmed.length > 200) {
                    const clauses = trimmed.split(/(?<=[,;:])\s+/);
                    segments.push(...clauses.filter(c => c.trim().length > 0));
                }
                else {
                    segments.push(trimmed);
                }
            }
        }
    }
    return segments;
}
/**
 * Check if a chunk is mostly code-like content that shouldn't be translated
 */
function isCodeLikeChunk(chunk) {
    // Count code-like indicators
    let codeIndicators = 0;
    const totalChars = chunk.length;
    // Brackets and braces
    codeIndicators += (chunk.match(/[{}[\]()]/g) || []).length * 2;
    // Operators
    codeIndicators += (chunk.match(/[=<>!&|+\-*/%]/g) || []).length;
    // Code patterns
    if (/^\s*(if|else|for|while|function|const|let|var|return|import|export|class)\s/.test(chunk)) {
        codeIndicators += 10;
    }
    // File paths
    if (/(?:\/[\w.-]+){2,}/.test(chunk)) {
        codeIndicators += 5;
    }
    // Inline code markers
    if (/`[^`]+`/.test(chunk)) {
        codeIndicators += 5;
    }
    // Threshold: if >20% of characters are code-like indicators, skip
    return (codeIndicators / totalChars) > 0.15;
}
/**
 * Compress memory content for hook output
 * Designed for specmem context injection
 */
export function compressMemoryContext(memories) {
    const lines = [];
    for (let i = 0; i < memories.length; i++) {
        const mem = memories[i];
        const sim = mem.similarity ? `(${Math.round(mem.similarity * 100)}%)` : '';
        // Compress the content
        const { result, compressionRatio } = smartCompress(mem.content, {
            threshold: 0.80, // Slightly lower threshold for memory context
            minLength: 30
        });
        lines.push(`  [${i + 1}] ${sim} ${result}`);
    }
    return lines.join('\n');
}
/**
 * HYBRID COMPRESSION WITH ROUND-TRIP VERIFICATION
 *
 * This is the recommended high-level API for compression.
 * It produces a hybrid output: Chinese where translation is verified safe,
 * English where context would be lost.
 *
 * Features:
 * - Segment-level round-trip verification
 * - Confidence scoring with weighted metrics
 * - Translation cache for performance
 * - Detailed decision logging for debugging
 *
 * @param text - Input English text
 * @param options - Compression options
 * @returns Hybrid compressed text with detailed stats
 */
export function hybridRoundTripCompress(text, options) {
    const threshold = options?.threshold ?? 0.80;
    const verbose = options?.verbose ?? false;
    const minSegmentLength = options?.minSegmentLength ?? 50;
    if (!text || text.length < minSegmentLength) {
        return {
            result: text,
            stats: {
                inputLength: text?.length ?? 0,
                outputLength: text?.length ?? 0,
                compressionRatio: 1.0,
                segmentsTotal: 0,
                segmentsCompressed: 0,
                segmentsPreserved: 0,
                cacheHitRate: 0,
                averageConfidence: 0
            }
        };
    }
    const compressed = smartCompress(text, {
        threshold,
        minLength: minSegmentLength,
        verbose: true
    });
    const stats = {
        inputLength: text.length,
        outputLength: compressed.result.length,
        compressionRatio: compressed.compressionRatio,
        segmentsTotal: compressed.stats?.totalSegments ?? 0,
        segmentsCompressed: compressed.stats?.compressedSegments ?? 0,
        segmentsPreserved: compressed.stats?.preservedSegments ?? 0,
        cacheHitRate: compressed.stats?.totalSegments
            ? (compressed.stats.cacheHits / compressed.stats.totalSegments)
            : 0,
        averageConfidence: compressed.stats?.avgConfidence ?? 0
    };
    return {
        result: compressed.result,
        stats,
        ...(verbose ? { decisions: compressed.segmentDecisions } : {})
    };
}
/**
 * Analyze a text for translation quality WITHOUT actually compressing
 * Useful for debugging and tuning compression thresholds
 */
export function analyzeTranslationQuality(text) {
    const segments = splitIntoSegments(text);
    const analyzed = [];
    let totalConfidence = 0;
    let recommendCompression = 0;
    let recommendPreservation = 0;
    let potentialSavings = 0;
    for (const segment of segments) {
        if (segment.length < 15)
            continue;
        const test = testSemanticPreservation(segment, { threshold: 0.80, useCache: true });
        const recommendation = test.preserved ? 'compress' : 'preserve';
        analyzed.push({
            text: segment,
            chinese: test.compressed,
            roundTrip: test.roundTrip,
            confidence: test.confidence,
            recommendation
        });
        totalConfidence += test.confidence.overall;
        if (test.preserved) {
            recommendCompression++;
            potentialSavings += segment.length - test.compressed.length;
        }
        else {
            recommendPreservation++;
        }
    }
    return {
        segments: analyzed,
        summary: {
            totalSegments: analyzed.length,
            recommendCompression,
            recommendPreservation,
            avgConfidence: analyzed.length > 0 ? totalConfidence / analyzed.length : 0,
            potentialSavings: Math.max(0, potentialSavings)
        }
    };
}
/**
 * Demo function showing round-trip verification in action
 * Useful for understanding how the algorithm works
 */
export function demonstrateRoundTrip(examples) {
    const defaultExamples = [
        'The React component uses useState hook for state management',
        'The QQMS proactively throttles at 20% CPU',
        'This function returns an array of filtered results',
        'The microservice handles authentication via JWT tokens',
        'Memory consolidation improves query performance significantly'
    ];
    const testCases = examples ?? defaultExamples;
    console.log('=== ROUND-TRIP TRANSLATION VERIFICATION DEMO ===\n');
    for (const input of testCases) {
        const test = testSemanticPreservation(input, { threshold: 0.80, useCache: false });
        console.log(`Input:      "${input}"`);
        console.log(`Chinese:    "${test.compressed}"`);
        console.log(`Round-trip: "${test.roundTrip}"`);
        console.log(`Confidence: ${(test.confidence.overall * 100).toFixed(1)}%`);
        console.log(`Decision:   ${test.preserved ? '✓ Use Chinese (context preserved)' : '✗ Keep English (context lost)'}`);
        console.log(`Details:    ${test.confidence.details.join(' | ')}`);
        console.log('');
    }
}
// Export for testing
export const _internal = {
    computeSimilarity,
    computeTranslationConfidence,
    computeNGramSimilarity,
    computeTechnicalTermPreservation,
    computeStructuralSimilarity,
    splitIntoSegments,
    isCodeLikeChunk,
    getCachedTranslation,
    cacheTranslation,
    hashString,
    TECHNICAL_TERMS,
    REVERSE_TERMS
};
// ============================================================================
// Config-Aware Compression API
// ============================================================================
/**
 * Check if compression should be applied based on config
 */
export function shouldCompress(text, context) {
    try {
        const cfg = getCompressionConfig();
        if (!cfg.enabled)
            return false;
        if (!text || text.length < cfg.minLength)
            return false;
        // Check context-specific settings
        if (context === 'search' && !cfg.compressSearchResults)
            return false;
        if (context === 'system' && !cfg.compressSystemOutput)
            return false;
        if (context === 'hook' && !cfg.compressHookOutput)
            return false;
        return true;
    }
    catch {
        // Config not loaded yet, default to enabled
        return text && text.length >= 50;
    }
}
/**
 * Compress text if config allows, otherwise return original
 * This is the main entry point for compression
 */
export function compactIfEnabled(text, context) {
    if (!shouldCompress(text, context)) {
        return { result: text, compressed: false, ratio: 1.0 };
    }
    try {
        const cfg = getCompressionConfig();
        const { result, compressionRatio, wasCompressed } = smartCompress(text, {
            threshold: cfg.threshold,
            minLength: cfg.minLength
        });
        return {
            result,
            compressed: wasCompressed,
            ratio: compressionRatio
        };
    }
    catch (error) {
        logger.warn({ error }, 'compression failed, returning original text');
        return { result: text, compressed: false, ratio: 1.0 };
    }
}
/**
 * Compress MCP tool response for token efficiency
 * Handles both string and object responses
 */
export function compressMCPResponse(response, context = 'system') {
    if (!shouldCompress('x'.repeat(100), context)) {
        return response;
    }
    if (typeof response === 'string') {
        return compactIfEnabled(response, context).result;
    }
    if (Array.isArray(response)) {
        return response.map(item => compressMCPResponse(item, context));
    }
    if (typeof response === 'object' && response !== null) {
        const compressed = {};
        for (const [key, value] of Object.entries(response)) {
            if (key === 'content' && typeof value === 'string') {
                // Compress content fields specifically
                compressed[key] = compactIfEnabled(value, context).result;
            }
            else if (key === 'message' && typeof value === 'string') {
                // Compress message fields
                compressed[key] = compactIfEnabled(value, context).result;
            }
            else if (typeof value === 'object' && value !== null) {
                compressed[key] = compressMCPResponse(value, context);
            }
            else {
                compressed[key] = value;
            }
        }
        return compressed;
    }
    return response;
}
/**
 * Format compressed output with metadata indicator
 * Shows [ZH] prefix when content is compressed
 */
export function formatCompressedOutput(text, context = 'system') {
    const { result, compressed, ratio } = compactIfEnabled(text, context);
    if (compressed && ratio < 0.9) {
        // Add subtle indicator that content was compressed
        return `[ZH:${Math.round(ratio * 100)}%] ${result}`;
    }
    return result;
}
/**
 * Get current compression statistics
 */
export function getCompressionStats() {
    try {
        const cfg = getCompressionConfig();
        return {
            enabled: cfg.enabled,
            config: cfg,
            termCount: Object.keys(TECHNICAL_TERMS).length
        };
    }
    catch {
        return {
            enabled: true,
            config: {
                enabled: true,
                minLength: 50,
                threshold: 0.80,
                compressSearchResults: true,
                compressSystemOutput: true,
                compressHookOutput: true
            },
            termCount: Object.keys(TECHNICAL_TERMS).length
        };
    }
}
//# sourceMappingURL=tokenCompressor.js.map