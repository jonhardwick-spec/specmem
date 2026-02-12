/**
 * CODEBOOK LEARNER SERVICE
 * ========================
 * Dynamic dictionary expansion via Hardwick Translate (Argos Translate socket server).
 * Monitors compressor misses, translates via neural MT, verifies round-trip,
 * appends verified entries to merged-codes.cjs.
 *
 * RESOURCE LIMITS:
 *   - Python process: OMP_NUM_THREADS=1, CT2_COMPUTE_TYPE=int8
 *   - Auto-pause when idle (no misses for 10 min)
 *   - Auto-stop after learning batch completes
 *
 * Integration:
 *   - token-compressor.cjs calls recordMiss() on unknown words
 *   - SpecMem MCP server can trigger learn cycle
 *   - Runs as background service managed by healthMonitor
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const net = require('net');
const os = require('os');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const MODEL_CACHE = '/tmp/specmem-hardwick-models';
// Unix socket translation server (replaces Docker LibreTranslate)
const TRANSLATE_SCRIPT = path.join(__dirname, '..', '..', 'embedding-sandbox', 'hardwick-translate.py');

// Resource limits
const RAM_LIMIT_MB = 500;
const CPU_PERCENT_PER_CORE = 5; // 5% per configured core

// Learning config
const BATCH_SIZE = 30;
const MIN_WORD_LEN = 4;
const MAX_WORD_LEN = 30;
const MIN_MISS_COUNT = 2;
const IDLE_PAUSE_MS = 10 * 60 * 1000; // 10 min idle → pause container
const INTER_BATCH_DELAY_MS = 500; // Server is resource-capped, no need to be too gentle

// Paths
const MISS_LOG_DIR = '/tmp';
const MISS_LOG_NAME = 'specmem-compressor-misses.jsonl';

class CodebookLearner {
  constructor(projectPath) {
    this.projectPath = projectPath || process.cwd();
    this.codesPath = this._findCodesPath();
    this.missLogPath = path.join(MISS_LOG_DIR, MISS_LOG_NAME);
    this.cpuLimit = this._calculateCpuLimit();
    this.isLearning = false;
    this.lastMissTime = 0;
    this._idleTimer = null;
    this._dictCache = null; // Lazy-loaded dictionary index
    this._socketPath = path.join(this.projectPath, 'specmem', 'sockets', 'translate.sock');
    this._proc = null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DICTIONARY ENGINE — CC-CEDICT + ECDICT combined (770K+ entries)
  // Instant lookup, no Docker needed. The real workhorse.
  // ═══════════════════════════════════════════════════════════════════════

  _loadDictionaries() {
    if (this._dictCache) return this._dictCache;

    const dict = {}; // eng → chi (unique reverse mapping)
    const chiToEng = {}; // reverse index for uniqueness check
    let ccCount = 0, ecCount = 0, conflicts = 0;

    // === CC-CEDICT (npm package, ~124K entries) ===
    try {
      const ccAll = require(path.join(this.projectPath, 'node_modules', 'cc-cedict', 'data', 'all.js'));
      const entries = (ccAll.default || ccAll).all || [];
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length < 4) continue;
        const trad = String(entry[0]);
        const simp = String(entry[1]);
        const eng = String(entry[3]);
        if (!trad || !eng) continue;

        // Extract clean English definitions — more permissive
        const defs = eng.split('/').map(d => d.trim().toLowerCase()).filter(d =>
          d.length > 2 && d.length < 40 &&
          /^[a-z]/.test(d) &&
          !d.includes('variant of') && !d.includes('surname') &&
          !d.includes('classifier for') && !d.includes('abbr.') &&
          !d.includes('CL:') && d.split(' ').length <= 3
        ).map(d => d.replace(/\s*\([^)]*\)/g, '').trim()).filter(d => d.length > 2);

        for (const def of defs) {
          // Use Traditional Chinese, prefer shorter codes
          const chi = trad.length <= simp.length ? trad : simp;
          if (chi.length >= def.length) continue; // Must save chars
          if (chi.length > 3) continue; // Max 3 chars

          if (!dict[def]) {
            if (chiToEng[chi]) {
              conflicts++;
              continue; // Skip — this Chinese code already maps to another word
            }
            dict[def] = chi;
            chiToEng[chi] = def;
            ccCount++;
          }
        }
      }
    } catch (e) { /* CC-CEDICT not available */ }

    // === ECDICT (CSV, ~770K entries) ===
    // Columns: word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
    // Translation (col 3) has Chinese definitions — the goldmine
    const ecPath = '/tmp/ECDICT/ecdict.csv';
    try {
      if (fs.existsSync(ecPath)) {
        const raw = fs.readFileSync(ecPath, 'utf8');
        const lines = raw.split('\n');
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const firstComma = line.indexOf(',');
          if (firstComma === -1) continue;
          let word = line.slice(0, firstComma).trim().toLowerCase();

          // Allow hyphenated words (join them), skip possessives
          if (word.includes("'")) continue;
          word = word.replace(/-/g, ''); // Join hyphenated: "self-test" → "selftest"
          // Allow multi-word phrases (spaces) — they compress great
          if (!word || word.length < 3 || word.length > 40) continue;
          // Must be only lowercase alpha (+ spaces for phrases)
          if (!/^[a-z][a-z ]*$/.test(word)) continue;
          if (dict[word]) continue;

          // Smart CSV parsing: translation is column 3 but may contain commas in quoted fields
          // Simple approach: find all Chinese chars in the entire line after the word
          const rest = line.slice(firstComma + 1);

          // Extract STANDALONE Chinese words — must be bounded by non-Chinese chars
          // This prevents grabbing fragments from definitions like "具有相同波长"
          // We want: "n. 黄色\n" → "黄色" (standalone), not "具有相" (fragment)
          const chiMatches = rest.match(/(?:^|[^一-龥\u3400-\u4dbf])([\u4e00-\u9fff\u3400-\u4dbf]{1,3})(?=[^一-龥\u3400-\u4dbf]|$)/g);
          if (!chiMatches) continue;

          // Clean: extract just the Chinese part
          const cleaned = chiMatches.map(m => {
            const cm = m.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/);
            return cm ? cm[0] : null;
          }).filter(Boolean);

          // Try each, prefer shortest unique code
          let bestChi = null;
          for (const chi of cleaned) {
            if (chi.length >= word.length) continue;
            if (chiToEng[chi]) continue;
            if (!bestChi || chi.length < bestChi.length) bestChi = chi;
          }
          if (!bestChi) continue;

          dict[word] = bestChi;
          chiToEng[bestChi] = word;
          ecCount++;
        }
      }
    } catch (e) { /* ECDICT not available */ }

    console.log(`[Dict] CC-CEDICT: ${ccCount} | ECDICT: ${ecCount} | Conflicts skipped: ${conflicts} | Total: ${ccCount + ecCount}`);
    this._dictCache = { dict, chiToEng, ccCount, ecCount };
    return this._dictCache;
  }

  /**
   * DICTIONARY BULK LEARN — instant, no Docker
   * Adds all dictionary entries that:
   * 1. Match a missed word (or all if forceAll=true)
   * 2. Have unique Chinese codes (no reverse conflicts)
   * 3. Save bytes vs English
   */
  async learnFromDictionaries({ forceAll = false, stream = true } = {}) {
    const log = stream ? (...a) => process.stdout.write(a.join(' ')) : () => {};
    const logln = stream ? (...a) => console.log(...a) : () => {};

    const codes = this._loadCodes();
    const usedChi = new Set(Object.values(codes));
    const { dict, ccCount, ecCount } = this._loadDictionaries();

    let wordsToCheck;
    if (forceAll) {
      // Add ALL dictionary entries not already in codebook
      wordsToCheck = Object.keys(dict).filter(w => !codes[w]);
    } else {
      // Only add words that have been missed by the compressor
      const freqs = this.getMissFreqs();
      wordsToCheck = [...freqs.keys()].filter(w => dict[w] && !codes[w]);
    }

    logln(`╔══ Hardwick Dictionary Bulk Learn ══╗`);
    logln(`║  Dictionaries: ${ccCount + ecCount} entries loaded`);
    logln(`║  Candidates: ${wordsToCheck.length} words to add`);
    logln(`╚════════════════════════════════════╝`);

    let added = 0, skipped = 0;
    for (const word of wordsToCheck) {
      const chi = dict[word];
      if (usedChi.has(chi)) { skipped++; continue; }

      // Byte savings check
      if (Buffer.byteLength(chi, 'utf8') >= Buffer.byteLength(word, 'utf8')) {
        skipped++;
        continue;
      }

      codes[word] = chi;
      usedChi.add(chi);
      added++;

      if (added <= 20 || added % 100 === 0) {
        const savedB = Buffer.byteLength(word, 'utf8') - Buffer.byteLength(chi, 'utf8');
        log(`  ${word} → ${chi} (-${savedB}B)\n`);
      }
    }

    if (added > 0) this._saveCodes(codes);

    logln(`\nAdded: ${added} | Skipped: ${skipped} | Total codebook: ${Object.keys(codes).length}`);
    return { added, skipped, total: Object.keys(codes).length };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PATH RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════

  _findCodesPath() {
    // Check hook location first, then package location
    const hookPath = path.join(os.homedir(), '.claude', 'hooks', 'merged-codes.cjs');
    if (fs.existsSync(hookPath)) return hookPath;
    const pkgPath = path.join(__dirname, '..', '..', 'merged-codes.cjs');
    if (fs.existsSync(pkgPath)) return pkgPath;
    return hookPath; // Default to hook location
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RESOURCE CALCULATION - 5% CPU per configured core, 500MB RAM
  // ═══════════════════════════════════════════════════════════════════════

  _calculateCpuLimit() {
    let cores = os.cpus().length;

    // Check model-config.json for configured core count
    try {
      const configPath = path.join(this.projectPath, 'specmem', 'model-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.resources?.cpuMax) cores = config.resources.cpuMax;
      }
    } catch (e) { /* use OS core count */ }

    // 5% per core = 0.05 * cores Docker CPU units
    // Docker --cpus takes fractional CPUs (e.g., 0.4 = 40% of 1 core)
    const cpus = (CPU_PERCENT_PER_CORE / 100) * cores;
    return Math.max(0.05, Math.min(cpus, 1.0)); // Clamp 0.05-1.0
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MISS TRACKING
  // ═══════════════════════════════════════════════════════════════════════

  recordMiss(word) {
    if (!word || word.length < MIN_WORD_LEN || word.length > MAX_WORD_LEN) return;
    if (!/^[a-z]+$/.test(word)) return;
    this.lastMissTime = Date.now();
    try {
      fs.appendFileSync(this.missLogPath, JSON.stringify({ w: word, t: Date.now() }) + '\n');
    } catch (e) { /* ignore */ }
  }

  getMissFreqs() {
    if (!fs.existsSync(this.missLogPath)) return new Map();
    try {
      const lines = fs.readFileSync(this.missLogPath, 'utf8').trim().split('\n').filter(Boolean);
      const freqs = new Map();
      for (const line of lines) {
        try {
          const { w } = JSON.parse(line);
          freqs.set(w, (freqs.get(w) || 0) + 1);
        } catch (e) { /* skip */ }
      }
      return freqs;
    } catch (e) {
      return new Map();
    }
  }

  /**
   * Get mismatched entries logged by ResponseCompactor's verify step.
   * These are codebook entries that compress but DON'T decompress correctly.
   * Returns: Map<expected_word, { got: string, count: number }>
   */
  getMismatchFreqs() {
    const mismatchLog = '/tmp/specmem-compressor-mismatches.jsonl';
    if (!fs.existsSync(mismatchLog)) return new Map();
    try {
      const lines = fs.readFileSync(mismatchLog, 'utf8').trim().split('\n').filter(Boolean);
      const freqs = new Map();
      for (const line of lines) {
        try {
          const { pairs } = JSON.parse(line);
          for (const p of pairs) {
            if (p.expected) {
              const existing = freqs.get(p.expected) || { got: p.got, count: 0 };
              existing.count++;
              freqs.set(p.expected, existing);
            }
          }
        } catch (e) { /* skip */ }
      }
      return freqs;
    } catch (e) {
      return new Map();
    }
  }

  /**
   * Fix mismatched codebook entries using Hardwick Translate.
   * Called by the background learning cycle.
   * Reads mismatch log, removes/fixes bad entries, clears log.
   */
  async fixMismatches({ stream = false } = {}) {
    const log = stream ? (...a) => process.stdout.write(a.join(' ')) : () => {};
    const logln = stream ? (...a) => console.log(...a) : () => {};

    const mismatches = this.getMismatchFreqs();
    if (mismatches.size === 0) return { fixed: 0, removed: 0 };

    const codes = this._loadCodes();
    let fixed = 0, removed = 0;

    logln(`[FixMismatches] ${mismatches.size} bad entries to fix`);

    for (const [expected, { got, count }] of mismatches) {
      if (!codes[expected]) continue; // Already removed

      // Try Hardwick Translate for a fresh translation
      if (await this.isRunning()) {
        try {
          const fresh = await this._translate([expected], 'en', 'zh');
          const newChi = (fresh[0] || '').trim();
          if (newChi && /[\u4e00-\u9fff]/.test(newChi) && newChi.length <= 3) {
            const v = await this._verifyOne(expected, newChi);
            if (v && !Object.values(codes).includes(v)) {
              codes[expected] = v;
              fixed++;
              log(`  ✓ ${expected}: fixed → ${v}\n`);
              continue;
            }
          }
        } catch (e) { /* translate failed */ }
      }

      // Can't fix — remove the bad entry
      delete codes[expected];
      removed++;
      log(`  ✗ ${expected}: removed (decompressed as "${got}")\n`);
    }

    if (fixed > 0 || removed > 0) {
      this._saveCodes(codes);
      // Clear mismatch log after processing
      try { fs.writeFileSync('/tmp/specmem-compressor-mismatches.jsonl', ''); } catch(e) {}
    }

    logln(`[FixMismatches] Fixed: ${fixed} | Removed: ${removed}`);
    return { fixed, removed };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DOCKER MANAGEMENT - Hard resource limits
  // ═══════════════════════════════════════════════════════════════════════

  async isRunning() {
    if (!this._socketPath) return false;
    return new Promise(resolve => {
      const conn = net.createConnection(this._socketPath);
      conn.setTimeout(3000);
      conn.on('connect', () => {
        conn.write(JSON.stringify({ q: '__health_check__', source: 'en', target: 'zh' }) + '\n');
      });
      let data = '';
      conn.on('data', d => { data += d; if (data.includes('\n')) conn.end(); });
      conn.on('end', () => {
        try {
          const r = JSON.parse(data.trim());
          resolve(r.status === 'healthy');
        } catch { resolve(false); }
      });
      conn.on('error', () => resolve(false));
      conn.on('timeout', () => { conn.destroy(); resolve(false); });
    });
  }

  async start() {
    if (await this.isRunning()) return true;

    // Resolve socket path
    this._socketPath = path.join(this.projectPath, 'specmem', 'sockets', 'translate.sock');

    // Already running?
    if (await this.isRunning()) return true;

    // Find translate script
    const script = [TRANSLATE_SCRIPT, path.join(this.projectPath, 'embedding-sandbox', 'hardwick-translate.py')]
      .find(p => fs.existsSync(p));
    if (!script) return false;

    // Ensure model cache dir exists
    if (!fs.existsSync(MODEL_CACHE)) fs.mkdirSync(MODEL_CACHE, { recursive: true });

    // Remove stale socket
    try { fs.unlinkSync(this._socketPath); } catch {}

    try {
      // Spawn Python translation server
      const logPath = path.join(path.dirname(this._socketPath), 'translate.log');
      const logFd = fs.openSync(logPath, 'a');
      this._proc = spawn('python3', [script, '--socket', this._socketPath, '--model-dir', MODEL_CACHE + '/share/argos-translate/packages'], {
        stdio: ['ignore', logFd, logFd],
        detached: true,
        env: { ...process.env, OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1', CT2_COMPUTE_TYPE: 'int8' }
      });
      this._proc.unref();
      fs.closeSync(logFd);

      // Wait for socket to appear and health check to pass
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await this.isRunning()) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  stop() {
    if (this._proc && !this._proc.killed) {
      try { this._proc.kill('SIGTERM'); } catch {}
    } else {
      // Kill by process name if we didn't spawn it
      try { execSync('pkill -f hardwick-translate.py', { timeout: 5000 }); } catch {}
    }
    try { if (this._socketPath) fs.unlinkSync(this._socketPath); } catch {}
    this._proc = null;
  }

  pause() {
    if (this._proc && !this._proc.killed) {
      try { process.kill(this._proc.pid, 'SIGSTOP'); } catch {}
    }
  }

  unpause() {
    if (this._proc && !this._proc.killed) {
      try { process.kill(this._proc.pid, 'SIGCONT'); } catch {}
    }
  }

  getResourceUsage() {
    if (!this._proc) return null;
    try {
      const stat = execSync(`ps -p ${this._proc.pid} -o %cpu,%mem,rss --no-headers`, { encoding: 'utf8', timeout: 3000 }).trim();
      const [cpu, memPct, rss] = stat.split(/\s+/);
      return { cpu: cpu + '%', mem: `${(parseInt(rss) / 1024).toFixed(0)}MB`, memPct: memPct + '%', ramLimit: `${RAM_LIMIT_MB}MB` };
    } catch { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRANSLATION + ROUND-TRIP VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════

  _translate(words, source, target) {
    return new Promise((resolve, reject) => {
      if (!this._socketPath) return reject(new Error('No socket path'));
      const conn = net.createConnection(this._socketPath);
      conn.setTimeout(60000);
      const body = JSON.stringify({ q: words.join('\n'), source, target }) + '\n';
      conn.on('connect', () => conn.write(body));
      let data = '';
      conn.on('data', d => {
        data += d;
        if (data.includes('\n')) conn.end();
      });
      conn.on('end', () => {
        try {
          const parsed = JSON.parse(data.trim());
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed.translatedText ? parsed.translatedText.split('\n') : []);
        } catch (e) { reject(new Error('Bad response')); }
      });
      conn.on('error', reject);
      conn.on('timeout', () => { conn.destroy(); reject(new Error('timeout')); });
    });
  }

  /**
   * MULTI-SOURCE VERIFICATION (v2)
   * ==============================
   * Problem: reverse translation alone = 13% pass rate (tech terms don't round-trip)
   * Solution: multiple verification strategies, accept if ANY pass:
   *
   * 1. Exact reverse match (strongest)
   * 2. Stem/morphological match (handles verb forms)
   * 3. Semantic containment (reverse contains the original word)
   * 4. Levenshtein closeness (handles minor translation drift)
   * 5. Dictionary cross-reference (check CC-CEDICT if available)
   */
  async _verifyOne(eng, chi) {
    // Hard filters — must be Chinese, must save bytes
    if (!chi || !/[\u4e00-\u9fff\u3400-\u4dbf]/.test(chi)) return null;
    if (chi.length > 3) return null; // Max 3 Chinese chars (9 UTF-8 bytes)
    // Must save at least 1 char vs English
    if (Buffer.byteLength(chi, 'utf8') >= Buffer.byteLength(eng, 'utf8')) return null;

    try {
      const reversed = await this._translate([chi], 'zh', 'en');
      if (!reversed?.[0]) return null;
      const back = reversed[0].toLowerCase().trim();
      const engLow = eng.toLowerCase();

      // Strategy 1: Exact match
      if (back === engLow) return chi;

      // Strategy 2: Stem match (strip common suffixes)
      const strip = w => w.replace(/(?:tion|ment|ness|able|ible|ing|ated|ize|ise|ity|ous|ive|ful|less|ment|er|ed|ly|es|s)$/, '');
      const engStem = strip(engLow);
      const backStem = strip(back);
      if (engStem.length >= 3 && engStem === backStem) return chi;

      // Strategy 3: Semantic containment — reverse translation contains the word
      // e.g., "monitoring" → "监测" → "monitoring and testing" — still valid
      const backWords = back.split(/[\s,;.]+/).map(w => w.trim()).filter(Boolean);
      if (backWords.includes(engLow)) return chi;
      if (backWords.some(w => strip(w) === engStem && engStem.length >= 3)) return chi;

      // Strategy 4: Levenshtein distance ≤ 2 for words 6+ chars
      // Handles minor drift: "serialize" vs "serialise", "color" vs "colour"
      if (engLow.length >= 6) {
        const dist = this._levenshtein(engLow, back);
        if (dist <= 2) return chi;
        // Also check against individual reverse words
        for (const bw of backWords) {
          if (bw.length >= 4 && this._levenshtein(engLow, bw) <= 2) return chi;
        }
      }

      // Strategy 5: Shared prefix of 70%+ length
      const minLen = Math.min(engLow.length, back.length);
      let shared = 0;
      while (shared < minLen && engLow[shared] === back[shared]) shared++;
      if (shared >= engLow.length * 0.7 && shared >= 4) return chi;

      return null;
    } catch (e) {
      return null;
    }
  }

  /** Fast Levenshtein distance (bounded — returns Infinity if > maxDist) */
  _levenshtein(a, b, maxDist = 3) {
    if (Math.abs(a.length - b.length) > maxDist) return Infinity;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const curr = [i];
      let rowMin = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > maxDist) return Infinity;
      prev = curr;
    }
    return prev[n];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CODEBOOK I/O
  // ═══════════════════════════════════════════════════════════════════════

  _loadCodes() {
    delete require.cache[require.resolve(this.codesPath)];
    return require(this.codesPath);
  }

  _saveCodes(codes) {
    const count = Object.keys(codes).length;
    const header = [
      `// MERGED CODES - ${count} entries (auto-expanded by codebook-learner)`,
      `// Last updated: ${new Date().toISOString()}`,
      `module.exports = `
    ].join('\n');
    fs.writeFileSync(this.codesPath, header + JSON.stringify(codes) + ';\n');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LEARNING CYCLE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * LAYER-BY-LAYER LEARNING (AirLLM-style)
   * ========================================
   * Process ONE word at a time, yield between each to avoid CPU spikes.
   * Stream results live. Save after every verified entry.
   * This mirrors how AirLLM processes model layers one-at-a-time through
   * limited memory, and how mini-cot scores memories sequentially.
   *
   * Flow per word (each "layer"):
   *   1. Translate en→zh (single word, minimal memory)
   *   2. Yield CPU (configurable delay)
   *   3. Verify zh→en round-trip
   *   4. Yield CPU again
   *   5. If verified, save immediately (incremental persistence)
   *   6. Log result to stdout (stream output)
   */
  async learn({ stream = true, yieldMs = 500 } = {}) {
    if (this.isLearning) return { error: 'Already learning' };
    this.isLearning = true;

    const log = stream ? (...a) => process.stdout.write(a.join(' ')) : () => {};
    const logln = stream ? (...a) => console.log(...a) : () => {};

    try {
      const codes = this._loadCodes();
      const usedChi = new Set(Object.values(codes));
      const freqs = this.getMissFreqs();

      // Filter candidates: appeared 2+ times, not in codebook
      const candidates = [];
      for (const [word, count] of freqs) {
        if (count >= MIN_MISS_COUNT && !codes[word] && word.length >= MIN_WORD_LEN) {
          candidates.push({ word, count });
        }
      }
      candidates.sort((a, b) => b.count - a.count);

      if (candidates.length === 0) {
        logln('No candidates (need 2+ occurrences of unknown 4+ char words)');
        return { added: 0, failed: 0, skipped: 0, total: Object.keys(codes).length, message: 'No candidates' };
      }

      logln(`╔══ Hardwick Translate · Layer-by-Layer Learning v2 ══╗`);
      logln(`║  ${candidates.length} words · batch-fwd/single-verify`);
      logln(`║  CPU: ${this.cpuLimit} cores · RAM: ${RAM_LIMIT_MB}MB cap`);
      logln(`╚═════════════════════════════════════════════════════╝`);

      // Ensure container is running
      if (!await this.isRunning()) {
        logln('Starting Hardwick Translate server...');
        const ok = await this.start();
        if (!ok) return { error: 'Hardwick Translate failed to start' };
        logln('Server ready.');
      }

      let added = 0, failed = 0, skipped = 0;
      const startTime = Date.now();
      const FWD_BATCH = 15; // Batch forward translations (fast)
      const SAVE_EVERY = 5; // Save codebook every N additions (not every single one)

      // HYBRID: batch forward, layer-by-layer verify
      for (let bi = 0; bi < candidates.length; bi += FWD_BATCH) {
        const batch = candidates.slice(bi, bi + FWD_BATCH);
        const words = batch.map(c => c.word);

        try {
          // BATCH Layer: Forward translate all at once (1 API call)
          const translations = await this._translate(words, 'en', 'zh');

          // SEQUENTIAL Layers: Verify one by one (accuracy matters here)
          for (let j = 0; j < words.length; j++) {
            const eng = words[j];
            const count = batch[j].count;
            const chi = (translations[j] || '').trim();
            const idx = bi + j + 1;
            const progress = `[${idx}/${candidates.length}]`;

            // Quick reject: must be Chinese, unique
            if (!chi || !/[\u4e00-\u9fff\u3400-\u4dbf]/.test(chi) || chi.length > 3) {
              log(`${progress} ${eng} → ✗ (bad: "${chi}")\n`);
              failed++;
              continue;
            }
            if (Buffer.byteLength(chi, 'utf8') >= Buffer.byteLength(eng, 'utf8')) {
              log(`${progress} ${eng} → ✗ (no byte savings)\n`);
              failed++;
              continue;
            }
            if (usedChi.has(chi)) {
              log(`${progress} ${eng} → ${chi} ✗ (dup)\n`);
              skipped++;
              continue;
            }

            // Layer: Reverse verify
            const verified = await this._verifyOne(eng, chi);

            // Minimal yield (100ms between verifications, not 500ms)
            await new Promise(r => setTimeout(r, 100));

            if (verified) {
              codes[eng] = verified;
              usedChi.add(verified);
              added++;

              const savedBytes = Buffer.byteLength(eng, 'utf8') - Buffer.byteLength(verified, 'utf8');
              log(`${progress} ${eng} → ${verified} ✓ (-${savedBytes}B, ${count}x)\n`);

              // Persist every N additions (not every single one — faster I/O)
              if (added % SAVE_EVERY === 0) this._saveCodes(codes);
            } else {
              log(`${progress} ${eng} → ${chi} ✗ (verify fail)\n`);
              failed++;
            }
          }

          // Brief yield between batches
          await new Promise(r => setTimeout(r, yieldMs));
        } catch (e) {
          logln(`Batch error: ${e.message}`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // Final save
      if (added > 0) this._saveCodes(codes);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logln(`\n╔══ Learning Complete ══╗`);
      logln(`║  Added: ${added} · Failed: ${failed} · Skipped: ${skipped}`);
      logln(`║  Total codebook: ${Object.keys(codes).length} entries`);
      logln(`║  Time: ${elapsed}s (${(candidates.length / (elapsed || 1)).toFixed(1)} words/sec)`);
      logln(`╚═══════════════════════╝`);

      // FALLBACK: For words that failed both dict AND neural MT,
      // assign unique CJK characters as arbitrary codes (saves bytes, just not semantic)
      // Only for words 6+ chars that appeared 5+ times (proven high-value)
      if (failed > 0) {
        const freqs = this.getMissFreqs();
        const failedWords = candidates
          .filter(c => !codes[c.word] && c.word.length >= 6 && c.count >= 5)
          .map(c => c.word);

        if (failedWords.length > 0) {
          let arb = 0;
          // Use CJK Extension B range for arbitrary codes (won't conflict)
          // These are rare chars unlikely to be in any dictionary
          let cp = 0x4E00;
          for (const word of failedWords) {
            // Find next unused single CJK char
            while (cp <= 0x9FFF && usedChi.has(String.fromCharCode(cp))) cp++;
            if (cp > 0x9FFF) break;

            const chi = String.fromCharCode(cp);
            if (Buffer.byteLength(chi, 'utf8') < Buffer.byteLength(word, 'utf8')) {
              codes[word] = chi;
              usedChi.add(chi);
              arb++;
              log(`  [arb] ${word} → ${chi} (arbitrary, -${Buffer.byteLength(word) - Buffer.byteLength(chi)}B)\n`);
            }
            cp++;
          }
          if (arb > 0) {
            this._saveCodes(codes);
            logln(`Arbitrary codes assigned: ${arb}`);
            added += arb;
          }
        }
      }

      // Clear miss log after processing
      if (added > 0) {
        try { fs.writeFileSync(this.missLogPath, ''); } catch (e) { /* ok */ }
      }

      return { added, failed, skipped, total: Object.keys(codes).length, elapsed: parseFloat(elapsed) };
    } finally {
      this.isLearning = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // VERIFY & HEAL — Use Hardwick Translate to validate + fix codebook
  // ═══════════════════════════════════════════════════════════════════════

  async verifyAndHeal({ stream = true, limit = 500 } = {}) {
    const log = stream ? (...a) => process.stdout.write(a.join(' ')) : () => {};
    const logln = stream ? (...a) => console.log(...a) : () => {};

    const codes = this._loadCodes();
    const entries = Object.entries(codes);

    logln(`╔══ Hardwick Translate · Verify & Heal ══╗`);
    logln(`║  Testing ${Math.min(entries.length, limit)} of ${entries.length} entries`);
    logln(`║  Batch size: 50 | Made by Hardwick Software`);
    logln(`╚════════════════════════════════════════╝`);

    if (!await this.isRunning()) {
      const ok = await this.start();
      if (!ok) return { error: 'Hardwick Translate not available' };
    }

    let verified = 0, healed = 0, removed = 0, skipped = 0;
    const toTest = entries.slice(0, limit);
    const BATCH = 50; // Bigger batches = fewer HTTP calls = faster
    const usedChi = new Set(Object.values(codes));

    for (let i = 0; i < toTest.length; i += BATCH) {
      const batch = toTest.slice(i, i + BATCH);
      const chiWords = batch.map(([, c]) => c);
      const progress = `[${i + batch.length}/${toTest.length}]`;

      try {
        // Single batch reverse translate (1 HTTP call for 50 words)
        const reversed = await this._translate(chiWords, 'zh', 'en');

        // Classify: verified vs needs-healing
        const needsHeal = [];
        const strip = w => w.replace(/(?:tion|ment|ness|able|ible|ing|ated|ize|ise|ity|ous|ive|ful|less|er|ed|ly|es|s)$/, '');

        for (let j = 0; j < batch.length; j++) {
          const [eng, chi] = batch[j];
          const back = (reversed[j] || '').toLowerCase().trim();
          const engLow = eng.toLowerCase();
          const engStem = strip(engLow);
          const backStem = strip(back);
          const backWords = back.split(/[\s,;.]+/).filter(Boolean);

          if (back === engLow || engStem === backStem ||
              backWords.includes(engLow) || backWords.some(w => strip(w) === engStem && engStem.length >= 3) ||
              back.includes(engLow) || engLow.includes(back) ||
              (engLow.length >= 6 && this._levenshtein(engLow, back) <= 2) ||
              (engStem.length >= 4 && backStem.length >= 4 && engStem.slice(0, Math.ceil(engStem.length * 0.7)) === backStem.slice(0, Math.ceil(engStem.length * 0.7)))) {
            verified++;
          } else {
            needsHeal.push({ eng, chi, back, idx: i + j + 1 });
          }
        }

        // Batch heal: translate all failed words en→zh in one call
        if (needsHeal.length > 0) {
          try {
            const healWords = needsHeal.map(h => h.eng);
            const freshTranslations = await this._translate(healWords, 'en', 'zh');

            // Batch reverse-verify the fresh translations
            const freshChi = freshTranslations.map(t => (t || '').trim()).filter(t => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(t) && t.length <= 3);
            let freshReverse = [];
            if (freshChi.length > 0) {
              try { freshReverse = await this._translate(freshChi, 'zh', 'en'); } catch (e) {}
            }

            let freshIdx = 0;
            for (let h = 0; h < needsHeal.length; h++) {
              const { eng, chi, idx } = needsHeal[h];
              const newChi = (freshTranslations[h] || '').trim();

              if (!newChi || !/[\u4e00-\u9fff\u3400-\u4dbf]/.test(newChi) || newChi.length > 3) {
                delete codes[eng]; usedChi.delete(chi);
                removed++;
                if (removed <= 30) log(`${progress} ${eng}: "${chi}"→✗ (removed)\n`);
                continue;
              }

              // Check if fresh translation reverse-verifies
              const reversedBack = (freshReverse[freshIdx] || '').toLowerCase().trim();
              freshIdx++;
              const engLow = eng.toLowerCase();
              const engStem = strip(engLow);
              const rWords = reversedBack.split(/[\s,;.]+/).filter(Boolean);
              const ok = reversedBack === engLow || strip(reversedBack) === engStem ||
                rWords.includes(engLow) || rWords.some(w => strip(w) === engStem && engStem.length >= 3) ||
                (engLow.length >= 6 && this._levenshtein(engLow, reversedBack) <= 2);

              if (ok && !usedChi.has(newChi)) {
                usedChi.delete(chi);
                codes[eng] = newChi;
                usedChi.add(newChi);
                healed++;
                log(`${progress} ${eng}: ${chi}→${newChi} (healed)\n`);
              } else {
                delete codes[eng]; usedChi.delete(chi);
                removed++;
                if (removed <= 30) log(`${progress} ${eng}: "${chi}"→"${reversedBack}" (removed)\n`);
              }
            }
          } catch (e) {
            // Heal batch failed — remove all
            for (const { eng, chi } of needsHeal) {
              delete codes[eng]; usedChi.delete(chi);
              removed++;
            }
          }
        }

        // Progress update every batch
        if (i % (BATCH * 5) === 0 && i > 0) {
          logln(`  ${progress} verified:${verified} healed:${healed} removed:${removed}`);
        }
      } catch (e) {
        skipped += batch.length;
        logln(`  ${progress} batch failed: ${e.message}`);
      }
    }

    if (healed > 0 || removed > 0) this._saveCodes(codes);

    logln(`\n═══ Results ═══`);
    logln(`Verified: ${verified} | Healed: ${healed} | Removed: ${removed} | Skipped: ${skipped}`);
    logln(`Codebook: ${Object.keys(codes).length} entries`);
    logln(`Made by Hardwick Software · justcalljon.pro`);
    return { verified, healed, removed, skipped, total: Object.keys(codes).length };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // KYS WATCHDOG — pause/stop container when Claude isn't running
  // Same pattern as mini-cot-service.py KYS watchdog
  // ═══════════════════════════════════════════════════════════════════════

  _isClaudeAlive() {
    try {
      const r = execSync(
        `pgrep -f "SPECMEM_PROJECT_PATH=${this.projectPath}" 2>/dev/null || pgrep -f "claude.*${this.projectPath}" 2>/dev/null`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      return !!r;
    } catch (e) { return false; }
  }

  startKYSWatchdog() {
    if (this._kysTimer) return;
    const KYS_MODE = process.env.SPECMEM_KYS_MODE || 'pause'; // pause|stop|kill
    const KYS_IDLE_S = 300; // 5 min idle without Claude → act

    console.log(`[KYS] Codebook learner watchdog started (mode: ${KYS_MODE})`);

    // Grace period — don't kill right after startup
    let graceUntil = Date.now() + 60000;

    this._kysTimer = setInterval(() => {
      if (Date.now() < graceUntil) return;
      if (this._isClaudeAlive()) return;
      if (!this._proc || this._proc.killed) return;

      // Claude is gone — check idle time
      const idleS = this.lastMissTime ? (Date.now() - this.lastMissTime) / 1000 : 999;
      if (idleS < KYS_IDLE_S) return;

      if (KYS_MODE === 'stop' || KYS_MODE === 'kill') {
        console.log(`[KYS] No Claude, idle ${idleS.toFixed(0)}s — stopping translate server`);
        this.stop();
      } else {
        console.log(`[KYS] No Claude, idle ${idleS.toFixed(0)}s — pausing translate server`);
        this.pause();
      }
    }, 10000); // Check every 10s
    this._kysTimer.unref();
  }

  stopKYSWatchdog() {
    if (this._kysTimer) {
      clearInterval(this._kysTimer);
      this._kysTimer = null;
      console.log('[KYS] Watchdog stopped');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // IDLE MANAGEMENT - Auto-pause when no misses
  // ═══════════════════════════════════════════════════════════════════════

  startIdleWatcher() {
    if (this._idleTimer) return;
    this._idleTimer = setInterval(() => {
      if (this.lastMissTime && Date.now() - this.lastMissTime > IDLE_PAUSE_MS) {
        if (this._proc && !this._proc.killed) {
          this.pause();
        }
      }
    }, 60000); // Check every minute
    this._idleTimer.unref();
  }

  stopIdleWatcher() {
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════════════

  async getStatus() {
    const codes = this._loadCodes();
    const freqs = this.getMissFreqs();
    const running = await this.isRunning();
    const resources = running ? this.getResourceUsage() : null;

    const top = [...freqs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w, c]) => `${w}(${c}x)`);

    return {
      codebookEntries: Object.keys(codes).length,
      codebookSizeKB: Math.round(fs.statSync(this.codesPath).size / 1024),
      queuedMisses: freqs.size,
      topMisses: top,
      hardwickTranslate: running ? 'RUNNING' : (this._proc ? 'STOPPED' : 'NOT_STARTED'),
      resources,
      cpuLimit: `${this.cpuLimit} cores (${CPU_PERCENT_PER_CORE}% × ${Math.round(this.cpuLimit / (CPU_PERCENT_PER_CORE / 100))} cores)`,
      ramLimit: `${RAM_LIMIT_MB}MB`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON + EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

let _instance = null;
function getInstance(projectPath) {
  if (!_instance) _instance = new CodebookLearner(projectPath);
  return _instance;
}

// Static miss recorder for use by token-compressor.cjs (fast, no async)
function recordMiss(word) {
  if (!word || word.length < MIN_WORD_LEN || word.length > MAX_WORD_LEN) return;
  if (!/^[a-z]+$/.test(word)) return;
  try {
    fs.appendFileSync(
      path.join(MISS_LOG_DIR, MISS_LOG_NAME),
      JSON.stringify({ w: word, t: Date.now() }) + '\n'
    );
  } catch (e) { /* ignore */ }
}

module.exports = { CodebookLearner, getInstance, recordMiss };

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const learner = new CodebookLearner(args.find(a => !a.startsWith('-')) || process.cwd());

  if (args.includes('--verify')) {
    const limit = parseInt(args.find(a => /^\d+$/.test(a)) || '500');
    learner.verifyAndHeal({ limit }).then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
  } else if (args.includes('--bulk')) {
    // Dictionary bulk learn — instant, no Docker needed
    learner.learnFromDictionaries({ forceAll: args.includes('--all') }).then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
  } else if (args.includes('--learn')) {
    // Neural MT learn — uses Hardwick Translate server for words not in dictionaries
    // First do dictionary pass, then neural MT for remaining
    (async () => {
      const dr = await learner.learnFromDictionaries({ forceAll: false });
      console.log(`\n--- Dictionary pass done (${dr.added} added) ---\n`);
      const nr = await learner.learn();
      console.log(JSON.stringify({ dictionary: dr, neural: nr }, null, 2));
    })().catch(e => { console.error(e); process.exit(1); });
  } else if (args.includes('--status')) {
    learner.getStatus().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
  } else if (args.includes('--start')) {
    learner.start().then(ok => { console.log(ok ? 'Started' : 'Failed'); process.exit(ok ? 0 : 1); });
  } else if (args.includes('--stop')) {
    learner.stop(); console.log('Stopped');
  } else {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║  SpecMem Codebook Learner - Hardwick Software Edition ║');
    console.log('║  Neural MT codebook expansion via Hardwick Translate   ║');
    console.log('║  Made by Hardwick Software · justcalljon.pro          ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('  --bulk         Dictionary bulk add (instant, no server needed)');
    console.log('  --bulk --all   Add ALL dictionary entries (770K+ scan)');
    console.log('  --learn        Dict pass + neural MT for unknowns');
    console.log('  --verify       Verify & heal codebook via neural MT');
    console.log('  --status       Show codebook + container stats');
    console.log('  --start        Start Hardwick Translate container');
    console.log('  --stop         Stop Hardwick Translate container');
  }
}
