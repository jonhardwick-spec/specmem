# SpecMem Stats - Memory & Codebase Statistics

Show memory system statistics and distributions.

## IMMEDIATE ACTION REQUIRED

**Step 1: Parse input**
- Args: `$ARGUMENTS` (may be empty, undefined, or a keyword)
- Normalize: treat empty/undefined/null as "default"

**Step 2: Validate input**
- Valid subcommands: `help`, `-h`, `--help`, `memory`, `memories`, `tags`, `cache`, `instances`, `relationships`, `timeseries`, `full`, `detailed`, `all`, `default`, (empty)
- If input is not in this list, show error message and HELP section, then STOP
- If input is valid, proceed to Step 3

**Step 3: Route by keyword**

| Input | Action |
|-------|--------|
| `help`, `-h`, `--help` | Show HELP section below, then STOP |
| empty, undefined, `all`, `default` | EXECUTE with default params |
| `memory`, `memories` | EXECUTE with memory params |
| `tags` | EXECUTE with tags params |
| `cache` | EXECUTE with cache params |
| `instances` | EXECUTE with instances params |
| `relationships`, `relations` | EXECUTE with relationships params |
| `timeseries`, `time` | EXECUTE with timeseries params |
| `full`, `detailed` | EXECUTE with full params |
| other | Show error message with valid options, show HELP, then STOP |

**Step 4: EXECUTE - Call the MCP tool NOW**

For **default** (empty/undefined/all/default):
```
mcp__specmem__show_me_the_stats({
  "includeTypeDistribution": true,
  "includeImportanceDistribution": true,
  "includeCacheStats": true,
  "includeInstanceStats": true
})
```

For **memory/memories**:
```
mcp__specmem__show_me_the_stats({
  "includeTypeDistribution": true,
  "includeImportanceDistribution": true,
  "includeCacheStats": false,
  "includeInstanceStats": false,
  "includeTagDistribution": true
})
```

For **tags**:
```
mcp__specmem__show_me_the_stats({
  "includeTagDistribution": true,
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeCacheStats": false,
  "includeInstanceStats": false
})
```

For **cache**:
```
mcp__specmem__show_me_the_stats({
  "includeCacheStats": true,
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeInstanceStats": false
})
```

For **instances**:
```
mcp__specmem__show_me_the_stats({
  "includeInstanceStats": true,
  "includeAllInstances": true,
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeCacheStats": false
})
```

For **relationships/relations**:
```
mcp__specmem__show_me_the_stats({
  "includeRelationshipStats": true,
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeCacheStats": false,
  "includeInstanceStats": false
})
```

For **timeseries/time**:
```
mcp__specmem__show_me_the_stats({
  "includeTimeSeriesData": true,
  "timeSeriesGranularity": "day",
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeCacheStats": false,
  "includeInstanceStats": false
})
```

For **full/detailed**:
```
mcp__specmem__show_me_the_stats({
  "includeTypeDistribution": true,
  "includeImportanceDistribution": true,
  "includeCacheStats": true,
  "includeInstanceStats": true,
  "includeAllInstances": true,
  "includeTagDistribution": true,
  "includeRelationshipStats": true,
  "includeTimeSeriesData": true,
  "timeSeriesGranularity": "day"
})
```

---

## HELP

```
SPECMEM STATS - View Memory System Statistics

USAGE:
  /specmem-stats              Show default stats (types, importance, cache, instances)
  /specmem-stats memory       Memory type and importance breakdown
  /specmem-stats tags         Tag distribution only
  /specmem-stats cache        Cache performance metrics
  /specmem-stats instances    Per-instance RAM usage (all processes)
  /specmem-stats relationships Memory relationship statistics
  /specmem-stats timeseries   Time series data (memory creation over time)
  /specmem-stats full         Complete stats including all metrics

AVAILABLE SUBCOMMANDS:
  (empty)                     Default stats (types, importance, cache, instances)
  memory, memories            Memory type and importance distribution
  tags                        Tag usage distribution (top 50 tags)
  cache                       Cache performance (embedding cache, server cache, DB pool)
  instances                   Per-instance RAM usage across all processes
  relationships, relations    Memory relationship statistics
  timeseries, time            Time series data for memory creation
  full, detailed              All statistics with all metrics enabled

OPTIONS:
  help, -h, --help            Show this help

PARAMETERS EXPLAINED:
  includeTypeDistribution     Memory type breakdown (episodic, semantic, etc.)
  includeImportanceDistribution  Importance level breakdown (critical, high, etc.)
  includeCacheStats           Embedding cache, server cache, DB connection pool stats
  includeInstanceStats        Current instance RAM usage tracking
  includeAllInstances         Include stats from ALL running SpecMem instances
  includeTagDistribution      Tag usage distribution (top 50 tags)
  includeRelationshipStats    Memory relationship and connection statistics
  includeTimeSeriesData       Memory creation time series (requires timeSeriesGranularity)
  timeSeriesGranularity       Granularity for time series: "hour", "day", "week", "month"

EXAMPLES:
  /specmem-stats              Get overview of memory system
  /specmem-stats full         Detailed report with all metrics
  /specmem-stats cache        Check embedding cache performance
  /specmem-stats instances    Check RAM usage across all instances
  /specmem-stats tags         See most commonly used tags
  /specmem-stats relationships  See how memories are connected

TOOL SCHEMA REFERENCE:
  The mcp__specmem__show_me_the_stats tool accepts these boolean parameters:
  - includeTypeDistribution (default: true)
  - includeImportanceDistribution (default: true)
  - includeCacheStats (default: true)
  - includeInstanceStats (default: true)
  - includeAllInstances (default: false)
  - includeTagDistribution (default: false)
  - includeRelationshipStats (default: false)
  - includeTimeSeriesData (default: false)
  - timeSeriesGranularity (enum: "hour"|"day"|"week"|"month", default: "day")

RELATED COMMANDS:
  /specmem-find               Search memories
  /specmem-remember           Store new memories
  /specmem-pointers           Search code with tracebacks
```
