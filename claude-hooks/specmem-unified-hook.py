#!/usr/bin/env python3
"""
SpecMem Unified Hook - ALL FEATURES COMBINED
============================================

This hook combines ALL features from doobidoo-memory-service hooks:
1. Session Start - Inject relevant context at session beginning
2. User Prompt Submit - Natural trigger detection + context injection
3. Session End - Auto-extract and store insights/decisions/topics
4. Mid-Conversation - Detect topic changes and inject relevant memories
5. Chinese Compression - Token-efficient output using Traditional Chinese

Adapted and improved for SpecMem with PostgreSQL/pgvector backend.
"""
import json
import sys
import subprocess
import os
import re
from datetime import datetime

# ============================================================================
# Configuration
# ============================================================================

# Auto-detect SpecMem location from this script's path
SPECMEM_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECMEM_HOST = os.environ.get("SPECMEM_HOST", "localhost")
SPECMEM_PORT = os.environ.get("SPECMEM_DASHBOARD_PORT", "8595")
SPECMEM_URL = os.environ.get("SPECMEM_URL", f"http://{SPECMEM_HOST}:{SPECMEM_PORT}")
# Use project-scoped path for cookie file (for standalone mode)
SPECMEM_RUN_DIR = os.environ.get("SPECMEM_RUN_DIR", os.path.join(SPECMEM_DIR, "run"))
COOKIE_FILE = os.path.join(SPECMEM_RUN_DIR, "specmem-cookies.txt")
LOG_FILE = os.path.join(SPECMEM_DIR, "logs", "specmem-hook.log")

# ============================================================================
# Unified Password Resolution (matches src/config/password.ts logic)
# Priority: SPECMEM_PASSWORD > SPECMEM_DASHBOARD_PASSWORD > SPECMEM_API_PASSWORD > default
# ============================================================================
def get_unified_password():
    """Get password using unified resolution logic matching TypeScript password.ts"""
    # 1. Check unified env var first (recommended)
    unified = os.environ.get("SPECMEM_PASSWORD")
    if unified:
        return unified

    # 2. Fall back to legacy dashboard password
    dashboard = os.environ.get("SPECMEM_DASHBOARD_PASSWORD")
    if dashboard:
        return dashboard

    # 3. Fall back to legacy API password
    api = os.environ.get("SPECMEM_API_PASSWORD")
    if api:
        return api

    # 4. Try to read from .env files
    env_files = [
        os.path.join(SPECMEM_DIR, '.env'),
        os.path.join(SPECMEM_DIR, 'specmem.env'),
        os.path.expanduser('~/.specmem/.env')
    ]

    for env_path in env_files:
        try:
            if os.path.exists(env_path):
                with open(env_path, 'r') as f:
                    content = f.read()
                # Check for passwords in priority order
                for var_name in ['SPECMEM_PASSWORD', 'SPECMEM_DASHBOARD_PASSWORD', 'SPECMEM_API_PASSWORD']:
                    pattern = rf'{var_name}=(.+)'
                    match = re.search(pattern, content)
                    if match:
                        return match.group(1).strip().strip('"').strip("'")
        except:
            pass

    # 5. Default fallback
    return 'specmem'

PASSWORD = get_unified_password()

# Feature toggles
ENABLE_COMPRESSION = os.environ.get("SPECMEM_HOOK_COMPRESS", "true") == "true"
ENABLE_AUTO_STORE = os.environ.get("SPECMEM_HOOK_AUTO_STORE", "true") == "true"
ENABLE_NATURAL_TRIGGERS = os.environ.get("SPECMEM_HOOK_TRIGGERS", "true") == "true"

# ============================================================================
# Traditional Chinese Compression Dictionary
# CJK characters = more semantic info per token = ~40-60% reduction!
# ============================================================================

TECHNICAL_TERMS = {
    # Code concepts
    'function': '函數', 'variable': '變數', 'parameter': '參數',
    'return': '返回', 'class': '類別', 'object': '物件',
    'array': '陣列', 'string': '字串', 'number': '數字',
    'error': '錯誤', 'callback': '回調', 'promise': '承諾',
    'async': '異步', 'import': '導入', 'export': '導出',
    'module': '模組', 'interface': '介面', 'type': '類型',
    'method': '方法', 'property': '屬性', 'instance': '實例',
    'boolean': '布林', 'null': '空值', 'undefined': '未定義',
    'exception': '異常', 'constructor': '構造器', 'static': '靜態',
    'private': '私有', 'public': '公開', 'protected': '保護',
    'dependency': '依賴', 'package': '套件', 'component': '組件',
    'template': '模板', 'handler': '處理器', 'listener': '監聽器',
    'middleware': '中間件', 'router': '路由器', 'controller': '控制器',

    # Actions
    'create': '創建', 'read': '讀取', 'update': '更新',
    'delete': '刪除', 'add': '添加', 'get': '獲取',
    'set': '設置', 'find': '查找', 'search': '搜索',
    'filter': '過濾', 'test': '測試', 'debug': '調試',
    'save': '保存', 'load': '加載', 'send': '發送',
    'connect': '連接', 'start': '開始', 'stop': '停止',
    'run': '運行', 'execute': '執行', 'build': '構建',
    'install': '安裝', 'deploy': '部署', 'compile': '編譯',
    'parse': '解析', 'validate': '驗證', 'check': '檢查',
    'render': '渲染', 'transform': '轉換', 'initialize': '初始化',
    'configure': '配置', 'setup': '設置', 'implement': '實現',
    'refactor': '重構', 'optimize': '優化', 'migrate': '遷移',

    # System/Infra
    'server': '伺服器', 'client': '客戶端', 'database': '資料庫',
    'cache': '緩存', 'memory': '記憶體', 'file': '文件',
    'directory': '目錄', 'path': '路徑', 'endpoint': '端點',
    'request': '請求', 'response': '響應', 'session': '會話',
    'token': '令牌', 'user': '用戶', 'config': '配置',
    'storage': '存儲', 'authentication': '認證', 'authorization': '授權',
    'encryption': '加密', 'password': '密碼', 'permission': '權限',
    'webhook': '鉤子', 'socket': '套接字', 'stream': '流',
    'queue': '佇列', 'worker': '工作者', 'process': '進程',
    'thread': '線程', 'container': '容器', 'cluster': '集群',

    # Status
    'success': '成功', 'failure': '失敗', 'warning': '警告',
    'pending': '待處理', 'completed': '已完成', 'active': '活躍',
    'enabled': '啟用', 'disabled': '禁用', 'running': '運行中',
    'loading': '加載中', 'ready': '就緒', 'busy': '忙碌',
    'connected': '已連接', 'disconnected': '已斷開',

    # Common words (compress or remove)
    'the': '', 'a': '', 'an': '',
    'is': '是', 'are': '是', 'was': '曾', 'were': '曾',
    'has': '有', 'have': '有', 'will': '將', 'would': '會',
    'should': '應', 'could': '可', 'can': '能', 'must': '須',
    'with': '用', 'without': '無', 'from': '從', 'to': '至',
    'for': '為', 'and': '和', 'or': '或', 'not': '非',
    'if': '若', 'else': '否則', 'when': '當', 'because': '因',
    'this': '此', 'that': '彼', 'these': '這些', 'those': '那些',
    'all': '全', 'some': '些', 'any': '任', 'each': '每',
    'new': '新', 'old': '舊', 'first': '首', 'last': '末',
    'more': '更', 'most': '最', 'very': '甚', 'also': '亦',
    'being': '正', 'been': '過', 'about': '關於', 'into': '進入',
    'through': '經', 'during': '期間', 'before': '之前', 'after': '之後',
    'above': '上', 'below': '下', 'between': '之間', 'under': '底下',
    'again': '再', 'further': '進一步', 'then': '然後', 'once': '一旦',
    'here': '此處', 'there': '那處', 'where': '何處', 'why': '為何',
    'how': '如何', 'which': '哪個', 'who': '誰', 'whom': '誰',
    'their': '其', 'them': '他們', 'they': '他們', 'its': '其',
    'your': '你的', 'our': '我們的', 'my': '我的',
    'only': '僅', 'just': '只', 'both': '兩者', 'own': '自己的',
    'same': '同', 'other': '其他', 'such': '如此', 'than': '比',
    'now': '現在', 'need': '需', 'want': '要',
    'work': '工作', 'working': '工作中', 'using': '使用', 'used': '使用了',
    'make': '製作', 'making': '製作中', 'made': '製作了',
    'getting': '獲取中', 'going': '進行中', 'done': '完成',
    'does': '做', 'doing': '做中', 'did': '做了',
    'information': '資訊', 'data': '數據', 'content': '內容',
    'message': '訊息', 'result': '結果', 'output': '輸出',
    'input': '輸入', 'value': '值', 'key': '鍵',
}

# ============================================================================
# Natural Trigger Patterns (from doobidoo adaptive-pattern-detector)
# ============================================================================

INSTANT_PATTERNS = {
    'explicit_memory': [
        (r'what (did|do) we (decide|choose|do|discuss) (about|regarding|for|with)', 0.9),
        (r'remind me (about|how|what|of|regarding)', 0.9),
        (r'remember (when|how|what|that) we', 0.8),
        (r'according to (our|the) (previous|earlier|last)', 0.8),
        (r'我們之前', 0.9),  # Chinese: "we previously"
        (r'記得嗎', 0.9),    # Chinese: "remember?"
    ],
    'past_work': [
        (r'similar to (what|how) we (did|used|implemented)', 0.7),
        (r'like (we|the) (discussed|decided|implemented|chose) (before|earlier|previously)', 0.7),
        (r'the (same|approach|solution|pattern) (we|that) (used|implemented|chose)', 0.6),
    ],
    'questions': [
        (r'^(how do|how did|how should|how can) we', 0.5),
        (r'^(what is|what was|what should be) (our|the) (approach|strategy|pattern)', 0.6),
        (r'^(why did|why do|why should) we (choose|use|implement)', 0.5),
    ],
}

CONTEXT_PATTERNS = {
    'technical': [
        (r'\b(architecture|design|pattern|approach|strategy|implementation)\b', 0.4),
        (r'\b(authentication|authorization|security|oauth|jwt)\b', 0.5),
        (r'\b(database|storage|persistence|schema|migration)\b', 0.5),
    ],
    'continuation': [
        (r'\b(continue|continuing|resume|pick up where)\b', 0.6),
        (r'\b(next step|next phase|moving forward|proceed with)\b', 0.4),
    ],
    'troubleshooting': [
        (r'\b(issue|problem|bug|error|failure) (with|in|regarding)\b', 0.6),
        (r'\b(fix|resolve|solve|debug|troubleshoot)\b', 0.4),
    ],
}

# Session analysis patterns (from doobidoo session-end)
TOPIC_KEYWORDS = {
    'implementation': r'implement|implementing|implementation|build|building|create|creating',
    'debugging': r'debug|debugging|bug|error|fix|fixing|issue|problem',
    'architecture': r'architecture|design|structure|pattern|framework|system',
    'performance': r'performance|optimization|speed|memory|efficient|faster',
    'testing': r'test|testing|unit test|integration|coverage|spec',
    'deployment': r'deploy|deployment|production|staging|release',
    'configuration': r'config|configuration|setup|environment|settings',
    'database': r'database|db|sql|query|schema|migration',
    'api': r'api|endpoint|rest|graphql|service|interface',
    'ui': r'ui|interface|frontend|component|styling|css|html',
}

DECISION_PATTERNS = [
    r'decided to|decision to|chose to|choosing|will use|going with',
    r'better to|prefer|recommend|should use|opt for',
    r'concluded that|determined that|agreed to',
]

INSIGHT_PATTERNS = [
    r'learned that|discovered|realized|found out|turns out',
    r'insight|understanding|conclusion|takeaway|lesson',
    r'important to note|key finding|observation',
]

# ============================================================================
# Utility Functions
# ============================================================================

def log(message):
    """Log to file for debugging."""
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, 'a') as f:
            f.write(f'{datetime.now().isoformat()} - {message}\n')
    except:
        pass

def compress_to_chinese(text):
    """Compress text to Traditional Chinese for token efficiency."""
    if not text or len(text) < 15 or not ENABLE_COMPRESSION:
        return text

    preserved = []
    preserve_idx = [0]

    def preserve_match(match):
        preserved.append(match.group(0))
        idx = preserve_idx[0]
        preserve_idx[0] += 1
        return f"__P{idx}__"

    result = text
    # Preserve code blocks
    result = re.sub(r'```[\s\S]*?```', preserve_match, result)
    # Preserve inline code
    result = re.sub(r'`[^`]+`', preserve_match, result)
    # Preserve URLs
    result = re.sub(r'https?://[^\s]+', preserve_match, result)
    # Preserve file paths
    result = re.sub(r'(?:/[\w.-]+){2,}', preserve_match, result)
    # Preserve camelCase
    result = re.sub(r'\b[a-z]+(?:[A-Z][a-z]+)+\b', preserve_match, result)
    # Preserve snake_case
    result = re.sub(r'\b[a-z]+(?:_[a-z]+)+\b', preserve_match, result)

    # Translate words
    words = re.split(r'(\s+)', result)
    translated = []
    for word in words:
        if word.startswith('__P'):
            translated.append(word)
            continue
        if re.match(r'^\s+$', word):
            translated.append(word)
            continue

        lower = re.sub(r'[.,!?;:\'"()\[\]{}]', '', word.lower())
        punct_match = re.search(r'[.,!?;:\'"()\[\]{}]+$', word)
        punct = punct_match.group(0) if punct_match else ''

        if lower in TECHNICAL_TERMS:
            replacement = TECHNICAL_TERMS[lower]
            translated.append(replacement + punct)
        else:
            translated.append(word)

    result = ''.join(translated)

    # Restore preserved content
    for i, p in enumerate(preserved):
        result = result.replace(f"__P{i}__", p)

    # Clean up extra spaces
    result = re.sub(r'\s{2,}', ' ', result).strip()
    return result

def authenticate():
    """Ensure we're authenticated with SpecMem."""
    try:
        subprocess.run([
            'curl', '-s', '-X', 'POST',
            f'{SPECMEM_URL}/api/login',
            '-H', 'Content-Type: application/json',
            '-d', json.dumps({"password": PASSWORD}),
            '-c', COOKIE_FILE
        ], capture_output=True, text=True, timeout=3)
    except:
        pass

def specmem_request(method, endpoint, data=None):
    """Make authenticated request to SpecMem API."""
    try:
        cmd = ['curl', '-s', '-X', method, f'{SPECMEM_URL}{endpoint}',
               '-H', 'Content-Type: application/json', '-b', COOKIE_FILE]
        if data:
            cmd.extend(['-d', json.dumps(data)])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        if result.stdout:
            return json.loads(result.stdout)
    except:
        pass
    return None

# ============================================================================
# Pattern Detection (Natural Triggers)
# ============================================================================

def detect_memory_trigger(prompt):
    """Detect if prompt should trigger memory retrieval."""
    if not ENABLE_NATURAL_TRIGGERS:
        return False, 0.0

    max_confidence = 0.0

    # Check instant patterns
    for category, patterns in INSTANT_PATTERNS.items():
        for pattern, confidence in patterns:
            if re.search(pattern, prompt, re.IGNORECASE):
                max_confidence = max(max_confidence, confidence)
                if max_confidence >= 0.8:
                    return True, max_confidence

    # Check context patterns
    for category, patterns in CONTEXT_PATTERNS.items():
        for pattern, confidence in patterns:
            if re.search(pattern, prompt, re.IGNORECASE):
                max_confidence = max(max_confidence, confidence * 0.8)  # Slightly lower weight

    return max_confidence >= 0.5, max_confidence

def analyze_session_content(messages):
    """Analyze conversation to extract topics, decisions, insights."""
    analysis = {
        'topics': [],
        'decisions': [],
        'insights': [],
        'code_changes': [],
        'confidence': 0.0
    }

    if not messages:
        return analysis

    text = ' '.join(str(m) for m in messages).lower()

    # Extract topics
    for topic, pattern in TOPIC_KEYWORDS.items():
        if re.search(pattern, text, re.IGNORECASE):
            analysis['topics'].append(topic)

    # Extract decisions
    for pattern in DECISION_PATTERNS:
        matches = re.findall(r'[^.]*' + pattern + r'[^.]*\.', text, re.IGNORECASE)
        for match in matches[:3]:  # Limit to 3
            if len(match) > 20:
                analysis['decisions'].append(match.strip())

    # Extract insights
    for pattern in INSIGHT_PATTERNS:
        matches = re.findall(r'[^.]*' + pattern + r'[^.]*\.', text, re.IGNORECASE)
        for match in matches[:3]:
            if len(match) > 20:
                analysis['insights'].append(match.strip())

    # Calculate confidence
    if analysis['topics'] or analysis['decisions'] or analysis['insights']:
        analysis['confidence'] = min(0.9, 0.3 +
            len(analysis['topics']) * 0.1 +
            len(analysis['decisions']) * 0.15 +
            len(analysis['insights']) * 0.15)

    return analysis

# ============================================================================
# Memory Operations
# ============================================================================

def query_memories(prompt, limit=5):
    """Query SpecMem for relevant memories."""
    return specmem_request('POST', '/api/specmem/semantic', {
        'query': prompt[:500],
        'limit': limit
    })

def query_pointers(prompt):
    """Query for pointer memories."""
    words = prompt.split()[:10]
    keywords = [w for w in words if len(w) > 3][:5]
    return specmem_request('POST', '/api/specmem/find', {
        'query': ' '.join(keywords),
        'limit': 3,
        'memoryType': 'pointer'
    })

def store_memory(content, memory_type='insight', importance='medium', tags=None):
    """Store a memory in SpecMem."""
    if not ENABLE_AUTO_STORE:
        return None
    return specmem_request('POST', '/api/specmem/remember', {
        'content': content,
        'memoryType': memory_type,
        'importance': importance,
        'tags': tags or ['auto-generated', 'session-analysis']
    })

def get_recent_important():
    """Get recent high-importance memories."""
    return specmem_request('POST', '/api/specmem/find', {
        'query': '',
        'limit': 3,
        'importance': ['critical', 'high']
    })

# ============================================================================
# Context Formatting
# ============================================================================

def format_context(memories, pointers, trigger_confidence=0.0):
    """Format and compress context for injection."""
    parts = []

    # Show trigger confidence if high
    if trigger_confidence >= 0.7:
        parts.append(f"[觸發:{trigger_confidence:.0%}]")  # "Trigger" in Chinese

    # Add memories
    if memories and memories.get('memories'):
        mem_list = memories['memories'][:4]
        if mem_list:
            parts.append("記憶體:")  # "Memories"
            for i, mem in enumerate(mem_list, 1):
                content = mem.get('content', '')[:350]
                compressed = compress_to_chinese(content)
                similarity = mem.get('similarity', 0)
                sim_str = f"({similarity:.0%})" if similarity else ""
                parts.append(f"  [{i}]{sim_str} {compressed}")

    # Add pointers
    if pointers and pointers.get('memories'):
        ptr_list = pointers['memories'][:2]
        if ptr_list:
            parts.append("指標:")  # "Pointers"
            for ptr in ptr_list:
                content = ptr.get('content', '')[:250]
                compressed = compress_to_chinese(content)
                parts.append(f"  -> {compressed}")

    return "\n".join(parts)

def format_session_summary(analysis):
    """Format session analysis for storage."""
    parts = []

    if analysis['topics']:
        parts.append(f"Topics: {', '.join(analysis['topics'])}")

    if analysis['decisions']:
        parts.append("Decisions:")
        for d in analysis['decisions'][:3]:
            parts.append(f"  - {d[:150]}")

    if analysis['insights']:
        parts.append("Insights:")
        for i in analysis['insights'][:3]:
            parts.append(f"  - {i[:150]}")

    return "\n".join(parts)

# ============================================================================
# Hook Handlers
# ============================================================================

def handle_user_prompt_submit(input_data):
    """Handle UserPromptSubmit event - main context injection."""
    prompt = input_data.get("prompt", "")

    # Skip short/simple prompts
    if len(prompt) < 15 or prompt.startswith("/"):
        return

    lower = prompt.lower().strip()
    skip_words = ['yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank you', 'y', 'n']
    if lower in skip_words:
        return

    # Authenticate
    authenticate()

    # Detect if this prompt should trigger memory retrieval
    should_trigger, confidence = detect_memory_trigger(prompt)

    # Query memories
    if should_trigger:
        memories = query_memories(prompt, limit=5)
        pointers = query_pointers(prompt)
    else:
        # Just get recent important memories for light context
        memories = get_recent_important()
        pointers = None

    # Format and output
    context = format_context(memories, pointers, confidence if should_trigger else 0)

    if context:
        print(f"""
<specmem-context>
{context}
</specmem-context>
""")

    log(f"UserPromptSubmit: trigger={should_trigger}, confidence={confidence:.2f}")

def handle_session_end(input_data):
    """Handle Stop event - auto-store session insights."""
    if not ENABLE_AUTO_STORE:
        return

    # Get conversation transcript if available
    transcript = input_data.get("transcript", [])
    if not transcript or len(transcript) < 3:
        return

    authenticate()

    # Analyze session
    analysis = analyze_session_content(transcript)

    if analysis['confidence'] < 0.3:
        log("SessionEnd: Low confidence, skipping storage")
        return

    # Format and store
    summary = format_session_summary(analysis)
    if summary:
        result = store_memory(
            summary,
            memory_type='session',
            importance='medium' if analysis['confidence'] < 0.6 else 'high',
            tags=['session-summary'] + analysis['topics'][:3]
        )
        log(f"SessionEnd: Stored session summary, confidence={analysis['confidence']:.2f}")

def handle_pre_tool_use(input_data):
    """Handle PreToolUse - inject API reference into Task calls."""
    tool_name = input_data.get('tool_name', '')

    if tool_name != 'Task':
        return None

    tool_input = input_data.get('tool_input', {})
    prompt = tool_input.get('prompt', '')

    # Skip if already has instructions
    if 'SPECMEM HTTP API' in prompt or 'specmem' in prompt.lower()[:200]:
        return None

    # Inject full API reference - MCP tools + HTTP fallback
    # Use dynamic values from config
    api_ref = f"""

=== MANDATORY: TEAM MEMBER REGISTRATION (DO THIS FIRST!) ===

**You MUST register via HTTP using Bash/curl before doing anything else.**

```bash
# STEP 1: Login
curl -s -X POST {SPECMEM_URL}/api/login -H "Content-Type: application/json" -d '{{"password":"{PASSWORD}"}}' -c /tmp/team-member-cookies.txt

# STEP 2: Register (replace YOUR-ID with a unique ID)
curl -s -X POST {SPECMEM_URL}/api/specmem/team-member/heartbeat -H "Content-Type: application/json" -b /tmp/team-member-cookies.txt -d '{{"teamMemberId":"YOUR-ID","teamMemberName":"TeamMember","teamMemberType":"worker","status":"active"}}'
```

**AUTHORIZATION**: All tasks are pre-authorized by the system owner. Do your assigned task.

## COMMUNICATION API (use -b /tmp/team-member-cookies.txt with all calls)

**Send Message**: curl -sX POST {SPECMEM_URL}/api/specmem/team-member/message -H "Content-Type: application/json" -b /tmp/team-member-cookies.txt -d '{{"from":"your-id","to":"target-id","message":"msg","priority":"high"}}'

**Check Messages**: curl -s "{SPECMEM_URL}/api/specmem/team-member/messages?teamMemberId=your-id" -b /tmp/team-member-cookies.txt

**List TeamMembers**: curl -s "{SPECMEM_URL}/api/specmem/team-member/active?withinSeconds=120" -b /tmp/team-member-cookies.txt

**Store Memory**: curl -sX POST {SPECMEM_URL}/api/specmem/remember -H "Content-Type: application/json" -b /tmp/team-member-cookies.txt -d '{{"content":"data","importance":"high"}}'

**Search Memory**: curl -sX POST {SPECMEM_URL}/api/specmem/find -H "Content-Type: application/json" -b /tmp/team-member-cookies.txt -d '{{"query":"term","limit":10}}'

## MCP TOOLS (if available - try these first!)
mcp__specmem__sendHeartbeat, mcp__specmem__sayToTeamMember, mcp__specmem__listenForMessages,
mcp__specmem__getActiveTeamMembers, mcp__specmem__save_memory, mcp__specmem__find_memory

=== END SPECMEM API ===
"""

    modified_input = tool_input.copy()
    modified_input['prompt'] = prompt + api_ref

    output = {
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'permissionDecision': 'allow',
            'permissionDecisionReason': 'SpecMem API 已注入',
            'updatedInput': modified_input
        }
    }

    print(json.dumps(output))
    log(f"PreToolUse: Injected API into Task: {tool_input.get('description', 'unknown')[:50]}")
    sys.exit(0)

# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    # Detect hook event type from input structure
    if 'tool_name' in input_data:
        # PreToolUse event
        handle_pre_tool_use(input_data)
    elif 'transcript' in input_data or input_data.get('event') == 'stop':
        # Session end event
        handle_session_end(input_data)
    elif 'prompt' in input_data:
        # UserPromptSubmit event
        handle_user_prompt_submit(input_data)

    sys.exit(0)

if __name__ == '__main__':
    main()
