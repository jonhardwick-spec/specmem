# SpecMem Changelog

All notable changes to SpecMem - we keep it real with semantic versioning. Deadass.

---

## [3.7.24] - 2026-02-12

### Added
- Self-healing token compression with codebook learning
- Dual ALGO+COT relevance scoring (shows both scores in results)
- Neural translation for codebook via Argos Translate
- Mini-COT reads from code_definitions DB for richer reasoning
- Background codebase crawler with LLM enrichment
- Skill/command audit — all 18 commands verified and documented

### Improved
- Hook debouncing to prevent socket slamming
- File watcher retry logic with exponential backoff
- Embedding server resilience and self-healing
- TUI cursor stability (no more ghost stage headers)
- Smooth progress UI for long operations

### Fixed
- PTY output formatting inconsistencies
- Socket contention under high load
- Lazy-load breakage from aggressive self-healing

---

## [3.5.96] - 2026-02-07

### Fixed
- Prevent multiple embedding server processes from spawning (socket contention)
- Strengthen lock acquisition with PID validation and staleness detection
- Add bootstrap deduplication to prevent duplicate MCP server instances
- Health monitoring now detects and kills duplicate processes
- Reduced subsequent timeout from 60s to 15s for faster failure detection

### Added
- Resource monitoring for embedding server (CPU/RAM tracking)
- Cleanup script for manual process management

---

## [3.1.0] - 2026-01-30

### Added
- Official LICENSE.md and legal notices
- Pre-release copyright protection
- Training opt-out documentation for Anthropic compliance

### Changed
- Updated CLAUDE.md with comprehensive legal notices
- Improved project documentation structure

---

## [3.0.0] - 2026-01-30

### Breaking Changes
- Major version bump reflecting production-ready status
- Stabilized MCP tool interface

---

## [2.0.24] - [2.0.2] - 2026-01-29 to 2026-01-30

### Changed
- Incremental stability improvements
- Package distribution refinements
- Build system optimizations

---

## [2.0.15] - 2026-01-30

### Added
- Human-readable tool output format - bet this makes debugging way smoother
- Enhanced file watcher reliability

### Fixed
- File watcher sync issues when codebase changes
- Tool output formatting for better readability
- MCP tool response clarity

---

## [1.0.33] - 2026-01-23

### Fixed
- Undefined `c.black` color reference in console
- ANSI-aware `fitLine()` function - handles colored text correctly now
- Console rendering edge cases

---

## [1.0.31] - 2026-01-23

### Fixed
- Duplicate `startDashboardMode()` function overwriting 4-quadrant version
- Dashboard initialization race condition

---

## [1.0.30] - 2026-01-23

### Added
- CLI Dashboard with 4-quadrant TUI layout - moe this setup is hitting different
  - Quadrant 1: Claude preview window
  - Quadrant 2: MCP tool calls in real-time
  - Quadrant 3: Console logs
  - Quadrant 4: Team communications
- `QuadrantRenderer` class with proper box-drawing borders
- `extractMcpToolCalls()` parser - finds tool invocations from logs
- `readLastLines()` - efficient tail-based log reading
- `readAndTruncateLog()` - prevents unbounded log growth

### Fixed
- 241MB+ screen log bloat issue - logs were straight cooked
- Embedding server orphan cleanup regex
- Multiple inefficient `fs.readFileSync()` calls replaced with tail

### Changed
- Improved timeout handling in hooks
- Better stdin reading with proper timeouts
- Agent chooser model selection improvements

---

## [1.0.21] - 2026-01-22

### Added
- Press SPACE to speed up initialization - say less, no more waiting around
- Interactive startup controls

### Changed
- Faster init sequence when user interaction detected

---

## [1.0.20] - 2026-01-22

### Added
- Robust banner animation with save/restore cursor
- Animated SPECMEM banner on startup

### Fixed
- Cursor position issues during startup animation
- Terminal state restoration after banner

---

## [1.0.19] - 2026-01-22

### Added
- UI improvements and refinements
- Enhanced startup experience

---

## [1.0.0 - 1.0.18] - 2026-01 to 2026-01-22

### Summary
- Initial stable release series
- Core functionality established
- Dashboard foundation built

---

## Major Update - 2026-01-22

### Added
- Embedding client reliability improvements - stamp this is way more stable now
  - `isAvailableAsync()` that actually pings server (not just file checks)
  - Auto-trigger warm-start on timeout, socket errors, or failed health checks
  - Search multiple locations for `warm-start.sh` script
  - Machine-shared socket path `/tmp/specmem-embed-{uid}.sock`

- Docker version safety mechanisms
  - `specmem.version` label on all containers
  - Version check before using existing containers
  - Auto-kill containers with version mismatch
  - Updated `warm-start.sh` with version safety

- Team communications enhancements
  - Auto-clear team messages before deploying agents
  - Ultra-compact XML response format - saves tokens fr fr
  - Shorter warning messages throughout

- Agent output interceptor improvements
  - Strip empty/whitespace lines from preview output
  - Token-efficient warning messages

---

## Major Update - 2026-01-11

### Added
- Per-project isolation for embedding sockets
  - Fixed socket path to use `{PROJECT}/specmem/sockets/`
  - No more cross-project socket conflicts

- Auto-start embedding server in session-start hook
  - Seamless startup experience
  - Better reliability

- Agent loading improvements
  - Two-step Auto/Manual agent selection flow
  - `agent-chooser-hook.js` for interactive model selection
  - `agent-output-interceptor.js` blocks dangerous commands (globs, tail)

### Changed
- Reduced embedding timeout from 60s to 5s - fast fail beats long hangs deadass
- Improved agent-loading-hook workflow
- Better per-project isolation throughout codebase

### Fixed
- Agent output blocking for unsafe operations
- Hook timeout handling
- Session isolation issues

---

## Major Update - 2026-01-10

### Added
- Token compression system - moe this joint is crankin
  - 22,000+ Chinese character compression codes
  - `ResponseCompactor` integration
  - MCP tool response compression
  - Can fit way more context in the same token budget

- Multi-project socket sharing
  - Shared socket infrastructure
  - Better resource utilization
  - Reduced overhead per project

- Enhanced documentation
  - `L1_LOOPHOLE_ANALYSIS.md` - deep security analysis
  - `R2_CODE_MEMORY_CORRELATION.md` - research findings
  - `R3_RESEARCH.md` and `R4_FINDINGS.md` - architecture research
  - `PROJECT_NAMESPACING_PLAN.md` - isolation strategy
  - `TROUBLESHOOTING.md` - common issues and fixes

### Changed
- `.env.example` expanded with better defaults
- Dockerfile improvements
- README.md with clearer instructions

### Added (Tooling)
- `bin/specmem-cli.cjs` - command-line interface
- `claude-hooks/agent-loading-hook.js` - agent deployment
- `claude-hooks/build-cedict-dictionary.mjs` - compression dictionary builder
- `claude-hooks/cedict-codes.json` and `cedict-extracted.json` - 22K+ compression codes
- Enhanced `bootstrap.cjs` with better startup flow

---

## Initial Release - 2025-12-24

### Added
- Initial SpecMem codebase
- Core MCP server implementation
- PostgreSQL with pgvector integration
- Per-project database schemas
- Semantic memory search
- Semantic code search with tracebacks
- File watcher and auto-indexing
- Session extraction from `~/.claude/`
- Team communication tools for multi-agent coordination
- Task claiming system
- Dashboard with terminal streaming
- Hook system for Claude Code integration
- Docker support for embedding server
- Python embedding service (Frankenstein)
- 40+ MCP tools
- Auto-configuration and setup
- Health check system

### Core Features
- **Semantic Search** - find by meaning, not exact text
- **Per-Project Isolation** - each project gets its own DB schema
- **Code Pointers** - search code with full call tracebacks
- **Team Coordination** - multiple agents work together without conflicts
- **Session History** - remembers conversations across sessions
- **Auto-Indexing** - watches files and updates embeddings
- **Camera Roll Mode** - drill down into search results
- **Dashboard** - real-time monitoring and control

---

## Version History Notes

SpecMem uses semantic versioning:
- **Major (X.0.0)**: Breaking changes, major architecture updates
- **Minor (0.X.0)**: New features, non-breaking changes
- **Patch (0.0.X)**: Bug fixes, performance improvements

We went from v1.0.x to v2.0.x when we stabilized the MCP interface. Version 3.0.0 marks production-ready status with official licensing.

---

## Development Philosophy

We build this thing right:
- No global singletons - use `Map<projectPath, Instance>`
- Parameterized SQL only - string concat is cooked
- Per-project isolation everywhere
- Fast fail over long timeouts
- Cache expensive operations
- Stream large datasets
- Test with multiple projects running

Real talk - if something breaks, we fix it properly. No band-aids, no workarounds that come back to bite you later. That's tuff.

---

**Maintained by Hardwick Software Services**
https://justcalljon.pro

For issues, questions, or feature requests, hit up:
https://github.com/jonhardwick-spec/specmem/issues
