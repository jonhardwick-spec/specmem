# SpecMem Stats - 記 & Codebase·統計

示記 系統統計供銷s.

## 即時一舉必要②

**步 1: 析輸入**
- Args: `$ARGUMENTS` ( 空, 未定義, 鍵詞)
- 正化①: 待① 空/undefined/null "默認"

**步 2: 驗輸入**
- 有效·subcommands: `help`, `-h`, `--help`, `memory`, `memories`, `tags`, `cache`, `instances`, `relationships`, `timeseries`, `full`, `detailed`, `all`, `default`, (空)
- 輸入叵 單③, 示錯誤訊佽 截①, 停
- 輸入有效, 遂步 3

**步 3: 路由鍵詞**

| 輸入 | 一舉 |
|-------|--------|
| `help`, `-h`, `--help` | 示佽 截①, 停 |
| 空, 未定義, `all`, `default` | 執默認·params |
| `memory`, `memories` | 執記·params |
| `tags` | 執標④s params |
| `cache` | 執快取·params |
| `instances` | 執·params |
| `relationships`, `relations` | 執義③s params |
| `timeseries`, `time` | 執·timeseries params |
| `full`, `detailed` | 執滿① params |
| | 示錯誤訊有效選項s, 示佽, 停 |

**步 4: 執 - 呼① MCP·具⑤ **

**默認** (空/undefined/all/default):
```
mcp__specmem__show_me_the_stats({
  "includeTypeDistribution": true,
  "includeImportanceDistribution": true,
  "includeCacheStats": true,
  "includeInstanceStats": true
})
```

**記/回憶**:
```
mcp__specmem__show_me_the_stats({
  "includeTypeDistribution": true,
  "includeImportanceDistribution": true,
  "includeCacheStats": false,
  "includeInstanceStats": false,
  "includeTagDistribution": true
})
```

**標④s**:
```
mcp__specmem__show_me_the_stats({
  "includeTagDistribution": true,
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeCacheStats": false,
  "includeInstanceStats": false
})
```

**快取**:
```
mcp__specmem__show_me_the_stats({
  "includeCacheStats": true,
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeInstanceStats": false
})
```

****:
```
mcp__specmem__show_me_the_stats({
  "includeInstanceStats": true,
  "includeAllInstances": true,
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeCacheStats": false
})
```

**義③s/戚誼s**:
```
mcp__specmem__show_me_the_stats({
  "includeRelationshipStats": true,
  "includeTypeDistribution": false,
  "includeImportanceDistribution": false,
  "includeCacheStats": false,
  "includeInstanceStats": false
})
```

**timeseries/時①**:
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

**滿①/緬①**:
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

## 佽·```
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