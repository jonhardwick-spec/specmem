# SpecMem·務 - 務調① 管理

司·SpecMem·務調①s, 檔觀er, 查·connectivity.

## 令④ 析ing·析來①s `/specmem-service`:

**言論①:** $言論①

**裁① 理③:**
1. 言論① 空, 愣, "佽" -> 執佽 截①
2. 言論① "狀態" -> 執狀態截①
3. 言論① "啟①" -> 執啟① 截①
4. 言論① "停" -> 執停 截①
5. 言論① "restart" -> 執·RESTART·截①
6. 言論① "mcp" -> 執·MCP·截①
7. 言論① "HTTP" -> 執·HTTP·截①
8. 言論① "db" -> 執·DB·截①
9. 言論① "觀" "觀啟①" -> 執·WATCH_START·截①
10. 言論① "觀停" -> 執·WATCH_STOP·截①
11. 言論① "觀狀態" -> 執·WATCH_STATUS·截①
12. 言論① "同步①" "同步① 查" -> 執·SYNC_CHECK·截①
13. 言論① "同步① 兵②" "resync" -> 執·SYNC_FORCE·截①
14. -> 執佽 截① (不明令④)

---

## 佽

示佽 輸出停:

```
SpecMem Service - Mode Management

USAGE:
  /specmem-service              Show this help
  /specmem-service status       Check all service connectivity
  /specmem-service start        Start SpecMem services
  /specmem-service stop         Stop SpecMem services
  /specmem-service restart      Restart SpecMem services
  /specmem-service mcp          Test MCP tool availability
  /specmem-service http         Test HTTP API endpoint
  /specmem-service db           Test database connection

FILE WATCHER:
  /specmem-service watch        Start file watcher (auto-sync code changes)
  /specmem-service watch start  Start file watcher
  /specmem-service watch stop   Stop file watcher
  /specmem-service watch status Check watcher status

SYNC MANAGEMENT:
  /specmem-service sync         Check if files are in sync
  /specmem-service sync check   Check sync status (detailed)
  /specmem-service sync force   Force full resync
  /specmem-service resync       Force full resync (alias)

SERVICE MODES:
  MCP     Standard MCP via stdio (native Claude integration)
  HTTP    REST API at http://localhost:8595
  DB      Direct PostgreSQL connection
  WATCH   File watcher for auto-sync

PORTS:
  8595    Dashboard/HTTP API
  5432    PostgreSQL database
  3456    Embedding service

RELATED:
  /specmem-stats    View system statistics
  /specmem          Main SpecMem commands
```

---

## 狀態

查務·connectivity:

**步 1 - 查·MCP:**
呼① MCP·具⑤ `mcp__specmem__show_me_the_stats`·空參s `{}`.

具⑤ 返s successfully -> 匯報: "MCP: 相通①"
具⑤ 失敗s·錯①s -> 匯報: "MCP: 叵可用"

**步 2 - 查·HTTP:**
執·bash·令④:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8595/api/health 2>/dev/null || echo "000"
```·輸出 "200" -> 匯報: "HTTP: 相通① (埠 8595)"
-> 匯報: "HTTP: 叵可用"

**步 3 - 查資料庫:**
執·bash·令④:
```bash
pg_isready -h localhost -p 5432 2>/dev/null && echo "ready" || echo "not ready"
```·輸出容納s "備" (叵 "叵備") -> 匯報: "DB: 相通① (埠 5432)"
-> 匯報: "DB: 叵可用"

**步 4 - 查檔 觀er:**
呼① MCP·具⑤ `mcp__specmem__check_sync`·參s:
```json
{
  "detailed": false
}
```·具⑤ 返s successfully `watcherStatus.isRunning`·真 -> 匯報: "觀er: 一連 (同步①ing·碼變遷)"
具⑤ 返s successfully `watcherStatus.isRunning`·假② -> 匯報: "觀er: 停ed"
-> 匯報: "觀er: 不明"

**步 5 - 顯摘要:**
示狀態導致格式ed·摘要.

---

## 啟①

啟① SpecMem·勞務.

執·bash·令④:
```bash
cd /specmem && if [ -f start-specmem.sh ]; then echo "Starting SpecMem services..." && bash start-specmem.sh; elif [ -f start-dashboard.sh ]; then echo "Starting dashboard..." && bash start-dashboard.sh; else echo "ERROR: No startup script found at /specmem"; exit 1; fi
```·匯報果 戶②.

---

## 停

停·SpecMem·勞務.

執·bash·令④:
```bash
cd /specmem && if [ -f stop-specmem.sh ]; then echo "Stopping SpecMem services..." && bash stop-specmem.sh; else echo "Stopping services via pkill..." && pkill -f "specmem" 2>/dev/null || true && pkill -f "node.*specmem" 2>/dev/null || true && echo "Services stopped (or were not running)"; fi
```·匯報果 戶②.

---

## RESTART

Restart SpecMem·勞務.

執·bash·令④:
```bash
cd /specmem && echo "Restarting SpecMem services..." && (if [ -f stop-specmem.sh ]; then bash stop-specmem.sh; else pkill -f "specmem" 2>/dev/null || true; fi) && sleep 2 && (if [ -f start-specmem.sh ]; then bash start-specmem.sh; elif [ -f start-dashboard.sh ]; then bash start-dashboard.sh; else echo "ERROR: No startup script found"; exit 1; fi)
```·匯報果 戶②.

---

## MCP·試③ MCP·具⑤ availability.

呼① MCP·具⑤ `mcp__specmem__show_me_the_stats`·參s:
```json
{
  "includeTypeDistribution": true,
  "includeImportanceDistribution": true
}
```·顯果 示ing·記計①s·供銷s. 呼① 失敗s, 匯報·MCP·叵可用.

---

## HTTP·試③ HTTP API端點.

執·bash·令④:
```bash
echo "=== HTTP API CHECK ===" && echo "" && echo "Endpoint: http://localhost:8595" && echo "" && echo "Health Check:" && curl -s http://localhost:8595/api/health 2>/dev/null || echo "  (not responding)" && echo "" && echo "Available Endpoints:" && echo "  GET  /api/health" && echo "  GET  /api/stats" && echo "  GET  /api/memories" && echo "  GET  /api/team-members/active" && echo "  POST /api/memories/search"
```·匯報輸出戶②.

---

## DB·試③ 資料連.

執·bash·令④:
```bash
echo "=== DATABASE CHECK ===" && echo "" && echo "Host: localhost:5432" && echo "" && pg_isready -h localhost -p 5432 2>/dev/null || echo "Database not ready" && echo "" && echo "Tables (if connected):" && PGPASSWORD="${SPECMEM_DB_PASSWORD:-${SPECMEM_PASSWORD:-specmem_westayunprofessional}}" psql -h localhost -p 5432 -U "${SPECMEM_DB_USER:-specmem_westayunprofessional}" -d "${SPECMEM_DB_NAME:-specmem_westayunprofessional}" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' LIMIT 10;" 2>/dev/null || echo "  (cannot connect)"
```·匯報輸出戶②.

---

## WATCH_START·啟① 檔觀er auto-同步① 碼變遷回憶.

呼① MCP·具⑤ `mcp__specmem__start_watching`·參s:
```json
{
  "syncCheckIntervalMinutes": 60
}
```·顯果 戶②:
- 完滿①: 示·projectPath, watchedPaths, filesWatched·計①
- 一連: 指出·it's·一連示·stats
- 錯①: 示錯誤訊

**提綱:**
- 檔觀er·專案-天地ed ( 觀s·當前專案)
- `rootPath`·參棄用 ( 用s SPECMEM_PROJECT_PATH)
- 默認同步① 查間隔 60 紀要 (1 時②)
- MCP·回憶同步① filesystem·自然而然

---

## WATCH_STOP·停檔 觀er.

呼① MCP·具⑤ `mcp__specmem__stop_watching`·參s:
```json
{
  "flushPending": true
}
```·顯果 戶②:
- 完滿①: 示·eventsProcessed pendingFlushed·計①s
- 叵一連: 指出觀er wasn't·一連
- 錯①: 示錯誤訊

**提綱:**
- `flushPending: true`·處s·待處理變遷停ing
- `flushPending: false`·停s·旋加工列

---

## WATCH_STATUS·查檔 觀er·狀態.

呼① MCP·具⑤ `mcp__specmem__check_sync`·參s:
```json
{
  "detailed": false
}
```·顯果 戶②:
- 觀er·狀態: isRunning, eventsProcessed, queueSize
- 同步① 狀態: inSync, syncScore, driftPercentage
- 摘要訊息
- Stats: totalFiles, totalMemories, upToDate, missingFromMcp, missingFromDisk, contentMismatch·觀er·叵一連, 議初始·`/specmem-service watch start`.

---

## SYNC_CHECK·查·MCP·回憶同步① filesystem.

呼① MCP·具⑤ `mcp__specmem__check_sync`·參s:
```json
{
  "detailed": true
}
```·顯果 戶②:
- 同步① 狀態: inSync (真/假②)
- 同步① 楬: 百分① (0-100%)
- 漂① 百分①: 何漂① 偵①ed
- 摘要訊息
- 統計: totalFiles, totalMemories, upToDate, missingFromMcp, missingFromDisk, contentMismatch
- 緬① 單③s ( 緬①: 真):
- 案卷① 佚③ MCP
- 案卷① 刪ed·片②
- 案卷① 內容·mismatch·漂① 偵①ed, 議一連·`/specmem-service sync force` resync.

**提綱:**
- 讀①- 查 (doesn't·修改 )
- 示s what's·從中同步① filesystem·回憶
- 用·force_resync·睹將是改ed

---

## SYNC_FORCE·兵② 滿① resync·全② codebase.

**步 1 - 乾跑 預覽:**
呼① MCP·具⑤ `mcp__specmem__force_resync`·參s:
```json
{
  "dryRun": true
}
```·顯預覽戶②:
- 案卷① 會是額外
- 案卷① 會是更①ed
- 案卷① 會是剺ed·刪ed

**步 2 - 叫確認:**
叫戶②: " 想要遂·resync? 更① MCP·回憶匹配當前·filesystem. (/)"

待戶② 應①.

**步 3 - 執·Resync ( 確診):**
戶② 證s (/y/proceed/go/confirm):
呼① MCP·具⑤ `mcp__specmem__force_resync`·參s:
```json
  {
    "dryRun": false
  }
  ```·顯果:
- 成功/失敗① 狀態
- 案卷① 額外
- 案卷① 更①ed
- 案卷① 剺ed·刪ed
- 持續② (milliseconds)
- 錯①s·遻ed·戶② 下①s:
匯報: "Resync·作廢ed·戶②."

**提綱:**
- 示s·預覽首 (乾跑)
- 需①s·不含糊① 戶② 確認
- 掃描s·全② codebase·更①s·回憶
- 用: git·銷售點, git·引②, 堆檔 運作①
- 于廢品紀要倬② codebases

---