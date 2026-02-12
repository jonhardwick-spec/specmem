#!/usr/bin/env node
/**
 * SPECMEM FIRST-RUN MODEL SETUP
 * ==============================
 *
 * Downloads base embedding model, then optimizes it locally.
 * THE FLEX: "Downloading the shit... Now optimizing the shit..."
 *
 * Now with SMOOTH loading bars like specmem-init!
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get the Python executable path for spawning Python processes (Task #22 fix)
 * Priority: SPECMEM_PYTHON_PATH > PYTHON_PATH > VIRTUAL_ENV/bin/python > python3
 */
function getPythonPath() {
  if (process.env['SPECMEM_PYTHON_PATH']) return process.env['SPECMEM_PYTHON_PATH'];
  if (process.env['PYTHON_PATH']) return process.env['PYTHON_PATH'];
  const virtualEnv = process.env['VIRTUAL_ENV'];
  if (virtualEnv) {
    const isWindows = process.platform === 'win32';
    return isWindows ? virtualEnv + '/Scripts/python.exe' : virtualEnv + '/bin/python';
  }
  return 'python3';
}

// ============================================================================
// ANSI COLORS - Full color system like specmem-init
// ============================================================================
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Standard colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',

  // Cursor control
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clearLine: '\x1b[2K',
  cursorStart: '\x1b[0G',
  cursorUp: (n) => `\x1b[${n}A`,
};

// ============================================================================
// ROOT/NON-ROOT DETECTION - Dynamic paths based on user privileges
// ============================================================================
function isRootUser() {
  if (process.getuid && process.getuid() === 0) return true;
  if (process.geteuid && process.geteuid() === 0) return true;
  try {
    fs.accessSync('/usr/lib', fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

// Config - paths differ based on root/non-root
const MODEL_NAME = 'sentence-transformers/all-MiniLM-L6-v2';
const SPECMEM_PKG_DIR = path.resolve(__dirname, '..');
const IS_ROOT = isRootUser();

// Root: use package dir, Non-root: use ~/.specmem
const SPECMEM_DIR = IS_ROOT ? SPECMEM_PKG_DIR : path.join(os.homedir(), '.specmem');
const MODELS_DIR = path.join(SPECMEM_DIR, 'models');
const OPTIMIZED_DIR = path.join(MODELS_DIR, 'optimized');
const BASE_MODEL_DIR = path.join(MODELS_DIR, 'base');

// Ensure user dirs exist for non-root
if (!IS_ROOT) {
  try {
    fs.mkdirSync(SPECMEM_DIR, { recursive: true });
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  } catch (e) {}
}

// ============================================================================
// PROGRESS UI - Exact copy from specmem-init.cjs for 1:1 consistency
// ============================================================================
class ProgressUI {
  constructor() {
    this.currentStage = 0;
    this.totalStages = 5; // Python check, Python deps, Node deps, Download, Optimize
    this.stageName = '';
    this.status = '';
    this.subStatus = '';
    this.spinnerFrames = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
    this.fireFrames = ['🔥', '💥', '⚡', '✨', '🔥'];
    this.spinnerIndex = 0;
    this.fireIndex = 0;
    this.interval = null;
    this.startTime = Date.now();
    this.width = Math.min(process.stdout.columns || 80, 76);
    this.completedStages = [];

    // Sub-progress within stage (0-1 for smooth bar increments)
    this.subProgress = 0;

    // Animation offset for shimmer effect on grey filler
    this.shimmerOffset = 0;

    // Warnings/errors footer
    this.lastWarning = '';
    this.warningCount = 0;

    // Render lock
    this.isRendering = false;
  }

  addWarning(msg) {
    this.warningCount++;
    this.lastWarning = msg.length > 60 ? msg.slice(0, 57) + '...' : msg;
  }

  start() {
    process.stdout.write(c.hideCursor);

    // Skip banner if called from specmem-init (avoids double banner)
    const calledFromInit = process.env.SPECMEM_CALLED_FROM_INIT === '1';

    if (!calledFromInit) {
      // Full banner for standalone run
      console.log(`
${c.cyan}${c.bold}╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   ${c.white}███████╗██████╗ ███████╗ ██████╗███╗   ███╗███████╗███╗   ███╗${c.cyan}              ║
║   ${c.white}██╔════╝██╔══██╗██╔════╝██╔════╝████╗ ████║██╔════╝████╗ ████║${c.cyan}              ║
║   ${c.white}███████╗██████╔╝█████╗  ██║     ██╔████╔██║█████╗  ██╔████╔██║${c.cyan}              ║
║   ${c.white}╚════██║██╔═══╝ ██╔══╝  ██║     ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║${c.cyan}              ║
║   ${c.white}███████║██║     ███████╗╚██████╗██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║${c.cyan}              ║
║   ${c.white}╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝${c.cyan}              ║
║                                                                               ║
║   ${c.magenta}FIRST-RUN MODEL SETUP${c.cyan}                                                      ║
║   ${c.dim}https://justcalljon.pro${c.reset}${c.cyan}${c.bold}                                                    ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝${c.reset}
`);
      // Version info
      let version = 'unknown';
      try { version = require('../package.json').version; } catch (e) {}
      process.stdout.write(`  ${c.dim}v${version}${c.reset} ${c.cyan}│${c.reset} ${c.dim}Hardwick Software Services${c.reset}\n`);
      process.stdout.write(`${c.dim}${'─'.repeat(this.width)}${c.reset}\n`);
    }

    // Reserve lines for progress UI (5 lines)
    process.stdout.write('\n\n\n\n\n');

    this.interval = setInterval(() => this.render(), 60);
  }

  render() {
    if (this.isRendering) return;
    this.isRendering = true;

    try {
      const spinner = this.spinnerFrames[this.spinnerIndex];
      const fire = this.fireFrames[this.fireIndex];
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this.fireIndex = (this.fireIndex + 1) % this.fireFrames.length;

      // Advance shimmer animation
      this.shimmerOffset = (this.shimmerOffset + 1) % 30;

      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);

      // PER-STAGE LOADING BAR
      const percent = Math.min(100, Math.round(this.subProgress * 100));

      // Build progress bar
      const barWidth = this.width - 20;
      const filled = Math.round((percent / 100) * barWidth);
      const empty = barWidth - filled;

      // Stage color gradient
      let barColor = c.red;
      let barColorCode = '\x1b[38;5;196m'; // Red
      if (percent >= 25) { barColor = c.brightRed; barColorCode = '\x1b[38;5;202m'; }
      if (percent >= 50) { barColor = c.yellow; barColorCode = '\x1b[38;5;220m'; }
      if (percent >= 75) { barColor = c.brightYellow; barColorCode = '\x1b[38;5;226m'; }
      if (percent >= 90) { barColor = c.brightGreen; barColorCode = '\x1b[38;5;46m'; }

      // FILLED PORTION - shimmer pulse
      let filledPart = '';
      for (let i = 0; i < filled; i++) {
        const shimmerPos = (i + this.shimmerOffset) % 30;
        if (shimmerPos >= 12 && shimmerPos <= 18) {
          const highlightColor = percent >= 90 ? '\x1b[38;5;51m' :
                                 percent >= 75 ? '\x1b[38;5;230m' :
                                 percent >= 50 ? '\x1b[38;5;226m' :
                                 percent >= 25 ? '\x1b[38;5;208m' :
                                 '\x1b[38;5;202m';
          filledPart += `${highlightColor}█`;
        } else if (shimmerPos === 11 || shimmerPos === 19) {
          filledPart += `${barColorCode}▓`;
        } else {
          filledPart += `${barColorCode}█`;
        }
      }

      // EMPTY PORTION - grey box with construction stripes
      let emptyPart = '';
      if (empty > 0) {
        emptyPart += `${c.gray}╢`;
        const stripePattern = ['╱', ' ', ' '];
        const interior = empty - 2;
        for (let i = 0; i < interior; i++) {
          const patternIndex = (i + Math.floor(this.shimmerOffset / 3)) % stripePattern.length;
          emptyPart += `${c.gray}${stripePattern[patternIndex]}`;
        }
        emptyPart += `${c.gray}╟`;
      }

      const bar = `${filledPart}${emptyPart}${c.reset}`;
      const statusText = this.status.substring(0, this.width - 6);

      // Build line 5 content
      let line5 = '';
      if (this.lastWarning) {
        const warnPrefix = this.warningCount > 1 ? `(${this.warningCount}) ` : '';
        line5 = `     ${c.yellow}⚠${c.reset} ${c.dim}${warnPrefix}${this.lastWarning}${c.reset}`;
      } else if (this.completedStages.length > 0) {
        const recent = this.completedStages.slice(-3).map(s => `${c.green}✓${c.dim}${s}${c.reset}`).join(' ');
        line5 = `     ${recent}`;
      }

      // ATOMIC RENDER
      const output = [
        c.cursorUp(5),
        `${c.clearLine}${c.cursorStart}  ${fire} ${c.cyan}${spinner}${c.reset} ${c.bold}[${this.currentStage}/${this.totalStages}]${c.reset} ${c.brightCyan}${this.stageName}${c.reset} ${c.dim}(${elapsed}s)${c.reset}\n`,
        `${c.clearLine}${c.cursorStart}     ${c.white}${statusText}${c.reset}\n`,
        `${c.clearLine}${c.cursorStart}  ${bar} ${c.bold}${barColor}${percent}%${c.reset}\n`,
        `${c.clearLine}${c.cursorStart}     ${c.dim}${this.subStatus || ''}${c.reset}\n`,
        `${c.clearLine}${c.cursorStart}${line5}\n`
      ];

      process.stdout.write(output.join(''));
    } finally {
      this.isRendering = false;
    }
  }

  setStage(num, name) {
    if (this.currentStage > 0 && this.stageName) {
      this.completedStages.push(this.stageName.split(' ')[0]);
    }
    this.currentStage = num;
    this.stageName = name;
    this.status = '';
    this.subStatus = '';
    this.subProgress = 0;
  }

  setStatus(status, subProgressIncrement = 0) {
    this.status = status;
    if (subProgressIncrement > 0) {
      this.subProgress = Math.min(1, this.subProgress + subProgressIncrement);
    }
  }

  setSubProgress(progress) {
    this.subProgress = Math.max(0, Math.min(1, progress));
  }

  setSubStatus(subStatus) {
    this.subStatus = subStatus;
  }

  stop(success = true) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(c.showCursor);

    if (success) {
      // Final render at 100%
      this.subProgress = 1;
      this.render();
    }
  }
}

// Global progress UI
let progress = null;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Check if Python is available
function checkPython() {
  try {
    const version = execSync('python3 --version 2>/dev/null || python --version 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return version.includes('Python 3');
  } catch (e) {
    return false;
  }
}

// Check if models already exist
function modelsExist() {
  const manifestPath = path.join(OPTIMIZED_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      return manifest.version && manifest.benchmark;
    } catch (e) {
      return false;
    }
  }
  return false;
}

// Install Python dependencies
function installPythonDeps() {
  progress.setStage(2, 'PYTHON DEPENDENCIES');
  progress.setStatus('Checking pip...');
  progress.setSubProgress(0.1);

  // Check pip
  try {
    execSync('pip3 --version', { stdio: 'pipe' });
    progress.setStatus('pip3 found', 0.1);
  } catch (e) {
    progress.setStatus('Installing pip3...');
    try {
      if (process.platform === 'linux') {
        try {
          execSync('apt-get update -qq && apt-get install -y python3-pip python3-venv', {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120000
          });
        } catch (aptErr) {
          execSync('dnf install -y python3-pip || yum install -y python3-pip', {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120000
          });
        }
      } else if (process.platform === 'darwin') {
        execSync('brew install python3', { stdio: 'pipe', timeout: 120000 });
      }
      progress.setStatus('pip3 installed', 0.1);
    } catch (installErr) {
      progress.addWarning('pip3 installation failed - will use fallback');
      progress.setSubProgress(1);
      return;
    }
  }

  const deps = [
    { name: 'torch', cmd: 'torch --index-url https://download.pytorch.org/whl/cpu' },
    { name: 'sentence-transformers', cmd: 'sentence-transformers[onnx]' },
    { name: 'onnx', cmd: 'onnx' },
    { name: 'onnxruntime', cmd: 'onnxruntime' },
    { name: 'optimum[onnxruntime]', cmd: 'optimum[onnxruntime]' },
    { name: 'optimum', cmd: 'optimum' },
    { name: 'argostranslate', cmd: 'argostranslate' },
    { name: 'ctranslate2', cmd: 'ctranslate2' },
    { name: 'sentencepiece', cmd: 'sentencepiece' },
    { name: 'emoji', cmd: 'emoji' }
  ];

  const progressPerDep = 0.8 / deps.length;
  let currentProgress = 0.2;

  for (const dep of deps) {
    progress.setStatus(`Installing ${dep.name}...`);
    progress.setSubStatus(dep.name);
    try {
      execSync(`pip3 install ${dep.cmd} --break-system-packages -q 2>/dev/null || pip install ${dep.cmd} --break-system-packages -q 2>/dev/null || pip3 install ${dep.cmd} -q 2>/dev/null || pip install ${dep.cmd} -q 2>/dev/null`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 600000
      });
      currentProgress += progressPerDep;
      progress.setSubProgress(currentProgress);
    } catch (e) {
      progress.addWarning(`${dep.name} may already be installed`);
    }
  }

  progress.setStatus('Python dependencies ready');
  progress.setSubProgress(1);
}

// Install Node.js dependencies
function installNodeDeps() {
  progress.setStage(3, 'NODE DEPENDENCIES');
  progress.setStatus('Checking node-pty...');
  progress.setSubProgress(0.3);

  try {
    require('node-pty');
    progress.setStatus('node-pty already installed');
    progress.setSubProgress(1);
    return;
  } catch (e) {
    // Need to install
  }

  try {
    progress.setStatus('Installing node-pty...');
    progress.setSubStatus('for zero-I/O screen capture');
    execSync('npm install -g node-pty 2>/dev/null || npm install node-pty --save 2>/dev/null', {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000
    });
    progress.setStatus('node-pty installed');
    progress.setSubProgress(1);
  } catch (e) {
    progress.addWarning('node-pty failed - PTY will use fallback');
    progress.setSubProgress(1);
  }
}

// Download base model
async function downloadBaseModel() {
  progress.setStage(4, 'DOWNLOADING THE SHIT');
  progress.setStatus('Connecting to Hugging Face Hub...');
  progress.setSubStatus(MODEL_NAME);
  progress.setSubProgress(0.1);

  fs.mkdirSync(BASE_MODEL_DIR, { recursive: true });

  const downloadScript = `
import os
import sys
os.environ['HF_HOME'] = '${BASE_MODEL_DIR}'
os.environ['TRANSFORMERS_CACHE'] = '${BASE_MODEL_DIR}'

print("PROGRESS:20")
print("Connecting to Hugging Face Hub...")
from sentence_transformers import SentenceTransformer

print("PROGRESS:40")
print("Downloading model files...")
model = SentenceTransformer('${MODEL_NAME}')

print("PROGRESS:80")
print("Saving to local cache...")
model.save('${BASE_MODEL_DIR}/model')

print("PROGRESS:95")
test_embedding = model.encode("Test sentence")
print(f"Embedding dimension: {len(test_embedding)}")

print("PROGRESS:100")
print("Download complete!")
`;

  return new Promise((resolve, reject) => {
    const pythonPath = getPythonPath();
    const py = spawn(pythonPath, ['-c', downloadScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    py.stdout.on('data', (data) => {
      const text = data.toString();
      // Parse progress markers
      const progressMatch = text.match(/PROGRESS:(\d+)/);
      if (progressMatch) {
        progress.setSubProgress(parseInt(progressMatch[1]) / 100);
      }
      // Update status with meaningful lines
      const lines = text.split('\n').filter(l => l.trim() && !l.includes('PROGRESS:'));
      if (lines.length > 0) {
        progress.setStatus(lines[lines.length - 1].substring(0, 60));
      }
    });

    py.stderr.on('data', (data) => {
      const text = data.toString();
      if (!text.includes('WARNING') && !text.includes('FutureWarning')) {
        progress.setSubStatus(text.substring(0, 50).replace(/\n/g, ' '));
      }
    });

    py.on('close', (code) => {
      if (code === 0) {
        progress.setStatus('Model downloaded successfully!');
        progress.setSubProgress(1);
        resolve();
      } else {
        reject(new Error('Download failed'));
      }
    });
  });
}

// Optimize the model
async function optimizeModel() {
  progress.setStage(5, 'OPTIMIZING THE SHIT');
  progress.setStatus('Loading base model...');
  progress.setSubStatus('ONNX export + INT8 quantization');
  progress.setSubProgress(0.05);

  fs.mkdirSync(OPTIMIZED_DIR, { recursive: true });

  const optimizeScript = `
import os
import sys
import time
import json
from pathlib import Path

import warnings
warnings.filterwarnings('ignore')

OUTPUT_DIR = Path('${OPTIMIZED_DIR}')
MODEL_PATH = Path('${BASE_MODEL_DIR}/model')

print("PROGRESS:5")
print("Loading base model...")
from sentence_transformers import SentenceTransformer

if MODEL_PATH.exists():
    pytorch_model = SentenceTransformer(str(MODEL_PATH))
else:
    pytorch_model = SentenceTransformer('${MODEL_NAME}')

print("PROGRESS:15")
print("Model loaded - preparing benchmark...")

TEST_SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "Machine learning models can be optimized for CPU inference.",
    "SpecMem provides semantic memory for Claude Code.",
] * 20

# Benchmark PyTorch
print("PROGRESS:20")
print("Benchmarking PyTorch model...")
_ = pytorch_model.encode(TEST_SENTENCES[:5])
start = time.time()
pytorch_embeddings = pytorch_model.encode(TEST_SENTENCES)
pytorch_time = time.time() - start
pytorch_per_sentence = (pytorch_time / len(TEST_SENTENCES)) * 1000
print(f"PyTorch: {pytorch_per_sentence:.2f}ms per sentence")

print("PROGRESS:35")
print("Exporting to ONNX format...")
try:
    onnx_model = SentenceTransformer('${MODEL_NAME}', backend="onnx")
    onnx_model.save(str(OUTPUT_DIR / "onnx_model"))
    print("ONNX export completed")
except Exception as e:
    print(f"Using alternative export: {e}")
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from transformers import AutoTokenizer
    ort_model = ORTModelForFeatureExtraction.from_pretrained('${MODEL_NAME}', export=True)
    tokenizer = AutoTokenizer.from_pretrained('${MODEL_NAME}')
    ort_model.save_pretrained(str(OUTPUT_DIR / "onnx_model"))
    tokenizer.save_pretrained(str(OUTPUT_DIR / "onnx_model"))

print("PROGRESS:55")
print("INT8 Quantization (THE MAGIC!)...")
try:
    from sentence_transformers import export_dynamic_quantized_onnx_model
    onnx_model = SentenceTransformer('${MODEL_NAME}', backend="onnx")
    export_dynamic_quantized_onnx_model(
        model=onnx_model,
        quantization_config="avx512",
        model_name_or_path=str(OUTPUT_DIR / "quantized_model")
    )
except Exception as e:
    print(f"Using Optimum quantization: {e}")
    from optimum.onnxruntime import ORTQuantizer
    from optimum.onnxruntime.configuration import AutoQuantizationConfig
    quantizer = ORTQuantizer.from_pretrained(str(OUTPUT_DIR / "onnx_model"))
    qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=False)
    quantizer.quantize(save_dir=str(OUTPUT_DIR / "quantized_model"), quantization_config=qconfig)

print("PROGRESS:75")
print("Benchmarking optimized models...")

onnx_time = pytorch_time
onnx_per_sentence = pytorch_per_sentence
quantized_time = pytorch_time
quantized_per_sentence = pytorch_per_sentence

try:
    onnx_model = SentenceTransformer(str(OUTPUT_DIR / "onnx_model"), backend="onnx")
    _ = onnx_model.encode(TEST_SENTENCES[:5])
    start = time.time()
    onnx_model.encode(TEST_SENTENCES)
    onnx_time = time.time() - start
    onnx_per_sentence = (onnx_time / len(TEST_SENTENCES)) * 1000
    print(f"ONNX: {onnx_per_sentence:.2f}ms ({pytorch_time/onnx_time:.1f}x faster)")
except Exception as e:
    print(f"ONNX benchmark skipped: {e}")

print("PROGRESS:85")
try:
    quantized_model = SentenceTransformer(
        str(OUTPUT_DIR / "quantized_model"),
        backend="onnx",
        model_kwargs={"file_name": "model_quantized.onnx"}
    )
    _ = quantized_model.encode(TEST_SENTENCES[:5])
    start = time.time()
    quantized_model.encode(TEST_SENTENCES)
    quantized_time = time.time() - start
    quantized_per_sentence = (quantized_time / len(TEST_SENTENCES)) * 1000
    print(f"INT8: {quantized_per_sentence:.2f}ms ({pytorch_time/quantized_time:.1f}x faster)")
except Exception as e:
    print(f"Quantized benchmark skipped: {e}")

print("PROGRESS:95")
print("Saving manifest...")

def get_dir_size(path):
    total = 0
    for f in Path(path).rglob("*"):
        if f.is_file():
            total += f.stat().st_size
    return total

onnx_size = get_dir_size(OUTPUT_DIR / "onnx_model") if (OUTPUT_DIR / "onnx_model").exists() else 0
quant_size = get_dir_size(OUTPUT_DIR / "quantized_model") if (OUTPUT_DIR / "quantized_model").exists() else 0

manifest = {
    "version": "1.0.0",
    "model_name": "specmem-embedding-v1",
    "base_model": "${MODEL_NAME}",
    "optimizations": ["onnx", "int8_quantization"],
    "embedding_dim": 384,
    "max_seq_length": 256,
    "benchmark": {
        "pytorch_ms": round(pytorch_per_sentence, 2),
        "onnx_ms": round(onnx_per_sentence, 2),
        "quantized_ms": round(quantized_per_sentence, 2),
        "speedup": round(pytorch_time/quantized_time, 2) if quantized_time > 0 else 1.0
    },
    "files": {
        "onnx_model": "onnx_model/",
        "quantized_model": "quantized_model/"
    },
    "sizes": {
        "onnx_mb": round(onnx_size / 1024 / 1024, 2),
        "quantized_mb": round(quant_size / 1024 / 1024, 2)
    }
}

with open(OUTPUT_DIR / "manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

print("PROGRESS:100")
speedup = manifest["benchmark"]["speedup"]
print(f"COMPLETE! {speedup:.1f}x speedup achieved")
`;

  return new Promise((resolve, reject) => {
    const pythonPath = getPythonPath();
    const py = spawn(pythonPath, ['-c', optimizeScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    py.stdout.on('data', (data) => {
      const text = data.toString();
      const progressMatch = text.match(/PROGRESS:(\d+)/);
      if (progressMatch) {
        progress.setSubProgress(parseInt(progressMatch[1]) / 100);
      }
      const lines = text.split('\n').filter(l => l.trim() && !l.includes('PROGRESS:'));
      if (lines.length > 0) {
        progress.setStatus(lines[lines.length - 1].substring(0, 60));
      }
    });

    py.stderr.on('data', (data) => {
      const text = data.toString();
      if (!text.includes('WARNING') && !text.includes('FutureWarning') && !text.includes('UserWarning')) {
        const clean = text.substring(0, 50).replace(/\n/g, ' ').trim();
        if (clean) progress.setSubStatus(clean);
      }
    });

    py.on('close', (code) => {
      if (code === 0) {
        progress.setStatus('Optimization complete!');
        progress.setSubProgress(1);
        resolve();
      } else {
        progress.addWarning('Optimization had issues - using base model');
        progress.setSubProgress(1);
        resolve(); // Don't fail - continue with unoptimized
      }
    });
  });
}

// Show final summary
function showSummary() {
  const calledFromInit = process.env.SPECMEM_CALLED_FROM_INIT === '1';

  try {
    const manifestPath = path.join(OPTIMIZED_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    if (calledFromInit) {
      // Compact summary when called from init
      const speedup = manifest.benchmark?.speedup || 1;
      const latency = manifest.benchmark?.quantized_ms || '?';
      const size = manifest.sizes?.quantized_mb || '?';
      console.log(`\n${c.green}✓${c.reset} Model ready: ${c.cyan}${speedup}x${c.reset} speedup, ${c.yellow}${latency}ms${c.reset} latency, ${c.blue}${size}MB${c.reset}`);
    } else {
      // Full summary for standalone run
      const boxWidth = 60;
      const pad = (text, len) => text + ' '.repeat(Math.max(0, len - text.length));

      const modelText = manifest.base_model || 'all-MiniLM-L6-v2';
      const speedupText = `${manifest.benchmark?.speedup || 1}x faster`;
      const latencyText = `${manifest.benchmark?.quantized_ms || '?'}ms per embedding`;
      const sizeText = `${manifest.sizes?.quantized_mb || '?'}MB (quantized)`;

      console.log(`
${c.green}${c.bold}╔${'═'.repeat(boxWidth)}╗
║${' '.repeat(Math.floor((boxWidth - 28) / 2))}🚀 SPECMEM READY TO FLY! 🚀${' '.repeat(Math.ceil((boxWidth - 28) / 2))}║
╠${'═'.repeat(boxWidth)}╣
║${c.reset}  Model:   ${c.cyan}${pad(modelText, boxWidth - 13)}${c.green}${c.bold}║
║${c.reset}  Speedup: ${c.magenta}${pad(speedupText, boxWidth - 13)}${c.green}${c.bold}║
║${c.reset}  Latency: ${c.yellow}${pad(latencyText, boxWidth - 13)}${c.green}${c.bold}║
║${c.reset}  Size:    ${c.blue}${pad(sizeText, boxWidth - 13)}${c.green}${c.bold}║
╚${'═'.repeat(boxWidth)}╝${c.reset}
`);
      console.log(`${c.dim}Run 'specmem-init' to initialize your project!${c.reset}\n`);
    }
  } catch (e) {
    console.log(`\n${c.green}✓ Models ready!${c.reset}\n`);
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  progress = new ProgressUI();
  progress.start();

  // Check if already done
  if (modelsExist()) {
    progress.stop(true);
    console.log(`\n${c.green}✓ Optimized models already exist!${c.reset}`);
    showSummary();
    return;
  }

  // Stage 1: Check Python
  progress.setStage(1, 'CHECKING PYTHON');
  progress.setStatus('Verifying Python 3 installation...');
  progress.setSubProgress(0.5);

  if (!checkPython()) {
    progress.stop(false);
    console.log(`\n${c.red}✗ Python 3 is required but not found${c.reset}`);
    console.log(`  Install with: apt install python3 python3-pip`);
    process.exit(1);
  }

  progress.setStatus('Python 3 found');
  progress.setSubProgress(1);

  // Stage 2: Python deps
  installPythonDeps();

  // Stage 3: Node deps
  installNodeDeps();

  try {
    // Check for packed/bundled models — skip download+optimize if they exist
    const PACKED_MODEL_DIR = path.join(SPECMEM_PKG_DIR, 'embedding-sandbox', 'models', 'all-MiniLM-L6-v2');
    const PACKED_ONNX = path.join(PACKED_MODEL_DIR, 'onnx', 'model_quint8_avx2.onnx');

    if (fs.existsSync(PACKED_ONNX)) {
      // Internalized model found — no download needed
      progress.setStage(4, 'USING PACKED MODELS');
      progress.setStatus('Internalized model found — Hardwick Software Optimized');
      progress.setSubStatus('INT8 quantized ONNX — no download needed');
      progress.setSubProgress(1);

      progress.setStage(5, 'MODELS READY');
      progress.setStatus('Pre-optimized model verified');
      progress.setSubStatus(`${path.basename(PACKED_MODEL_DIR)} — INT8 AVX2`);
      progress.setSubProgress(1);

      console.log(`\n  ${c.green}✓${c.reset} ${c.bold}Packed models detected${c.reset} — skipping download`);
      console.log(`  ${c.dim}Powered by Hardwick Software Optimizations: INT8 ONNX quantization${c.reset}\n`);
    } else {
      // No packed model — download and optimize (fallback for dev/custom builds)
      // Stage 4: Download
      await downloadBaseModel();

      // Stage 5: Optimize
      try {
        await optimizeModel();
      } catch (optErr) {
        progress.addWarning('Optimization skipped - base model still works');
      }
    }

    progress.stop(true);

    // Show summary
    showSummary();

    // Create marker file
    const markerPath = path.join(SPECMEM_DIR, '.setup-complete');
    fs.writeFileSync(markerPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      model: MODEL_NAME,
      optimized: fs.existsSync(path.join(OPTIMIZED_DIR, 'quantized_model'))
    }));

  } catch (e) {
    progress.stop(false);
    console.log(`\n${c.red}Setup failed: ${e.message}${c.reset}`);
    console.log(`${c.dim}Try running with: DEBUG=1 specmem setup${c.reset}`);
    process.exit(1);
  }
}

// Handle signals
process.on('SIGINT', () => {
  if (progress) progress.stop(false);
  process.stdout.write(c.showCursor);
  process.exit(1);
});

process.on('SIGTERM', () => {
  if (progress) progress.stop(false);
  process.stdout.write(c.showCursor);
  process.exit(1);
});

// Run
main().catch(e => {
  if (progress) progress.stop(false);
  process.stdout.write(c.showCursor);
  console.error(`${c.red}Error: ${e.message}${c.reset}`);
  process.exit(1);
});
