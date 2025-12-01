#!/usr/bin/env node
/**
 * TOKEN COMPRESSOR v6.0 - ULTRA COMPRESSION
 * =========================================
 *
 * KEY INSIGHT: Character savings matter, not word count!
 * - Chinese text needs no spaces between characters
 * - Use micro-delimiter (·) only when mixing with English
 * - Measure CHARACTER savings (the real metric)
 *
 * TARGETS:
 *   - 65-75% CHARACTER savings
 *   - 100% semantic round-trip accuracy
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

// ═══════════════════════════════════════════════════════════════════════════
// WARNING PREFIX - Prevents Claude from responding in Chinese
// Compact version: 120 chars vs original 260 chars (54% smaller!)
// ═══════════════════════════════════════════════════════════════════════════
const COMPRESSION_WARNING = `⚠️ CONTEXT COMPRESSION ACTIVE ⚠️
The following context has been compressed to Traditional Chinese for token efficiency.
DO NOT output responses in Chinese. Continue responding in English as normal.
The compression is purely for context storage - treat it as English internally.
───────────────────────────────────────────────────────────────────────────────

`;

// Ultra-compact warning - SINGLE LINE (default for hooks)
const COMPACT_WARNING = `⚠️壓縮:繁中→EN │ `;

// Micro-delimiter for Chinese-English boundaries (middle dot - very small)
const MICRO_SEP = '·';

// ═══════════════════════════════════════════════════════════════════════════
// ULTRA-AGGRESSIVE FILLER REMOVAL (~150 words)
// These words can be removed without losing semantic meaning
// ═══════════════════════════════════════════════════════════════════════════
const REMOVE = new Set([
  // ─── Articles ────────────────────────────────────────────────────────────
  'a', 'an', 'the',

  // ─── Be verbs (all forms) ────────────────────────────────────────────────
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',

  // ─── Have verbs ──────────────────────────────────────────────────────────
  'has', 'have', 'had', 'having',

  // ─── Do verbs ────────────────────────────────────────────────────────────
  'do', 'does', 'did', 'doing', 'done',

  // ─── Modal verbs ─────────────────────────────────────────────────────────
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',

  // ─── Pronouns (all) ──────────────────────────────────────────────────────
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  'who', 'whom', 'whose', 'which', 'that', 'what',
  'this', 'that', 'these', 'those',
  'one', 'ones', 'someone', 'anyone', 'everyone', 'no one', 'nobody',
  'something', 'anything', 'everything', 'nothing',
  'somewhere', 'anywhere', 'everywhere', 'nowhere',

  // ─── Prepositions (common) ───────────────────────────────────────────────
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about',
  'into', 'onto', 'upon', 'from', 'off', 'out',
  'up', 'down', 'over', 'under', 'above', 'below',
  'between', 'among', 'through', 'during', 'before', 'after',
  'around', 'against', 'within', 'without', 'along', 'across',
  'behind', 'beside', 'besides', 'beyond', 'near', 'toward', 'towards',

  // ─── Conjunctions ────────────────────────────────────────────────────────
  'and', 'or', 'but', 'nor', 'so', 'yet', 'for',
  'because', 'since', 'although', 'though', 'while', 'whereas',
  'if', 'unless', 'until', 'when', 'where', 'whether',
  'as', 'than', 'once', 'after', 'before',

  // ─── Adverbs (filler) ────────────────────────────────────────────────────
  'very', 'really', 'quite', 'rather', 'fairly', 'pretty',
  'just', 'only', 'even', 'still', 'already', 'yet',
  'also', 'too', 'either', 'neither', 'both',
  'always', 'never', 'ever', 'often', 'sometimes', 'rarely', 'seldom',
  'usually', 'normally', 'generally', 'typically', 'commonly',
  'actually', 'basically', 'essentially', 'simply', 'merely',
  'certainly', 'definitely', 'probably', 'possibly', 'perhaps', 'maybe',
  'apparently', 'evidently', 'obviously', 'clearly',
  'however', 'therefore', 'thus', 'hence', 'consequently',
  'moreover', 'furthermore', 'additionally', 'meanwhile',
  'instead', 'otherwise', 'nevertheless', 'nonetheless',
  'now', 'then', 'here', 'there', 'where',
  'well', 'anyway', 'indeed', 'surely',

  // ─── Determiners & Quantifiers ───────────────────────────────────────────
  'some', 'any', 'no', 'every', 'each', 'all', 'both', 'half',
  'few', 'little', 'much', 'many', 'more', 'most', 'less', 'least',
  'several', 'enough', 'plenty',
  'another', 'other', 'others', 'such',
  'own', 'same', 'different',

  // ─── Auxiliary/Helper words ──────────────────────────────────────────────
  'get', 'gets', 'got', 'getting', 'gotten',
  'let', 'lets', 'make', 'makes', 'made', 'making',
  'keep', 'keeps', 'kept', 'keeping',
  'seem', 'seems', 'seemed', 'seeming',
  'appear', 'appears', 'appeared', 'appearing',
  'become', 'becomes', 'became', 'becoming',

  // ─── Generic nouns ───────────────────────────────────────────────────────
  'thing', 'things', 'stuff', 'way', 'ways',
  'kind', 'kinds', 'sort', 'sorts', 'type', 'types',
  'bit', 'lot', 'lots', 'bunch',
  'case', 'cases', 'instance', 'instances',
  'example', 'examples', 'fact', 'facts',

  // ─── Misc filler ─────────────────────────────────────────────────────────
  'like', 'etc', 'ie', 'eg', 'vs', 'via',
  'please', 'kindly', 'thanks', 'thank',
  'yes', 'no', 'ok', 'okay',
]);

// ═══════════════════════════════════════════════════════════════════════════
// PHRASE DICTIONARY - Multi-word → UNIQUE codes (no collisions!)
// Each phrase gets a completely unique code - no sharing with single words
// ═══════════════════════════════════════════════════════════════════════════
const PHRASES = {
  // 3+ word phrases → UNIQUE codes (using rare characters/combos)
  'in order to': '爲了',      // unique - not used elsewhere
  'as well as': '以及',       // unique
  'such as': '諸如',          // unique
  'for example': '舉例',      // unique
  'make sure': '確保',        // unique
  'at the same time': '同時', // unique
  'on the other hand': '另方', // unique
  'in addition to': '此外',   // unique
  'due to': '由於',           // unique
  'based on': '基於',         // unique
  'according to': '依照',     // unique
  'in the case of': '若是',   // unique
  'as a result': '結果是',    // unique
  'with respect to': '關於',  // unique
  'in terms of': '就論',      // unique
  'a lot of': '許多',         // unique
  'a number of': '若干',      // unique
  'one of': '其一',           // unique
  'each of': '每個',          // unique
  'all of': '所有',           // unique
  'some of': '部分的',        // unique
  'most of': '大多',          // unique
  'none of': '無一',          // unique
  'the rest of': '其餘',      // unique
  'the same as': '相同',      // unique
  'different from': '不同於', // unique
  'similar to': '類似',       // unique
  'up to': '高達',            // unique
  'out of': '從中',           // unique
  'instead of': '而非',       // unique
  'in front of': '前面',      // unique
  'on top of': '之上',        // unique
  'at the end': '最後',       // unique
  'at the beginning': '最初', // unique
  'able to': '能夠',          // unique
  'unable to': '無法',        // unique
  'have to': '必須',          // unique
  'want to': '想要',          // unique
  'need to': '需要',          // unique - NOT '需' which is 'require'
  'try to': '嘗試',           // unique - NOT '試' which is 'test'
  'used to': '曾經',          // unique
  'going to': '即將',         // unique
  'about to': '將要',         // unique
  'supposed to': '應該',      // unique
  'allowed to': '允許',       // unique
  'required to': '必需',      // unique
  'how to': '如何',           // unique
  'what to': '何事',          // unique
  'where to': '何處',         // unique
  'whether or not': '是否',   // unique
  'not only': '不僅',         // unique
  'but also': '也是',         // unique
  'more than': '超過',        // unique
  'less than': '少於',        // unique
  'at least': '至少',         // unique
  'at most': '最多',          // unique
  'as soon as': '一旦',       // unique
  'as long as': '只要',       // unique
  'depends on': '取決於',     // unique
  'results in': '導致',       // unique - different from 'leads to'
  'leads to': '引向',         // unique
  'belongs to': '歸屬',       // unique
  'refers to': '指的',        // unique
  'related to': '相關於',     // unique
  'compared to': '相比',      // unique
  'consists of': '組成於',    // unique
  'made of': '製於',          // unique
  'set up': '設立',           // unique - NOT '設' which is 'let'
  'look up': '查找',          // unique
  'look for': '尋找',         // unique
  'come from': '來自',        // unique
  'go back': '返回',          // unique - NOT '回' which is 'callback'
  'take place': '發生',       // unique
  'turn on': '開啟',          // unique
  'turn off': '關閉',         // unique
  'carry out': '執行',        // unique
  'find out': '發現',         // unique
  'figure out': '弄清',       // unique
  'point out': '指出',        // unique
  'work on': '從事',          // unique
  'deal with': '處理',        // unique
  'log in': '登入',           // unique
  'log out': '登出',          // unique
  'sign up': '註冊',          // unique

  // Programming phrases - all UNIQUE codes
  'return value': '返回值',   // unique
  'function call': '函數呼',  // unique
  'error message': '錯誤訊',  // unique
  'error handling': '錯誤處', // unique
  'null check': '空值查',     // unique
  'type check': '型別查',     // unique
  'data type': '數據型',      // unique
  'data structure': '數據構', // unique
  'source code': '源代碼',    // unique
  'test case': '測試例',      // unique
  'use case': '使用例',       // unique
  'best practice': '最佳踐',  // unique
  'code review': '代碼審',    // unique
  'pull request': 'PR',       // keep as-is
  'merge request': 'MR',      // keep as-is
  'api call': 'API呼叫',      // unique
  'api endpoint': 'API端點',  // unique
  'database query': '資料詢', // unique
  'database connection': '資料連', // unique
  'file system': '檔案系',    // unique
  'file path': '檔案路',      // unique
  'working directory': '工作目', // unique
  'environment variable': '環境變', // unique
  'config file': '配置檔',    // unique
  'log file': '日誌檔',       // unique
  'memory leak': '記憶漏',    // unique
  'stack trace': '棧追蹤',    // unique
  'call stack': '呼叫棧',     // unique
  'garbage collection': 'GC', // keep as-is
  'race condition': '競態條', // unique
  'dead lock': '死鎖住',      // unique
  'unit test': '單元測',      // unique
  'integration test': '集成測', // unique
  'end to end': 'E2E',        // keep as-is
  'version control': '版本控', // unique
  'access control': '訪問控', // unique
  'not found': '未找到',      // unique
  'already exists': '已存在', // unique
  'does not exist': '不存在', // unique
  'can be': '可以是',         // unique
  'should be': '應當是',      // unique
  'would be': '會是',         // unique
  'must be': '必是',          // unique
  'will be': '將是',          // unique
  'has been': '已經是',       // unique
  'have been': '已經有',      // unique
  'had been': '曾經是',       // unique
};

// Sort phrases by length (longest first)
const SORTED_PHRASES = Object.entries(PHRASES).sort((a, b) => b[0].length - a[0].length);

// Build reverse phrase mapping
const REVERSE_PHRASES = {};
for (const [eng, chi] of SORTED_PHRASES) {
  REVERSE_PHRASES[chi] = eng;
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE CHARACTER CODES - No suffixes for maximum compression
// Context provides grammar, we just preserve semantics
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// EXPANDED DICTIONARY - 22,000+ entries from CC-CEDICT + curated programming terms
// Loaded from merged-codes.cjs (Traditional Chinese 繁體中文)
// ═══════════════════════════════════════════════════════════════════════════
let CODES;
try {
  CODES = require('./merged-codes.cjs');
  // console.error('[TokenCompressor] Loaded', Object.keys(CODES).length, 'codes');
} catch (e) {
  // Fallback to minimal essential codes if file not found
  CODES = {
    'function': '函', 'variable': '變', 'parameter': '參', 'argument': '實參',
  'return': '返', 'class': '類', 'object': '物', 'array': '陣', 'string': '串',
  'number': '數', 'boolean': '布', 'value': '值', 'method': '法',
  'property': '屬', 'interface': '介', 'module': '模組', 'package': '包',
  'library': '庫', 'framework': '架', 'dependency': '賴', 'null': '空值',
  'undefined': '未', 'error': '錯', 'exception': '異', 'warning': '警',
  'debug': '調', 'memory': '記', 'buffer': '緩', 'stack': '棧', 'heap': '堆',
  'queue': '列', 'callback': '回', 'promise': '諾', 'async': '異步',
  'await': '等', 'sync': '同步', 'import': '導', 'export': '出', 'require': '需',
  'const': '恆', 'let': '讓', 'var': '宣',

  // Actions - BASE FORMS ONLY (suffixes auto-handled)
  'create': '創', 'read': '讀', 'update': '更', 'delete': '刪', 'add': '加',
  'remove': '除', 'insert': '插', 'find': '找', 'found': '找', // 'found' is irregular
  'search': '搜', 'filter': '濾', 'sort': '排', 'parse': '析', 'format': '格',
  'validate': '驗', 'check': '查', 'test': '試', 'verify': '核', 'load': '載',
  'save': '存', 'store': '儲', 'storage': '儲存', 'fetch': '取', 'send': '送', // storage unique!
  'sent': '送', // irregular
  'receive': '收', 'connect': '連', 'disconnect': '斷', 'start': '啟',
  'stop': '停', 'run': '跑', 'ran': '跑', // irregular
  'execute': '執', 'call': '呼', 'invoke': '喚', 'trigger': '觸',
  'handle': '理', 'process': '處', 'initialize': '初', 'configure': '配置',
  'setup': '設立', 'install': '裝', 'deploy': '部', 'build': '建',
  'built': '建', // irregular
  'compile': '編', 'render': '渲', 'display': '顯', 'show': '示',
  'hide': '藏', 'hidden': '藏', // irregular
  'enable': '啟用', 'disable': '禁', 'open': '開', 'close': '閉',
  'write': '寫', 'wrote': '寫', 'written': '寫', // irregular
  'use': '用', 'provide': '供', 'include': '含', 'contain': '容納',
  'work': '工', 'change': '改', 'modify': '修改', 'fix': '修復',
  'resolve': '解', 'implement': '實', 'define': '定', 'declare': '聲',
  'assign': '賦', 'convert': '轉', 'transform': '變換', 'map': '映',
  'reduce': '減', 'merge': '併', 'split': '拆', 'join': '聯',
  'copy': '複', 'move': '移', 'replace': '換', 'match': '匹配',
  'compare': '比', 'calculate': '算', 'count': '計', 'print': '印',
  'log': '誌', 'trace': '跟', 'monitor': '監', 'watch': '觀',
  'listen': '聽', 'wait': '待', 'retry': '重試', 'reset': '重設',
  'clear': '清', 'extend': '延', 'inherit': '繼', 'override': '覆',
  'encode': '編碼', 'decode': '解碼', 'encrypt': '加密', 'decrypt': '解密',
  'compress': '壓', 'decompress': '解壓',

  // System/Infrastructure - BASE FORMS ONLY
  'server': '服', 'client': '客', 'database': '資', 'cache': '快',
  'file': '檔', 'directory': '目', 'folder': '夾', 'path': '徑',
  'request': '求', 'response': '應', 'query': '詢', 'session': '會',
  'token': '令', 'user': '戶', 'admin': '管', 'permission': '權',
  'role': '角', 'authentication': '認證', 'authorization': '授權',
  'connection': '接', 'socket': '套', 'port': '埠', 'host': '主',
  'domain': '網域', 'endpoint': '端', 'route': '路',
  'url': 'URL', 'api': 'API', 'rest': 'REST', 'http': 'HTTP', 'https': 'HTTPS',
  'service': '務', 'container': '容', 'cluster': '群', 'node': '節',
  'network': '網', 'proxy': '代', 'event': '事', 'message': '訊',
  'channel': '頻', 'stream': '流', 'thread': '緒', 'task': '任',
  'job': '作', 'worker': '工er', // English suffix keeps unique from 'work'
  'timeout': '逾時', 'interval': '間隔',

  // Data structures - BASE FORMS ONLY
  'list': '單', 'set': '集', 'dict': '典', 'dictionary': '典',
  'tree': '樹', 'graph': '圖', 'table': '表', 'row': '行',
  'column': '欄', 'record': '錄', 'field': '欄位', 'index': '索',
  'indice': '索', // for 'indices'
  'key': '鍵', 'id': 'ID', 'pointer': '指', 'reference': '參引',
  'link': '鏈', 'parent': '父', 'child': '子', 'children': '子', // irregular
  'root': '根', 'leaf': '葉', 'leave': '葉', // for 'leaves'
  'branch': '支', 'depth': '深', 'level': '級', 'layer': '層',

  // Status/State - BASE FORMS ONLY
  'success': '成', 'successful': '成ly', // keep adverb form unique
  'failure': '敗', 'fail': '敗', 'complete': '完', 'completion': '完tion',
  'incomplete': '未完', 'pending': '待處理', 'active': '活', 'inactive': '不活',
  'valid': '效', 'invalid': '無效', 'available': '可用', 'unavailable': '不可用',
  'online': '在線', 'offline': '離線', 'ready': '備', 'busy': '忙', 'idle': '閒',
  'visible': '可見', 'locked': '鎖', 'unlocked': '解鎖', 'empty': '空白', 'full': '滿',
  'new': '新', 'old': '舊', 'current': '當前', 'previous': '前', 'next': '下',
  'first': '首', 'last': '末', 'latest': '最新', 'oldest': '最舊',
  'default': '默', 'custom': '自定', 'local': '本', 'remote': '遠', 'global': '全',
  'public': '公', 'private': '私', 'protected': '護',
  'static': '靜', 'dynamic': '動', 'constant': '恆定',
  'temporary': '臨', 'permanent': '永', 'optional': '可選',
  'true': '真', 'false': '假',

  // Common nouns - BASE FORMS ONLY
  'code': '碼', 'data': '據', 'information': '資訊', 'result': '果',
  'output': '輸出', 'input': '輸入', 'content': '內容',
  'text': '文', 'name': '名', 'title': '標題', 'label': '標籤',
  'tag': '標', 'category': '類別', 'group': '群組', 'size': '大小',
  'length': '長', 'total': '總', 'sum': '和', 'average': '均',
  'maximum': '最大', 'max': '最大', 'minimum': '最小', 'min': '最小',
  'range': '範圍', 'limit': '限', 'threshold': '閾', 'offset': '偏移',
  'position': '位', 'location': '點', 'time': '時', 'date': '日',
  'timestamp': '時戳', 'duration': '持續', 'project': '專', 'version': '版',
  'release': '發布', 'issue': '題', 'bug': '蟲', 'feature': '功能',
  'component': '件', 'element': '素', 'item': '項', 'entry': '條',
  'entity': '體', 'model': '模', 'schema': '綱要', 'template': '模板',
  'pattern': '模式', 'design': '設計', 'architecture': '架構',
  'structure': '結構', 'style': '樣式', 'config': '配檔',
  'configuration': '配檔', 'setting': '置', 'option': '選', 'preference': '偏好',
  'system': '系', 'application': '應用', 'app': '應用',
  'document': '文檔', 'documentation': '文檔', 'guide': '指南',
  'example': '例', 'sample': '樣', 'demo': '演示',
  'problem': '問題', 'solution': '解法', 'answer': '答', 'question': '問',
  'reason': '原因', 'cause': '起因', 'effect': '效果', 'impact': '響',
  'performance': '性能', 'efficiency': '效率', 'speed': '速',
  'quality': '質', 'security': '安全', 'privacy': '隱私',

  // SpecMem specific - BASE FORMS ONLY
  'specmem': 'SM', 'semantic': '語義', 'episodic': '情節', 'procedural': '程序',
  'drilldown': 'DD', 'traceback': '追蹤', 'conversation': '對話',
  'prompt': '提示', 'hook': '鉤', 'inject': '注',
  'compaction': '壓縮', 'compression': '壓縮ion', 'similarity': '似度',
  'relevance': '相關', 'embedding': '嵌入', 'vector': '向量',
  'team': '隊', 'member': '員', 'agent': '代理',
  'context': '上下文', 'summary': '摘要',

  // Additional common words
  'status': '狀態', 'type': '型', 'following': '後文', 'complexity': '複雜',
  'significant': '顯著', 'improve': '改進', 'improvement': '改進ment',
  'automatic': '自動', 'correct': '正確', 'whether': '是否',
  'specific': '特定', 'different': '不同', 'same': '相同',
  'important': '重要', 'necessary': '必要',
  };
}

// Build reverse mapping (one Chinese code → one English word for decompression)
const REVERSE = {};
for (const [eng, chi] of Object.entries(CODES)) {
  // Only store base form for reverse mapping (avoid duplicates)
  if (!REVERSE[chi]) {
    REVERSE[chi] = eng;
  }
}

// COMBINE all reverse mappings and sort by length (longer first)
// This is critical - longer codes must be replaced before shorter ones
// e.g., "性能" (performance) must be replaced before "能" (able to)
const ALL_REVERSE = { ...REVERSE_PHRASES, ...REVERSE };
const SORTED_ALL_REVERSE = Object.entries(ALL_REVERSE).sort((a, b) => b[0].length - a[0].length);

// ═══════════════════════════════════════════════════════════════════════════
// SUFFIX HANDLING - Preserve English grammatical forms automatically!
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ENGLISH MORPHOLOGY ENGINE - Handles ALL suffix patterns correctly
// Uses standalone version with embedded irregular forms (no external deps)
// ═══════════════════════════════════════════════════════════════════════════
let morphology;
try {
  // Try standalone version first (no external deps)
  morphology = require('./english-morphology-standalone.cjs');
} catch (e1) {
  try {
    // Fallback to full version with wink-lexicon
    morphology = require('./english-morphology.cjs');
  } catch (e2) {
    // Final fallback: no morphology
    morphology = { getBaseForm: (w, C) => ({ base: w, suffix: '' }) };
  }
}

/**
 * Extract base form and suffix using morphology engine
 * Handles: -ing, -ed, -s, -es, -er, -est, irregular forms (ran, wrote, children)
 */
function extractSuffix(word) {
  return morphology.getBaseForm(word, CODES);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPRESSION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a character is Chinese
 */
function isChinese(char) {
  const code = char.charCodeAt(0);
  return code >= 0x4E00 && code <= 0x9FFF;
}

/**
 * Compress text with ultra-aggressive Chinese encoding
 */
function compress(text) {
  if (!text || text.length < 20) return text;

  // Preserve special content
  const preserved = [];
  let idx = 0;

  let result = text
    // Code blocks
    .replace(/```[\s\S]*?```/g, m => { preserved.push(m); return `§${idx++}§`; })
    // Inline code
    .replace(/`[^`]+`/g, m => { preserved.push(m); return `§${idx++}§`; })
    // URLs
    .replace(/https?:\/\/[^\s]+/g, m => { preserved.push(m); return `§${idx++}§`; })
    // File paths (Unix and Windows)
    .replace(/(?:\/[\w.-]+){2,}|[A-Z]:\\[\w\\.-]+/g, m => { preserved.push(m); return `§${idx++}§`; })
    // camelCase identifiers
    .replace(/\b[a-z]+(?:[A-Z][a-z]+)+\b/g, m => { preserved.push(m); return `§${idx++}§`; })
    // PascalCase identifiers
    .replace(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g, m => { preserved.push(m); return `§${idx++}§`; })
    // snake_case identifiers
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, m => { preserved.push(m); return `§${idx++}§`; })
    // SCREAMING_SNAKE_CASE
    .replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, m => { preserved.push(m); return `§${idx++}§`; })
    // Version numbers
    .replace(/\bv?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/g, m => { preserved.push(m); return `§${idx++}§`; });

  // PHASE 1: Replace phrases FIRST (highest savings)
  for (const [phrase, code] of SORTED_PHRASES) {
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, code);
  }

  // PHASE 2: Compress words with ENGLISH SUFFIX PRESERVATION
  // Priority: exact match > base+suffix (server=服, working=工ing)
  result = result.replace(/\b([a-zA-Z']+)\b/g, (match, word) => {
    const lower = word.toLowerCase();
    if (REMOVE.has(lower)) return '';

    // FIRST: Try exact match (server→服, database→資料庫)
    if (CODES.hasOwnProperty(lower)) return CODES[lower];

    // SECOND: Try extracting suffix (working→工ing, created→創ed)
    const { base, suffix } = extractSuffix(word);
    if (suffix && CODES.hasOwnProperty(base)) {
      return CODES[base] + suffix;
    }

    return word; // Keep as-is if no match
  });

  // PHASE 3: Join consecutive Chinese characters (no spaces needed!)
  // This is the key to massive character savings
  result = result.replace(/([一-龥])(\s+)([一-龥])/g, '$1$3');

  // PHASE 4: Use micro-delimiter between Chinese and English/preserved
  result = result.replace(/([一-龥])\s+([a-zA-Z§])/g, `$1${MICRO_SEP}$2`);
  result = result.replace(/([a-zA-Z§])\s+([一-龥])/g, `$1${MICRO_SEP}$2`);

  // Clean up whitespace
  result = result
    .replace(/  +/g, ' ')
    .replace(/\n +/g, '\n')
    .replace(/ +\n/g, '\n')
    .replace(/\n\n\n+/g, '\n\n')
    .replace(/ +([.,!?;:])/g, '$1')
    .trim();

  // Restore preserved content
  for (let i = 0; i < preserved.length; i++) {
    result = result.replace(`§${i}§`, preserved[i]);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// EN-INFLECTORS - Smart verb/noun conjugation for perfect decompression
// ═══════════════════════════════════════════════════════════════════════════
let Inflectors;
try {
  Inflectors = require('en-inflectors').Inflectors;
} catch (e) {
  // Fallback if not installed
  Inflectors = null;
}

/**
 * Intelligently inflect a base word with a suffix marker
 * Uses en-inflectors library for accurate conjugation
 */
function inflectWord(base, suffix) {
  if (!suffix) return base;

  // Use en-inflectors if available
  if (Inflectors) {
    try {
      const inf = new Inflectors(base);
      switch (suffix) {
        case 's':
        case 'es':
          // Could be plural noun OR 3rd person verb
          // Try plural first, fallback to presentS
          const plural = inf.toPlural();
          if (plural !== base) return plural;
          return inf.toPresentS();
        case 'ed':
          return inf.toPast();
        case 'ing':
          return inf.toGerund();
        case 'er':
          // Could be comparative OR agent noun (worker)
          return base + 'er'; // Simple concat for now
        case 'est':
          return base + 'est'; // Superlative
        default:
          return base + suffix;
      }
    } catch (e) {
      // Fallback to simple concat
    }
  }

  // Fallback: smart concat (handle 'e' endings)
  if (base.endsWith('e') && (suffix === 'ed' || suffix === 'es' || suffix === 'er' || suffix === 'est')) {
    return base + suffix.slice(1);
  }
  return base + suffix;
}

/**
 * Decompress text back to English
 * CRITICAL: Uses en-inflectors for proper suffix handling
 */
function decompress(text) {
  if (!text) return text;
  let result = text;

  // Replace micro-delimiter with space
  result = result.split(MICRO_SEP).join(' ');

  // PHASE 1: Replace Chinese codes that have suffixes attached
  // Pattern: ChineseCode + EnglishSuffix → properly inflected English word
  const SUFFIXES = ['tion', 'ment', 'ing', 'ed', 'er', 'est', 'es', 's', 'ly'];

  for (const [chi, eng] of SORTED_ALL_REVERSE) {
    // Try each suffix pattern (longest first for correct matching)
    for (const suf of SUFFIXES) {
      const pattern = chi + suf;
      if (result.includes(pattern)) {
        const inflected = inflectWord(eng, suf);
        result = result.split(pattern).join(` ${inflected} `);
      }
    }
    // Then replace bare Chinese codes
    if (result.includes(chi)) {
      result = result.split(chi).join(` ${eng} `);
    }
  }

  // Clean up multiple spaces and around punctuation
  result = result
    .replace(/\s+([.,!?;:)\]}])/g, '$1')  // no space before punctuation
    .replace(/([(\[{])\s+/g, '$1')        // no space after opening brackets
    .replace(/  +/g, ' ')
    .trim();

  return result;
}

/**
 * Extract semantic words (lemmatized base forms)
 * Uses the same morphology engine as compression for consistency
 */
function getSemanticWords(text) {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !REMOVE.has(w));

  // Use morphology engine for consistent lemmatization
  return words.map(w => {
    // Try morphology engine first (consistent with compression)
    const { base } = morphology.getBaseForm(w, CODES);
    if (base !== w && CODES[base]) {
      return base;
    }

    // Fallback: simple suffix removal for words not in CODES
    // Adverb suffix
    if (w.endsWith('ally') && w.length > 6) return w.slice(0, -4);
    if (w.endsWith('ily') && w.length > 5) return w.slice(0, -3);
    if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);

    // -ing: keep as-is if no match (avoid "creat" problem)
    if (w.endsWith('ing') && w.length > 5) {
      let base = w.slice(0, -3);
      if (base.length > 2 && base[base.length-1] === base[base.length-2]) {
        base = base.slice(0, -1);
      }
      // Check if adding 'e' makes a valid word (creating → create)
      if (CODES[base + 'e']) return base + 'e';
      if (CODES[base]) return base;
      return w; // Keep original if no match
    }

    // -ed: handle various cases
    if (w.endsWith('ed') && w.length > 4) {
      if (w.endsWith('ced') || w.endsWith('ged') || w.endsWith('sed') ||
          w.endsWith('ted') || w.endsWith('ved') || w.endsWith('zed')) {
        if (w.length > 5 && w[w.length-3] === w[w.length-4]) {
          return w.slice(0, -3);
        }
        return w.slice(0, -1);
      }
      return w.slice(0, -2);
    }

    // Plurals: only remove -es for specific endings (s, x, ch, sh + es)
    // Words ending in -ize take -s not -es (initialize → initializes)
    if (w.length > 5) {
      if (w.endsWith('sses')) return w.slice(0, -2); // processes → process
      if (w.endsWith('xes')) return w.slice(0, -2);  // fixes → fix
      if (w.endsWith('ches')) return w.slice(0, -2); // teaches → teach
      if (w.endsWith('shes')) return w.slice(0, -2); // pushes → push
      // NOTE: -zes NOT included because -ize words take -s (initializes → initialize)
    }
    // Regular -s (creates → create, initializes → initialize)
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
      return w.slice(0, -1);
    }

    return w;
  });
}

/**
 * Verify round-trip semantic accuracy
 */
function verifyRoundTrip(original, compressed) {
  const decompressed = decompress(compressed);

  const origWords = getSemanticWords(original);
  const decomWords = getSemanticWords(decompressed);

  if (origWords.length === 0) return { verified: true, accuracy: 1.0 };

  // Count semantic matches (using sets for unique concepts)
  const origSet = new Set(origWords);
  const decomSet = new Set(decomWords);

  let matches = 0;
  for (const word of origSet) {
    if (decomSet.has(word)) matches++;
  }

  const accuracy = matches / origSet.size;
  return { verified: accuracy >= 0.90, accuracy };
}

/**
 * Get compression statistics - CHARACTER based!
 */
function getStats(text) {
  const compressed = compress(text);
  const roundTrip = verifyRoundTrip(text, compressed);

  // CHARACTER savings (the real metric!)
  const origChars = text.length;
  const compChars = compressed.length;
  const charSavings = origChars > 0 ? ((origChars - compChars) / origChars * 100).toFixed(1) : '0.0';

  // Word savings (secondary metric)
  const origWords = text.split(/\s+/).filter(Boolean).length;
  const compWords = compressed.split(/\s+/).filter(Boolean).length;
  const wordSavings = origWords > 0 ? ((origWords - compWords) / origWords * 100).toFixed(1) : '0.0';

  return {
    originalChars: origChars,
    compressedChars: compChars,
    charSavings: charSavings + '%',
    originalWords: origWords,
    compressedWords: compWords,
    wordSavings: wordSavings + '%',
    roundTrip: {
      verified: roundTrip.verified,
      accuracy: (roundTrip.accuracy * 100).toFixed(1) + '%'
    }
  };
}

/**
 * Compress hook output with warning
 * Options:
 *   minLength: minimum text length to compress (default: 30)
 *   includeWarning: prepend compression warning (default: true)
 *   verboseWarning: use multi-line warning (default: false - uses compact single-line)
 *   flattenOutput: join lines with pipe separator instead of newlines (default: false)
 *   preserveStructure: keep original line structure (default: false)
 */
function compressHookOutput(text, options = {}) {
  const minLength = options.minLength || 30;
  const includeWarning = options.includeWarning !== false;
  // Default to compact warning (saves 200+ chars) unless explicitly verbose
  const useVerboseWarning = options.verboseWarning === true;
  // NEW: flattenOutput option to avoid newlines breaking Claude's formatting
  const flattenOutput = options.flattenOutput === true;

  if (!text || text.length < minLength) return text;

  const lines = text.split('\n');
  let anyCompressed = false;

  const compressedLines = lines.map(line => {
    if (line.length < 15) return line;
    if (line.startsWith('#')) return line;
    if (line.startsWith('```')) return line;
    if (/^\s*[-*]\s*`/.test(line)) return line;
    if (line.replace(/[^\w\s]/g, '').length < line.length * 0.4) return line;

    const compressed = compress(line);
    if (compressed !== line) anyCompressed = true;
    return compressed;
  });

  let output;
  if (flattenOutput) {
    // FLATTENED: Join with pipe separator instead of newlines
    output = compressedLines
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .join(' | ');
  } else {
    // COLLAPSE WHITESPACE: Remove multiple blank lines, trim each line
    output = compressedLines
      .map(l => l.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n')  // Collapse 3+ newlines to just 1
      .trim();
  }

  if (includeWarning && anyCompressed) {
    // Use compact (single-line) warning by default
    const warning = useVerboseWarning ? COMPRESSION_WARNING : COMPACT_WARNING;
    return warning + output;
  }
  return output;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
  compress,
  decompress,
  compressHookOutput,
  verifyRoundTrip,
  getStats,
  getSemanticWords, // For debugging
  CODES,
  REVERSE,
  REMOVE,
  PHRASES,
  REVERSE_PHRASES,
  COMPRESSION_WARNING,
  COMPACT_WARNING,
  MICRO_SEP
};

// ═══════════════════════════════════════════════════════════════════════════
// CLI TEST
// ═══════════════════════════════════════════════════════════════════════════
if (require.main === module) {
  const testText = `
The function initializes the database connection and creates a new session.
It will validate the user authentication token and check permissions.
If the request is valid, it returns the response with success status.
The server processes the query and returns the filtered results.
This module handles error logging and provides debug information.
The system should automatically save all changes to the storage.
In order to make sure that the code works correctly, we need to test it.
The following example shows how to use the API endpoint.
Due to the complexity of the problem, we have to implement a custom solution.
As a result, the performance has been significantly improved.
  `.trim();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOKEN COMPRESSOR v6.0 - ULTRA COMPRESSION TEST');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n📄 ORIGINAL:');
  console.log(testText);
  console.log(`\n   Characters: ${testText.length}`);
  console.log(`   Words: ${testText.split(/\s+/).length}`);
  console.log('\n───────────────────────────────────────────────────────────────');

  const compressed = compress(testText);
  console.log('\n🗜️ COMPRESSED:');
  console.log(compressed);
  console.log(`\n   Characters: ${compressed.length}`);
  console.log(`   Words: ${compressed.split(/\s+/).filter(Boolean).length}`);
  console.log('\n───────────────────────────────────────────────────────────────');

  const decompressed = decompress(compressed);
  console.log('\n🔄 DECOMPRESSED:');
  console.log(decompressed);
  console.log('\n───────────────────────────────────────────────────────────────');

  const stats = getStats(testText);
  console.log('\n📊 RESULTS:');
  console.log(`   📏 CHARACTER Savings: ${stats.charSavings} ← PRIMARY METRIC`);
  console.log(`   📝 Word Savings: ${stats.wordSavings}`);
  console.log(`   🔄 Semantic Accuracy: ${stats.roundTrip.accuracy}`);
  console.log(`   ✅ Verified: ${stats.roundTrip.verified ? 'YES!' : 'NO'}`);
  console.log('\n═══════════════════════════════════════════════════════════════');

  // Show phrase compression demo
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PHRASE COMPRESSION DEMO:');
  console.log('═══════════════════════════════════════════════════════════════');
  const phrases = [
    'in order to create a new function',
    'the following example shows how to use',
    'as a result of the change in performance',
    'due to the complexity of the problem',
    'based on the configuration settings',
  ];
  for (const p of phrases) {
    const c = compress(p);
    const pct = ((p.length - c.length) / p.length * 100).toFixed(0);
    console.log(`"${p}"`);
    console.log(`  → "${c}" (${pct}% smaller)`);
    console.log();
  }
  console.log('═══════════════════════════════════════════════════════════════');
}
