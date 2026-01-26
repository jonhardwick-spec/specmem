# SpecMem AutoClaude - Autonomous Task Execution

## COMMAND PARSING - READ THIS FIRST

Parse what comes after `/specmem-autoclaude`:

**CRITICAL: Check for empty/missing arguments FIRST**

```
ARGS = everything after "/specmem-autoclaude "
ARGS = ARGS.trim()
```

**Decision tree:**
1. If ARGS is empty OR ARGS === "" → **STOP. Output HELP TEXT below. Do NOT proceed.**
2. If ARGS === "help" OR ARGS === "-h" OR ARGS === "--help" → **STOP. Output HELP TEXT below. Do NOT proceed.**
3. If ARGS has content (the task prompt) → Continue to AUTOCLAUDE WORKFLOW

---

## HELP TEXT - OUTPUT THIS EXACTLY THEN STOP

**When to show:** Empty args, no args, or "help" argument.

**ACTION:** Output the text below verbatim, then STOP. Do not call any MCP tools.

```
SpecMem AutoClaude - Autonomous Task Execution

USAGE:
  /specmem-autoclaude "<task>"    Execute task autonomously
  /specmem-autoclaude help        Show this help

EXAMPLES:
  /specmem-autoclaude "fix the login bug"
  /specmem-autoclaude "improve websocket performance"
  /specmem-autoclaude "add dark mode to dashboard"

WHAT IT DOES:
  1. Searches SpecMem for relevant memories
  2. Finds related code files in codebase
  3. Creates todo list and executes task autonomously
  4. Saves learnings for future reference

REQUIRED:
  - You MUST provide a task in quotes
  - Empty command shows this help

TIPS:
  - Be specific about what you want
  - Works best with tasks discussed before
  - Check /specmem-stats for available context

MCP TOOLS USED:
  - mcp__specmem__find_memory (search memories)
  - mcp__specmem__find_code_pointers (search code)
  - mcp__specmem__save_memory (store learnings)

RELATED:
  /specmem-find      Search memories only
  /specmem-code      Search code only
  /specmem-stats     View memory statistics
```

**STOP HERE IF SHOWING HELP. Do not continue to workflow.**

---

## AUTOCLAUDE WORKFLOW

**PREREQUISITE:** A task prompt MUST be provided. If $TASK is empty, go back to HELP TEXT.

When a task is provided, execute these steps:

### Step 1: Gather Memory Context

Search for relevant memories about the task:

**Call mcp__specmem__find_memory:**
```
{
  "query": "$TASK",
  "limit": 10,
  "summarize": false,
  "keywordFallback": true,
  "includeRecent": 5
}
```

Also search for related issues and problems:
```
{
  "query": "problem issue bug error $TASK",
  "limit": 5,
  "summarize": true
}
```

**PARAMETERS:**
- query: string (REQUIRED) - what to search for
- limit: number (default: 10) - max results
- summarize: boolean (default: true) - truncate content
- keywordFallback: boolean (default: true) - fallback to keyword search
- includeRecent: number (default: 0) - force include N recent memories

### Step 2: Find Relevant Code

Use semantic code search to find related files:

**Call mcp__specmem__find_code_pointers:**
```
{
  "query": "$TASK",
  "limit": 10,
  "threshold": 0.1,
  "includeTracebacks": true,
  "includeMemoryLinks": true,
  "zoom": 50
}
```

**PARAMETERS:**
- query: string (REQUIRED) - what code to search for
- limit: number (default: 10) - max results
- threshold: number (default: 0.1) - min similarity 0-1
- includeTracebacks: boolean (default: true) - show caller/callee
- includeMemoryLinks: boolean (default: true) - link to memories
- zoom: number (default: 50) - detail level 0-100

### Step 3: Create Todo List

Based on the memories and code found, create actionable todos:

**Call TodoWrite:**
```
[
  {
    content: "Analyze current implementation",
    status: "in_progress",
    activeForm: "Analyzing implementation"
  },
  {
    content: "Implement fix/improvement",
    status: "pending",
    activeForm: "Implementing changes"
  },
  {
    content: "Test changes",
    status: "pending",
    activeForm: "Testing changes"
  },
  {
    content: "Save learnings to SpecMem",
    status: "pending",
    activeForm: "Saving learnings"
  }
]
```

### Step 4: Execute Autonomously

**RULES:**
1. Read files BEFORE editing (use Read tool)
2. Make targeted, focused changes (use Edit tool)
3. Test after significant changes (use Bash tool if needed)
4. Update todos as you progress (mark completed, add new ones)
5. If you get stuck, save progress and report

**WORKFLOW:**
- Mark first todo as "in_progress"
- Complete the task
- Mark as "completed" when done
- Move to next todo

### Step 5: Save Learnings

When task is complete, save a comprehensive memory:

**Call mcp__specmem__save_memory:**
```
{
  "content": "Task: $TASK\n\nChanges Made:\n- [list specific changes]\n- [one change per line]\n\nFiles Modified:\n- [absolute path 1]\n- [absolute path 2]\n\nKey Learnings:\n[insights gained]\n[patterns discovered]\n[things to remember]\n\nContext:\n[relevant context for future reference]",
  "importance": "high",
  "memoryType": "episodic",
  "tags": ["task-completion", "autoclaude", "task-type"]
}
```

**PARAMETERS:**
- content: string (REQUIRED) - the memory content
- importance: "critical" | "high" | "medium" | "low" | "trivial" (default: "medium")
- memoryType: "episodic" | "semantic" | "procedural" | "working" (default: "semantic")
- tags: string[] (optional) - categorization tags

**VALIDATION:**
- content MUST NOT be empty
- Use "high" importance for task completions
- Use "episodic" type for events/tasks
- Include relevant tags for categorization

### Step 6: Report Completion

Output a summary:

```
AUTOCLAUDE TASK COMPLETE

TASK: $TASK

CHANGES MADE:
- [specific change 1 with file path]
- [specific change 2 with file path]
- [etc.]

FILES MODIFIED:
- /absolute/path/to/file1
- /absolute/path/to/file2

MEMORIES SEARCHED: [count] memories found
CODE SEARCHED: [count] files found
MEMORY SAVED: [memory_id] - learnings stored for future reference

NEXT STEPS:
- [optional: suggest what user should do next]
- [optional: mention related tasks]
```

---

## ERROR HANDLING

**If memory search returns no results:**
- Try broader search terms
- Check if task relates to something discussed before
- Proceed with code search only

**If code search returns no results:**
- Try different search terms
- Check file patterns and language filters
- Ask user to clarify which files to modify

**If unable to complete task:**
- Save partial progress to memory
- Mark current todo as "in_progress" (not completed)
- Report what was done and what's blocked
- Ask user for guidance

---

## VALIDATION CHECKLIST

Before executing, verify:
- [ ] Task prompt is NOT empty
- [ ] find_memory called with valid query
- [ ] find_code_pointers called with valid query
- [ ] TodoWrite called with valid todo structure
- [ ] save_memory called with non-empty content
- [ ] All file paths in output are ABSOLUTE (not relative)
- [ ] All changes are tested before marking complete
- [ ] Final memory includes all relevant details

---

## TOOL REFERENCE

### mcp__specmem__find_memory
Search memories by semantic meaning.

**Required:** query (string)
**Optional:** limit, summarize, keywordFallback, includeRecent, threshold, memoryTypes, tags

### mcp__specmem__find_code_pointers
Search code by semantic meaning.

**Required:** query (string)
**Optional:** limit, threshold, includeTracebacks, includeMemoryLinks, zoom, language, filePattern, definitionTypes

### mcp__specmem__save_memory
Store a memory for future reference.

**Required:** content (string)
**Optional:** importance, memoryType, tags, metadata

**CRITICAL:** content parameter MUST NOT be empty string.

---

## NOTES

- Always use absolute file paths in output
- Test changes before marking todos complete
- Save detailed learnings to help with future tasks
- If task is ambiguous, ask for clarification
- Use existing memories to inform your approach
- Link related memories when relevant
