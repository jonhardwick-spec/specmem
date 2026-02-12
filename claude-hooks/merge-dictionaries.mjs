#!/usr/bin/env node
/**
 * MERGE DICTIONARIES
 * ==================
 *
 * Merges CC-CEDICT extracted translations with our curated programming dictionary.
 * OUR CURATED TERMS OVERRIDE CEDICT for programming accuracy.
 *
 * Output: merged-codes.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load CEDICT extracted translations
const cedictPath = join(__dirname, 'cedict-extracted.json');
const cedict = JSON.parse(readFileSync(cedictPath, 'utf8'));

console.log(`Loaded ${Object.keys(cedict).length} CEDICT entries`);

// Our curated programming-focused codes (OVERRIDE CEDICT)
const CURATED_CODES = {
  // ═══════════════════════════════════════════════════════════════════════════
  // PROGRAMMING TERMS - These MUST override CEDICT's general translations
  // ═══════════════════════════════════════════════════════════════════════════

  // Core programming
  'function': '函', 'variable': '變', 'parameter': '參', 'argument': '實參',
  'return': '返', 'class': '類', 'object': '物', 'array': '陣', 'string': '串',
  'number': '數', 'boolean': '布', 'value': '值', 'method': '法',
  'property': '屬', 'interface': '介', 'module': '模組', 'package': '包',
  'library': '庫', 'framework': '架', 'dependency': '賴', 'null': '空值',
  'undefined': '未定義', 'error': '錯', 'exception': '異', 'warning': '警',
  'debug': '調試', 'memory': '記', 'buffer': '緩', 'stack': '棧', 'heap': '堆',
  'queue': '列', 'callback': '回', 'promise': '諾', 'async': '異步',
  'await': '等待', 'sync': '同步', 'import': '導入', 'export': '導出', 'require': '需',
  'const': '恆', 'let': '讓', 'var': '宣',

  // Actions
  'create': '創', 'read': '讀', 'update': '更', 'delete': '刪', 'add': '加',
  'remove': '除', 'insert': '插', 'find': '找', 'found': '找',
  'search': '搜', 'filter': '濾', 'sort': '排', 'parse': '析', 'format': '格式',
  'validate': '驗', 'check': '查', 'test': '試', 'verify': '核', 'load': '載',
  'save': '存', 'store': '儲', 'storage': '儲存', 'fetch': '取', 'send': '送',
  'sent': '送', 'receive': '收', 'connect': '連', 'disconnect': '斷', 'start': '啟',
  'stop': '停', 'run': '跑', 'ran': '跑', 'execute': '執', 'call': '呼',
  'invoke': '喚', 'trigger': '觸', 'handle': '理', 'process': '處',
  'initialize': '初', 'configure': '配置', 'setup': '設立', 'install': '裝',
  'deploy': '部', 'build': '建', 'built': '建', 'compile': '編',
  'render': '渲', 'display': '顯', 'show': '示', 'hide': '藏', 'hidden': '藏',
  'enable': '啟用', 'disable': '禁', 'open': '開', 'close': '閉',
  'write': '寫', 'wrote': '寫', 'written': '寫', 'use': '用',
  'provide': '供', 'include': '含', 'contain': '容納', 'work': '工',
  'change': '改', 'modify': '修改', 'fix': '修復', 'resolve': '解',
  'implement': '實', 'define': '定', 'declare': '聲', 'assign': '賦',
  'convert': '轉', 'transform': '變換', 'map': '映', 'reduce': '減',
  'merge': '併', 'split': '拆', 'join': '聯', 'copy': '複', 'move': '移',
  'replace': '換', 'match': '匹配', 'compare': '比', 'calculate': '算',
  'count': '計', 'print': '印', 'log': '誌', 'trace': '跟', 'monitor': '監',
  'watch': '觀', 'listen': '聽', 'wait': '待', 'retry': '重試',
  'reset': '重設', 'clear': '清', 'extend': '延', 'inherit': '繼',
  'override': '覆', 'encode': '編碼', 'decode': '解碼', 'encrypt': '加密',
  'decrypt': '解密', 'compress': '壓', 'decompress': '解壓',

  // System/Infrastructure
  'server': '服', 'client': '客', 'database': '資料庫', 'cache': '快取',
  'file': '檔', 'directory': '目錄', 'folder': '夾', 'path': '徑',
  'request': '求', 'response': '應', 'query': '詢', 'session': '會',
  'token': '令', 'user': '戶', 'admin': '管理', 'permission': '權',
  'role': '角', 'authentication': '認證', 'authorization': '授權',
  'connection': '接', 'socket': '套接', 'port': '埠', 'host': '主機',
  'domain': '網域', 'endpoint': '端點', 'route': '路由',
  'url': 'URL', 'api': 'API', 'rest': 'REST', 'http': 'HTTP', 'https': 'HTTPS',
  'service': '務', 'container': '容器', 'cluster': '群集', 'node': '節點',
  'network': '網', 'proxy': '代理', 'event': '事件', 'message': '訊息',
  'channel': '頻', 'stream': '流', 'thread': '緒', 'task': '任務',
  'job': '作業', 'worker': '工作者', 'timeout': '逾時', 'interval': '間隔',

  // Data structures
  'list': '單', 'set': '集', 'dict': '典', 'dictionary': '典',
  'tree': '樹', 'graph': '圖', 'table': '表', 'row': '行', 'column': '欄',
  'record': '錄', 'field': '欄位', 'index': '索引', 'key': '鍵', 'id': 'ID',
  'pointer': '指', 'reference': '參引', 'link': '鏈', 'parent': '父',
  'child': '子', 'children': '子', 'root': '根', 'leaf': '葉', 'branch': '支',
  'depth': '深', 'level': '級', 'layer': '層',

  // Status/State
  'success': '成功', 'failure': '失敗', 'fail': '失敗', 'complete': '完成',
  'incomplete': '未完', 'pending': '待處理', 'active': '活躍', 'inactive': '不活',
  'valid': '有效', 'invalid': '無效', 'available': '可用', 'unavailable': '不可用',
  'online': '在線', 'offline': '離線', 'ready': '備', 'busy': '忙', 'idle': '閒',
  'visible': '可見', 'locked': '鎖', 'unlocked': '解鎖', 'empty': '空', 'full': '滿',
  'new': '新', 'old': '舊', 'current': '當前', 'previous': '前', 'next': '下',
  'first': '首', 'last': '末', 'latest': '最新', 'oldest': '最舊',
  'default': '默認', 'custom': '自定', 'local': '本地', 'remote': '遠程', 'global': '全局',
  'public': '公', 'private': '私', 'protected': '護',
  'static': '靜態', 'dynamic': '動態', 'constant': '常量',
  'temporary': '臨時', 'permanent': '永久', 'optional': '可選',
  'true': '真', 'false': '假',

  // Common nouns
  'code': '碼', 'data': '據', 'information': '資訊', 'result': '果',
  'output': '輸出', 'input': '輸入', 'content': '內容',
  'text': '文', 'name': '名', 'title': '標題', 'label': '標籤',
  'tag': '標', 'category': '類別', 'group': '群組', 'size': '大小',
  'length': '長', 'total': '總', 'sum': '和', 'average': '均',
  'maximum': '最大', 'max': '最大', 'minimum': '最小', 'min': '最小',
  'range': '範圍', 'limit': '限', 'threshold': '閾值', 'offset': '偏移',
  'position': '位', 'location': '位置', 'time': '時', 'date': '日',
  'timestamp': '時戳', 'duration': '持續', 'project': '專案', 'version': '版',
  'release': '發布', 'issue': '問題', 'bug': '蟲', 'feature': '功能',
  'component': '元件', 'element': '元素', 'item': '項', 'entry': '條目',
  'entity': '實體', 'model': '模型', 'schema': '綱要', 'template': '模板',
  'pattern': '模式', 'design': '設計', 'architecture': '架構',
  'structure': '結構', 'style': '樣式', 'config': '配置',
  'configuration': '配置', 'setting': '設置', 'option': '選項', 'preference': '偏好',
  'system': '系統', 'application': '應用', 'app': '應用',
  'document': '文檔', 'documentation': '文檔', 'guide': '指南',
  'example': '例', 'sample': '樣本', 'demo': '演示',
  'problem': '問題', 'solution': '解法', 'answer': '答', 'question': '問',
  'reason': '原因', 'cause': '起因', 'effect': '效果', 'impact': '影響',
  'performance': '性能', 'efficiency': '效率', 'speed': '速度',
  'quality': '質量', 'security': '安全', 'privacy': '隱私',

  // SpecMem specific
  'specmem': 'SM', 'semantic': '語義', 'episodic': '情節', 'procedural': '程序',
  'drilldown': 'DD', 'traceback': '追蹤', 'conversation': '對話',
  'prompt': '提示', 'hook': '鉤', 'inject': '注入',
  'compaction': '壓縮', 'compression': '壓縮', 'similarity': '相似度',
  'relevance': '相關', 'embedding': '嵌入', 'vector': '向量',
  'team': '隊', 'member': '員', 'agent': '代理',
  'context': '上下文', 'summary': '摘要',

  // Additional common
  'status': '狀態', 'type': '類型', 'following': '後文', 'complexity': '複雜度',
  'significant': '顯著', 'improve': '改進', 'improvement': '改進',
  'automatic': '自動', 'correct': '正確', 'whether': '是否',
  'specific': '特定', 'different': '不同', 'same': '相同',
  'important': '重要', 'necessary': '必要',
};

console.log(`Loaded ${Object.keys(CURATED_CODES).length} curated codes\n`);

// Merge: start with CEDICT, override with CURATED
const merged = { ...cedict };

// Override with curated codes
let overridden = 0;
for (const [eng, chi] of Object.entries(CURATED_CODES)) {
  if (merged[eng] && merged[eng] !== chi) {
    overridden++;
  }
  merged[eng] = chi;
}

console.log(`Overridden ${overridden} CEDICT entries with curated codes`);
console.log(`Final merged dictionary: ${Object.keys(merged).length} entries\n`);

// Character length distribution
const lengths = {};
for (const chi of Object.values(merged)) {
  const len = chi.length;
  lengths[len] = (lengths[len] || 0) + 1;
}
console.log('Character length distribution:');
for (const [len, count] of Object.entries(lengths).sort((a, b) => a[0] - b[0])) {
  console.log(`  ${len} char: ${count} entries`);
}

// Calculate potential savings
const totalEngChars = Object.keys(merged).reduce((sum, w) => sum + w.length, 0);
const totalChiChars = Object.values(merged).reduce((sum, w) => sum + w.length, 0);
const savings = ((1 - totalChiChars / totalEngChars) * 100).toFixed(1);
console.log(`\nPotential savings: ${savings}% (${totalEngChars} eng → ${totalChiChars} chi chars)`);

// Sample outputs
console.log('\n=== SAMPLE PROGRAMMING TERMS (CURATED) ===');
const progTerms = ['function', 'variable', 'database', 'server', 'error', 'success', 'async', 'component'];
for (const term of progTerms) {
  console.log(`  ${term.padEnd(12)} → ${merged[term]}`);
}

console.log('\n=== SAMPLE GENERAL TERMS (FROM CEDICT) ===');
const genTerms = ['beautiful', 'happy', 'quickly', 'tomorrow', 'understand', 'remember', 'important', 'together'];
for (const term of genTerms) {
  if (merged[term]) {
    console.log(`  ${term.padEnd(12)} → ${merged[term]}`);
  }
}

// Write output
const outputPath = join(__dirname, 'merged-codes.json');
writeFileSync(outputPath, JSON.stringify(merged, null, 2));
console.log(`\nWrote ${Object.keys(merged).length} entries to ${outputPath}`);

// Also generate the JavaScript code format for direct inclusion
const jsCodePath = join(__dirname, 'merged-codes.cjs');
const jsContent = `// AUTO-GENERATED FROM CC-CEDICT + CURATED CODES
// ${Object.keys(merged).length} entries
// Generated: ${new Date().toISOString()}
module.exports = ${JSON.stringify(merged, null, 2)};
`;
writeFileSync(jsCodePath, jsContent);
console.log(`Wrote JavaScript module to ${jsCodePath}`);
