# SpecMem WebDev - Hardwick-營造商隊 部署①

部①s·協同蹼 動態③ 隊·using Hardwick-營造商方法學. 倍數專③ 代理s·工共① SpecMem·隊協作①.

## 令④ 析ing

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show HELP below
  return;
}

if (args.startsWith("--quick ") || args.startsWith("-q ")) {
  // Single agent quick mode
  const prompt = args.replace(/^(-q|--quick)\s+/, "");
  if (!prompt) {
    console.log("ERROR: --quick requires a prompt");
    console.log("Example: /specmem-webdev --quick adjust button colors");
    return;
  }
  // Execute QUICK MODE
  return;
}

if (args.startsWith("--solo ")) {
  // Single agent with full Hardwick instructions
  const prompt = args.replace(/^--solo\s+/, "");
  if (!prompt) {
    console.log("ERROR: --solo requires a prompt");
    console.log("Example: /specmem-webdev --solo fix the authentication flow");
    return;
  }
  // Execute SOLO MODE
  return;
}

// Otherwise → Deploy FULL WEBDEV TEAM
// Prompt is everything in args
```

---

## 輸入·VALIDATION

```javascript
const args = "$ARGUMENTS".trim();

if (!args || args === "help" || args === "--help" || args === "-h") {
  // Show HELP OUTPUT below
  return;
}

// Valid commands:
// - /specmem-webdev <prompt>
// - /specmem-webdev --solo <prompt>
// - /specmem-webdev --quick <prompt>
```

---

## 佽輸出·```
SpecMem WebDev - Hardwick-Builder Team 🏗️

USAGE:
  /specmem-webdev <prompt>           Deploy full webdev team
  /specmem-webdev --solo <prompt>    Single agent with full instructions
  /specmem-webdev --quick <prompt>   Quick single-agent mode
  /specmem-webdev help               Show this help

EXAMPLES:
  /specmem-webdev build a beautiful todo app
  /specmem-webdev create a dashboard with dark mode
  /specmem-webdev --solo fix the authentication flow
  /specmem-webdev --quick adjust button colors

THE HARDWICK-BUILDER TEAM:
  🎨 Design System Agent  - tailwind.config.ts, index.css, tokens
  ⚛️  Component Builder    - React components, shadcn customization
  🔗 Integration Agent    - Routing, state, API connections
  ✅ Quality Reviewer     - Verification, patterns, SpecMem saves

HARDWICK PRINCIPLES:
  - Design system first (no inline styles)
  - Semantic tokens only (no text-white, bg-black)
  - Small components (50 lines max)
  - Discussion before code
  - SEO by default
  - Beautiful by default

TECH STACK:
  React, Vite, Tailwind CSS, TypeScript, shadcn/ui

TEAM COORDINATION:
  Agents communicate via SpecMem team messages.
  Monitor: /specmem-team-member messages
  Status:  /specmem-team-member status

MCP TOOLS USED:
  - mcp__specmem__clear_team_messages - Clear old messages
  - mcp__specmem__find_memory - Search existing patterns
  - mcp__specmem__find_code_pointers - Find relevant code
  - mcp__specmem__broadcast_to_team - Announce deployment
  - mcp__specmem__send_team_message - Agent communication
  - mcp__specmem__read_team_messages - Check team status
  - mcp__specmem__claim_task - Prevent file conflicts
  - mcp__specmem__release_task - Release claims
  - mcp__specmem__save_memory - Store patterns
  - Task tool - Deploy agents in parallel
```

---

## 滿① 隊部署①

提示供ed (叵 --㨗/--獨唱), 執:

### 步 1: 清前 隊 & 搜上下文·```javascript
mcp__specmem__clear_team_messages({
  confirm: true,
  older_than_minutes: 30
})
```

```javascript
mcp__specmem__find_memory({
  query: "<prompt> web development react frontend design patterns",
  limit: 5,
  summarize: true,
  maxContentLength: 300
})
```

```javascript
mcp__specmem__find_code_pointers({
  query: "<prompt>",
  limit: 5,
  filePattern: "*.{tsx,jsx,css,ts}"
})
```

### 步 2: 佈隊 部署①

```javascript
mcp__specmem__broadcast_to_team({
  message: "HARDWICK-BUILDER TEAM DEPLOYING: <prompt>",
  broadcast_type: "announcement",
  priority: "high"
})
```

### 步 3: 部① 隊代理s ( 緯圈!)

部① 代理s·並② using·倍數任務呼①s·訊息.

---

#### 代理 1: 設計系統代理 🎨

```javascript
Task({
  subagent_type: "general-purpose",
  description: "HB Design System",
  model: "sonnet",
  run_in_background: true,
  prompt: `You are the DESIGN SYSTEM AGENT on the Hardwick-Builder team.

## YOUR ROLE
Set up the design foundation FIRST. Other agents depend on you.

## TASK CONTEXT
${USER_REQUEST}

## YOUR RESPONSIBILITIES

1. **CLAIM YOUR WORK FIRST**
   mcp__specmem__claim_task({
     description: "Design System: tailwind.config.ts, index.css",
     files: ["tailwind.config.ts", "src/index.css"]
   })

2. **ANNOUNCE START**
   mcp__specmem__send_team_message({
     message: "🎨 Design System Agent starting - setting up tokens",
     type: "status"
   })

3. **SEARCH FOR EXISTING PATTERNS**
   mcp__specmem__find_code_pointers({
     query: "tailwind config design system",
     filePattern: "*.{ts,css}"
   })

4. **CREATE DESIGN SYSTEM**

   Update tailwind.config.ts with semantic color tokens:
   - background, foreground
   - primary, secondary, accent, muted
   - destructive, border, input, ring

   Update index.css with HSL variables:
   - :root { --background: H S% L%; ... }
   - .dark { ... dark mode overrides }

   CRITICAL RULES:
   - ALL colors as HSL CSS variables
   - NO hardcoded colors like white, black, blue-500
   - Define animation keyframes
   - Set up font scales

5. **ANNOUNCE COMPLETION**
   mcp__specmem__send_team_message({
     message: "🎨 Design System READY - tokens defined in tailwind.config.ts and index.css. Component builders can proceed.",
     type: "status",
     priority: "high"
   })

6. **RELEASE CLAIM**
   mcp__specmem__release_task({ claimId: "all" })

## HARDWICK DESIGN TOKENS TEMPLATE

tailwind.config.ts:
  colors: {
    border: "hsl(var(--border))",
    background: "hsl(var(--background))",
    foreground: "hsl(var(--foreground))",
    primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
    secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
    accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
    muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
    destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
  }

index.css:
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
  }
`
})
```

---

#### 代理 2: 元件營造商代理 ⚛️

```javascript
Task({
  subagent_type: "general-purpose",
  description: "HB Component Builder",
  model: "sonnet",
  run_in_background: true,
  prompt: `You are the COMPONENT BUILDER AGENT on the Hardwick-Builder team.

## YOUR ROLE
Build React components using the design system. Wait for Design System Agent.

## TASK CONTEXT
${USER_REQUEST}

## YOUR RESPONSIBILITIES

1. **CHECK TEAM MESSAGES FIRST**
   mcp__specmem__read_team_messages({ limit: 10 })

   WAIT for "Design System READY" message before building!

2. **CLAIM YOUR WORK**
   mcp__specmem__claim_task({
     description: "Components: <list component files>",
     files: ["src/components/..."]
   })

3. **ANNOUNCE START**
   mcp__specmem__send_team_message({
     message: "⚛️ Component Builder starting - creating components",
     type: "status"
   })

4. **SEARCH FOR EXISTING PATTERNS**
   mcp__specmem__find_code_pointers({
     query: "react component pattern",
     filePattern: "*.tsx"
   })

5. **BUILD COMPONENTS**

   CRITICAL RULES:
   - MAX 50 lines per component file
   - Use ONLY design system tokens (text-foreground, bg-background, etc.)
   - NEVER use text-white, bg-black, or hardcoded colors
   - Customize shadcn components with variants
   - Create small, focused, reusable components
   - Use semantic HTML (header, nav, main, section, footer)

6. **COORDINATE WITH INTEGRATION AGENT**
   mcp__specmem__send_team_message({
     message: "⚛️ Components READY: <list of components created>",
     type: "status",
     priority: "high"
   })

7. **RELEASE CLAIM**
   mcp__specmem__release_task({ claimId: "all" })

## COMPONENT TEMPLATE

import { cn } from "@/lib/utils"

interface Props {
  className?: string
}

export function ComponentName({ className }: Props) {
  return (
    <div className={cn("bg-background text-foreground", className)}>
      {/* semantic tokens only */}
    </div>
  )
}
`
})
```

---

#### 代理 3: 一元化代理 🔗

```javascript
Task({
  subagent_type: "general-purpose",
  description: "HB Integration",
  model: "sonnet",
  run_in_background: true,
  prompt: `You are the INTEGRATION AGENT on the Hardwick-Builder team.

## YOUR ROLE
Connect components, set up routing, state management, API calls.
Wait for Component Builder to finish core components.

## TASK CONTEXT
${USER_REQUEST}

## YOUR RESPONSIBILITIES

1. **CHECK TEAM MESSAGES**
   mcp__specmem__read_team_messages({ limit: 15 })

   WAIT for "Components READY" message before integrating!

2. **CLAIM YOUR WORK**
   mcp__specmem__claim_task({
     description: "Integration: routing, state, API",
     files: ["src/App.tsx", "src/pages/..."]
   })

3. **ANNOUNCE START**
   mcp__specmem__send_team_message({
     message: "🔗 Integration Agent starting - connecting components",
     type: "status"
   })

4. **INTEGRATE**

   - Set up React Router if needed
   - Connect components in pages
   - Add state management (useState, useContext, etc.)
   - Connect to APIs/backends
   - Add SEO (title, meta, H1)
   - Ensure responsive design

5. **ANNOUNCE COMPLETION**
   mcp__specmem__send_team_message({
     message: "🔗 Integration COMPLETE - app assembled and functional",
     type: "status",
     priority: "high"
   })

6. **RELEASE CLAIM**
   mcp__specmem__release_task({ claimId: "all" })
`
})
```

---

#### 代理 4: 質量評論家代理 ✅

```javascript
Task({
  subagent_type: "general-purpose",
  description: "HB Quality Review",
  model: "sonnet",
  run_in_background: true,
  prompt: `You are the QUALITY REVIEWER AGENT on the Hardwick-Builder team.

## YOUR ROLE
Review work, verify quality, save patterns to SpecMem.
Wait for Integration Agent to finish.

## TASK CONTEXT
${USER_REQUEST}

## YOUR RESPONSIBILITIES

1. **WAIT FOR TEAM COMPLETION**
   mcp__specmem__read_team_messages({ limit: 20 })

   WAIT for "Integration COMPLETE" message!

2. **CLAIM REVIEW**
   mcp__specmem__claim_task({
     description: "Quality Review"
   })

3. **ANNOUNCE START**
   mcp__specmem__send_team_message({
     message: "✅ Quality Reviewer starting verification",
     type: "status"
   })

4. **VERIFY QUALITY**

   Check for:
   - NO hardcoded colors (text-white, bg-black, etc.)
   - ALL styles use design system tokens
   - Components under 50 lines
   - Valid TypeScript (no errors)
   - SEO implemented (title, meta, H1)
   - Responsive design
   - Semantic HTML

5. **SAVE PATTERNS TO SPECMEM**
   mcp__specmem__save_memory({
     content: "Hardwick-Builder Pattern: ${USER_REQUEST}\\n\\nDesign System:\\n- [key tokens used]\\n\\nComponents Created:\\n- [list]\\n\\nPatterns:\\n- [reusable patterns]\\n\\nLessons:\\n- [what worked well]",
     importance: "high",
     tags: ["hardwick-builder", "webdev", "pattern", "react", "tailwind"]
   })

6. **FINAL BROADCAST**
   mcp__specmem__broadcast_to_team({
     message: "✅ HARDWICK-BUILDER COMPLETE: <summary of what was built>",
     broadcast_type: "announcement",
     priority: "high"
   })

7. **RELEASE ALL CLAIMS**
   mcp__specmem__release_task({ claimId: "all" })
`
})
```

---

### 步 4: 顯部署① 摘要·```
HARDWICK-BUILDER TEAM DEPLOYED 🏗️

TASK: <prompt>

AGENTS RUNNING:
  🎨 Design System Agent  - Setting up tokens
  ⚛️  Component Builder    - Creating components
  🔗 Integration Agent    - Connecting everything
  ✅ Quality Reviewer     - Verification & patterns

MONITORING:
  /specmem-team-member messages  - View team chat
  /specmem-team-member status    - Check progress

Agents coordinate through SpecMem team messages.
Quality Reviewer will announce when complete.
```

---

## 獨唱調① (--獨唱)

一① 代理滿① Hardwick-營造商指示①.
用需② 代理.

部① 任務代理複式設計 + 元件 + 一元化工作流.

---

## 㨗 調① (--㨗)

戇修復s - 執徑① 代理部署①:

1. 搜相干模式s using `mcp__specmem__find_memory`
2. 最少① 對地變遷
3. 徇·Hardwick·設計系統科
4. 存模式s noteworthy using `mcp__specmem__save_memory`

---

## MCP·具⑤s·中古①

**上下文:**
- `mcp__specmem__find_memory` - 搜設計模式s
- `mcp__specmem__find_code_pointers` - 找現 料件

**隊協作①:**
- `mcp__specmem__clear_team_messages` - 扢板岩部署①
- `mcp__specmem__broadcast_to_team` - 隊-寬③ 公告s
- `mcp__specmem__send_team_message` - 代理--代理交流
- `mcp__specmem__read_team_messages` - 查隊 狀態
- `mcp__specmem__claim_task` - 杜檔 傾軋s
- `mcp__specmem__release_task` - 麾·completion
- `mcp__specmem__get_team_status` - 概觀隊 工

**儲存:**
- `mcp__specmem__save_memory` - 堅執模式s·前① 用

**部署①:**
- 任務具⑤ (克勞德碼 建③-) - 部① 專③ 代理s·緯圈

---

## MCP·具⑤ 綱要s

### mcp__specmem__clear_team_messages
- `confirm`: 布① (必要②) - 必是真 刪
- `older_than_minutes`: 數 - 刪音訊大·N·紀要

### mcp__specmem__broadcast_to_team
- `message`: 串 (必要②) - 廣播訊息
- `broadcast_type`: "狀態" | "烝" | "公告"
- `priority`: "低" | "對頭" | "亢" | "倥①"

### mcp__specmem__send_team_message
- `message`: 串 (必要②) - 訊息內容
- `type`: "狀態" | "問" | "更①" | "廣播" | "help_request" | "help_response"
- `priority`: "低" | "對頭" | "亢" | "倥①"

### mcp__specmem__read_team_messages
- `limit`: 數 (默認: 10, 最大①: 100)
- `unread_only`: 布①
- `mentions_only`: 布①

### mcp__specmem__claim_task
- `description`: 串 (必要②) - 任務描述
- `files`: 串[] - 檔徑③s·堅稱

### mcp__specmem__release_task
- `claimId`: 串 (必要②) - 堅稱·ID·發布, ""

---

##

### 部① 滿① 隊·todo·應用①
```
/specmem-webdev build a beautiful todo app with dark mode
```

### 㨗 修復扣① 樣式ing
```
/specmem-webdev --quick adjust button colors to match brand
```

### 獨唱代理認證·```
/specmem-webdev --solo implement OAuth login flow
```