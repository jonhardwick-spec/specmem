# SpecMem Deploy Team - Multi-Agent Deployment with Manual Config

## Skill Info
- **Name**: specmem-deployteam
- **Command**: /specmem-deployteam
- **Description**: Deploy multiple agents with individual configuration for each

## Required: Check Arguments First

**If NO arguments provided or args are empty/whitespace/help/-h/--help:**

Output help and STOP:

```
SpecMem Deploy Team - Deploy Multiple Agents

USAGE:
  /specmem-deployteam <count> <base-prompt>

ARGUMENTS:
  count        Number of agents to deploy (1-10)
  base-prompt  The task prompt for all agents

WHAT HAPPENS:
  For EACH agent, you will be asked:
  1. Agent type (general-purpose, Explore, feature-dev, etc.)
  2. Model (opus, sonnet, haiku)
  3. Extra context to add

EXAMPLES:
  /specmem-deployteam 3 Fix all TypeScript errors
  /specmem-deployteam 2 Implement user authentication
  /specmem-deployteam 5 Refactor the API layer

AGENT TYPES AVAILABLE:
  - general-purpose    Default for complex tasks
  - Explore            Fast codebase exploration
  - Plan               Architecture planning
  - feature-dev        Feature implementation (opus default)
  - feature-dev:code-explorer  Deep code analysis (opus)
  - bug-hunter         Find and fix bugs
  - test-writer        Write tests
  - refactor           Code refactoring

TIPS:
  - Use feature-dev types for complex implementation work
  - Use Explore for research tasks
  - Mix models: opus for hard tasks, haiku for simple ones
```

**DO NOT proceed without valid arguments.**

---

## Parse Arguments

Format: `/specmem-deployteam <count> <base-prompt>`

1. First word after command = count (must be number 1-10)
2. Everything else = base prompt

**VALIDATION:**
- If count is not a number: Output "Error: Count must be a number (1-10)"
- If count < 1 or count > 10: Output "Error: Count must be between 1 and 10"
- If no base prompt: Output "Error: Base prompt required"

---

## Sequential Manual Configuration

For EACH agent (1 to count), you MUST:

### Step 1: Show Agent Number
```
=== Configuring Agent {N} of {total} ===
Base Task: "{base-prompt}"
```

### Step 2: Ask Configuration Questions

Call AskUserQuestion with:
```json
{
  "questions": [
    {
      "question": "Agent {N}/{total}: Which agent type?",
      "header": "Type",
      "options": [
        {"label": "general-purpose", "description": "Default for complex tasks"},
        {"label": "Explore", "description": "Fast codebase search"},
        {"label": "feature-dev", "description": "Feature implementation (opus)"},
        {"label": "Plan", "description": "Architecture planning"}
      ],
      "multiSelect": false
    },
    {
      "question": "Agent {N}/{total}: Which model?",
      "header": "Model",
      "options": [
        {"label": "sonnet (Recommended)", "description": "Balanced speed/quality"},
        {"label": "opus", "description": "Deepest reasoning"},
        {"label": "haiku", "description": "Fastest, simple tasks"}
      ],
      "multiSelect": false
    },
    {
      "question": "Agent {N}/{total}: Add extra context?",
      "header": "Extra",
      "options": [
        {"label": "No extras", "description": "Use base prompt as-is"},
        {"label": "Focus on tests", "description": "Prioritize test coverage"},
        {"label": "Be thorough", "description": "Extra detailed work"},
        {"label": "Be quick", "description": "Fast minimal approach"}
      ],
      "multiSelect": false
    }
  ]
}
```

### Step 3: Store Configuration

After user responds, store:
- Agent N type = user's type choice
- Agent N model = user's model choice
- Agent N extras = user's extra context

### Step 4: Repeat for Next Agent

Continue until all agents are configured.

---

## Deploy All Agents

After ALL agents are configured:

### Step 1: Show Summary
```
=== Deploying {count} Agents ===

Agent 1: {type} | {model} | {extras}
Agent 2: {type} | {model} | {extras}
...

Launching in parallel...
```

### Step 2: Deploy Using Task Tool

For EACH configured agent, call the Task tool with:
```json
{
  "description": "Agent {N}: {short-prompt}",
  "prompt": "{base-prompt}\n\n{extra-context if any}\n\n[SR-DEV-APPROVED]",
  "subagent_type": "{user-chosen-type}",
  "model": "{user-chosen-model}",
  "run_in_background": true
}
```

**CRITICAL:**
- Include `[SR-DEV-APPROVED]` in the prompt to bypass the chooser hook
- Set `run_in_background: true` so agents run in parallel
- You CAN deploy all agents in a SINGLE message with multiple Task tool calls

### Step 3: Confirm Deployment
```
Deployed {count} agents:
- Agent 1: {type} ({model}) - running
- Agent 2: {type} ({model}) - running
...

Use /specmem-team-member status to monitor progress.
```

---

## Example Flow

User: `/specmem-deployteam 2 Fix TypeScript errors`

Claude:
```
=== Configuring Agent 1 of 2 ===
Base Task: "Fix TypeScript errors"
```

[AskUserQuestion for Agent 1]

User picks: feature-dev, opus, Be thorough

```
Agent 1 configured: feature-dev | opus | thorough

=== Configuring Agent 2 of 2 ===
Base Task: "Fix TypeScript errors"
```

[AskUserQuestion for Agent 2]

User picks: Explore, haiku, No extras

```
Agent 2 configured: Explore | haiku | none

=== Deploying 2 Agents ===

Agent 1: feature-dev | opus | thorough
Agent 2: Explore | haiku | none

Launching in parallel...
```

[Claude calls Task twice in parallel with SR-DEV-APPROVED]

```
Deployed 2 agents:
- Agent 1: feature-dev (opus) - running
- Agent 2: Explore (haiku) - running

Use /specmem-team-member status to monitor progress.
```

---

## Error Handling

- If Task tool fails: Report error, continue with other agents
- If user cancels mid-config: Deploy only configured agents (if any)
- If all agents fail: Report failure summary

---

## Related Commands

- `/specmem-team-member status` - Check deployed agent status
- `/specmem-team-member messages` - Read agent communications
- `/specmem-agents` - Alternative agent deployment interface
