#!/usr/bin/env node
/**
 * SPECMEM FIRST-RUN MODEL SETUP
 * ==============================
 *
 * Downloads base embedding model, then optimizes it locally.
 * THE FLEX: "Downloading the shit... Now optimizing the shit..."
 *
 * @author hardwicksoftwareservices
 * @website https://justcalljon.pro
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

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

// ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_GREEN = '\x1b[42m';
const BG_BLUE = '\x1b[44m';
const BG_MAGENTA = '\x1b[45m';

// Config
const MODEL_NAME = 'sentence-transformers/all-MiniLM-L6-v2';
const SPECMEM_DIR = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(SPECMEM_DIR, 'models');
const OPTIMIZED_DIR = path.join(MODELS_DIR, 'optimized');
const BASE_MODEL_DIR = path.join(MODELS_DIR, 'base');

// ============================================================================
// DIRECTORY CHECK - Warn if running from home/system directory
// ============================================================================
function checkProjectDirectory() {
  const cwd = process.cwd();
  const homeDir = require('os').homedir();
  const badDirs = [homeDir, '/', '/root', '/home', '/usr', '/var', '/tmp', '/etc', '/opt'];

  if (badDirs.some(bad => cwd === bad || cwd === bad + '/')) {
    console.log(`
${YELLOW}${BOLD}╔════════════════════════════════════════════════════════════════╗
║  ⚠ WARNING: Running from system/home directory!               ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Current: ${cwd.substring(0, 50).padEnd(50)}  ║
║                                                                ║
║  SpecMem setup should run from a PROJECT directory.            ║
║  cd into your project first, then run specmem setup.          ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝${RESET}
`);
    console.log(`${DIM}Continuing anyway...${RESET}\n`);
  }
}

// ASCII art banner
function showBanner() {
  console.log(`
${CYAN}${BOLD}╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║   ${WHITE}███████╗██████╗ ███████╗ ██████╗███╗   ███╗███████╗███╗   ███╗${CYAN}              ║
║   ${WHITE}██╔════╝██╔══██╗██╔════╝██╔════╝████╗ ████║██╔════╝████╗ ████║${CYAN}              ║
║   ${WHITE}███████╗██████╔╝█████╗  ██║     ██╔████╔██║█████╗  ██╔████╔██║${CYAN}              ║
║   ${WHITE}╚════██║██╔═══╝ ██╔══╝  ██║     ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║${CYAN}              ║
║   ${WHITE}███████║██║     ███████╗╚██████╗██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║${CYAN}              ║
║   ${WHITE}╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝${CYAN}              ║
║                                                                               ║
║   ${MAGENTA}FIRST-RUN MODEL SETUP${CYAN}                                                      ║
║   ${DIM}https://justcalljon.pro${RESET}${CYAN}${BOLD}                                                    ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝${RESET}
`);
}

// Animated spinner
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIndex = 0;
let spinnerInterval = null;

function startSpinner(message) {
  process.stdout.write('\n');
  spinnerInterval = setInterval(() => {
    process.stdout.write(`\r${CYAN}${spinnerFrames[spinnerIndex]}${RESET} ${message}`);
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
  }, 80);
}

function stopSpinner(success = true, message = '') {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    const icon = success ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    process.stdout.write(`\r${icon} ${message}\n`);
  }
}

// Progress bar
function progressBar(current, total, width = 40) {
  const percent = current / total;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${CYAN}[${bar}]${RESET} ${(percent * 100).toFixed(1)}%`;
}

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

// Install Python dependencies
function installPythonDeps() {
  console.log(`\n${YELLOW}${BOLD}═══ Installing Python Dependencies ═══${RESET}\n`);

  // First, ensure pip is installed
  console.log(`${DIM}Checking for pip...${RESET}`);
  try {
    execSync('pip3 --version', { stdio: 'pipe' });
    console.log(`${GREEN}✓${RESET} pip3 found`);
  } catch (e) {
    console.log(`${YELLOW}pip3 not found - installing...${RESET}`);
    try {
      // Try to install pip based on OS
      if (process.platform === 'linux') {
        try {
          execSync('apt-get update -qq && apt-get install -y python3-pip python3-venv', {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 120000
          });
          console.log(`${GREEN}✓${RESET} pip3 installed via apt`);
        } catch (aptErr) {
          try {
            execSync('dnf install -y python3-pip || yum install -y python3-pip', {
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 120000
            });
            console.log(`${GREEN}✓${RESET} pip3 installed via dnf/yum`);
          } catch (dnfErr) {
            console.log(`${RED}✗${RESET} Could not install pip3 - try: sudo apt install python3-pip`);
            console.log(`${YELLOW}Skipping Python deps - SpecMem will use fallback embeddings${RESET}`);
            return;
          }
        }
      } else if (process.platform === 'darwin') {
        try {
          execSync('brew install python3', { stdio: 'pipe', timeout: 120000 });
          console.log(`${GREEN}✓${RESET} Python3 (with pip) installed via brew`);
        } catch (brewErr) {
          console.log(`${RED}✗${RESET} Could not install pip3 - try: brew install python3`);
          return;
        }
      }
    } catch (installErr) {
      console.log(`${RED}✗${RESET} pip3 installation failed`);
      console.log(`${YELLOW}Skipping Python deps - SpecMem will use fallback embeddings${RESET}`);
      return;
    }
  }

  const deps = [
    'torch --index-url https://download.pytorch.org/whl/cpu',
    'sentence-transformers[onnx]',
    'onnx',
    'onnxruntime',
    'optimum[onnxruntime]',
    'optimum'
  ];

  for (const dep of deps) {
    try {
      console.log(`${DIM}Installing ${dep.split(' ')[0]}...${RESET}`);
      execSync(`pip3 install ${dep} --break-system-packages -q 2>/dev/null || pip install ${dep} --break-system-packages -q 2>/dev/null || pip3 install ${dep} -q 2>/dev/null || pip install ${dep} -q 2>/dev/null`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 600000 // 10 min timeout for large packages like torch/optimum
      });
      console.log(`${GREEN}✓${RESET} ${dep.split(' ')[0]} installed`);
    } catch (e) {
      console.log(`${YELLOW}⚠${RESET} ${dep.split(' ')[0]} may already be installed or failed`);
    }
  }
}

// Install Node.js dependencies (node-pty for PTY-based screen capture)
function installNodeDeps() {
  console.log(`\n${YELLOW}${BOLD}═══ Installing Node.js Dependencies ═══${RESET}\n`);

  // Check if node-pty is already available
  try {
    require('node-pty');
    console.log(`${GREEN}✓${RESET} node-pty already installed`);
    return;
  } catch (e) {
    // Need to install
  }

  try {
    console.log(`${DIM}Installing node-pty (for zero-I/O screen capture)...${RESET}`);
    // Install globally so all projects can use it
    execSync('npm install -g node-pty 2>/dev/null || npm install node-pty --save 2>/dev/null', {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000
    });
    console.log(`${GREEN}✓${RESET} node-pty installed`);
  } catch (e) {
    console.log(`${YELLOW}⚠${RESET} node-pty installation failed - PTY capture will use fallback`);
    console.log(`${DIM}  To install manually: npm install node-pty${RESET}`);
  }
}

// Download base model
async function downloadBaseModel() {
  console.log(`\n${MAGENTA}${BOLD}╔═══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${MAGENTA}${BOLD}║     🔥 DOWNLOADING THE SHIT... 🔥                              ║${RESET}`);
  console.log(`${MAGENTA}${BOLD}╚═══════════════════════════════════════════════════════════════╝${RESET}\n`);

  console.log(`${CYAN}Model:${RESET} ${MODEL_NAME}`);
  console.log(`${CYAN}Source:${RESET} Hugging Face Hub\n`);

  // Create base model directory
  fs.mkdirSync(BASE_MODEL_DIR, { recursive: true });

  // Use sentence-transformers to download the model
  const downloadScript = `
import os
import sys
os.environ['HF_HOME'] = '${BASE_MODEL_DIR}'
os.environ['TRANSFORMERS_CACHE'] = '${BASE_MODEL_DIR}'

print("Connecting to Hugging Face Hub...")
from sentence_transformers import SentenceTransformer

print("Downloading model files...")
model = SentenceTransformer('${MODEL_NAME}')

print("Saving to local cache...")
model.save('${BASE_MODEL_DIR}/model')

print("\\n✓ Base model downloaded successfully!")
print(f"  Location: ${BASE_MODEL_DIR}/model")

# Quick test
test_embedding = model.encode("Test sentence")
print(f"  Embedding dimension: {len(test_embedding)}")
`;

  return new Promise((resolve, reject) => {
    // Task #22 fix: Use getPythonPath() instead of hardcoded 'python3'
    const pythonPath = getPythonPath();
    const py = spawn(pythonPath, ['-c', downloadScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let error = '';

    py.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(`${DIM}${text}${RESET}`);
    });

    py.stderr.on('data', (data) => {
      const text = data.toString();
      error += text;
      // Filter out warnings
      if (!text.includes('WARNING') && !text.includes('FutureWarning')) {
        process.stdout.write(`${DIM}${text}${RESET}`);
      }
    });

    py.on('close', (code) => {
      if (code === 0) {
        console.log(`\n${GREEN}${BOLD}✓ Download complete!${RESET}\n`);
        resolve();
      } else {
        console.log(`\n${RED}Download failed: ${error}${RESET}`);
        reject(new Error('Download failed'));
      }
    });
  });
}

// Optimize the model
async function optimizeModel() {
  console.log(`\n${BLUE}${BOLD}╔═══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BLUE}${BOLD}║     ⚡ NOW OPTIMIZING THE SHIT... ⚡                           ║${RESET}`);
  console.log(`${BLUE}${BOLD}╚═══════════════════════════════════════════════════════════════╝${RESET}\n`);

  console.log(`${CYAN}Optimizations:${RESET}`);
  console.log(`  • ONNX export (cross-platform)`);
  console.log(`  • INT8 quantization (2-4x faster)`);
  console.log(`  • CPU-optimized kernels\n`);

  // Create optimized directory
  fs.mkdirSync(OPTIMIZED_DIR, { recursive: true });

  const optimizeScript = `
import os
import sys
import time
import json
from pathlib import Path

# Suppress warnings
import warnings
warnings.filterwarnings('ignore')

OUTPUT_DIR = Path('${OPTIMIZED_DIR}')
MODEL_PATH = Path('${BASE_MODEL_DIR}/model')

print("═══ Loading Base Model ═══")
from sentence_transformers import SentenceTransformer

# Try loading from local cache first
if MODEL_PATH.exists():
    print(f"Loading from local cache: {MODEL_PATH}")
    pytorch_model = SentenceTransformer(str(MODEL_PATH))
else:
    print(f"Loading from Hugging Face: ${MODEL_NAME}")
    pytorch_model = SentenceTransformer('${MODEL_NAME}')

print("✓ Model loaded\\n")

# Benchmark sentences
TEST_SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "Machine learning models can be optimized for CPU inference.",
    "SpecMem provides semantic memory for  Code.",
    "Quantization reduces model size and increases inference speed.",
    "PostgreSQL with pgvector enables efficient vector similarity search.",
] * 20  # 100 sentences

print("═══ Benchmarking PyTorch Model ═══")
# Warm up
_ = pytorch_model.encode(TEST_SENTENCES[:5])

# Benchmark
start = time.time()
pytorch_embeddings = pytorch_model.encode(TEST_SENTENCES)
pytorch_time = time.time() - start
pytorch_per_sentence = (pytorch_time / len(TEST_SENTENCES)) * 1000
print(f"PyTorch: {pytorch_per_sentence:.2f}ms per sentence\\n")

print("═══ Exporting to ONNX ═══")
start = time.time()
try:
    onnx_model = SentenceTransformer('${MODEL_NAME}', backend="onnx")
    onnx_model.save(str(OUTPUT_DIR / "onnx_model"))
    export_time = time.time() - start
    print(f"✓ ONNX export completed in {export_time:.2f}s\\n")
except Exception as e:
    print(f"Using alternative export: {e}")
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from transformers import AutoTokenizer
    ort_model = ORTModelForFeatureExtraction.from_pretrained('${MODEL_NAME}', export=True)
    tokenizer = AutoTokenizer.from_pretrained('${MODEL_NAME}')
    ort_model.save_pretrained(str(OUTPUT_DIR / "onnx_model"))
    tokenizer.save_pretrained(str(OUTPUT_DIR / "onnx_model"))
    print(f"✓ ONNX export (via Optimum) completed\\n")

print("═══ INT8 Quantization (THE MAGIC!) ═══")
try:
    from sentence_transformers import export_dynamic_quantized_onnx_model
    onnx_model = SentenceTransformer('${MODEL_NAME}', backend="onnx")
    export_dynamic_quantized_onnx_model(
        model=onnx_model,
        quantization_config="avx512",
        model_name_or_path=str(OUTPUT_DIR / "quantized_model")
    )
    print("✓ INT8 quantization completed\\n")
except Exception as e:
    print(f"Using Optimum quantization: {e}")
    from optimum.onnxruntime import ORTQuantizer
    from optimum.onnxruntime.configuration import AutoQuantizationConfig
    quantizer = ORTQuantizer.from_pretrained(str(OUTPUT_DIR / "onnx_model"))
    qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=False)
    quantizer.quantize(save_dir=str(OUTPUT_DIR / "quantized_model"), quantization_config=qconfig)
    print("✓ INT8 quantization (via Optimum) completed\\n")

print("═══ Benchmarking Optimized Models ═══")

# Benchmark ONNX
try:
    onnx_model = SentenceTransformer(str(OUTPUT_DIR / "onnx_model"), backend="onnx")
    _ = onnx_model.encode(TEST_SENTENCES[:5])
    start = time.time()
    onnx_embeddings = onnx_model.encode(TEST_SENTENCES)
    onnx_time = time.time() - start
    onnx_per_sentence = (onnx_time / len(TEST_SENTENCES)) * 1000
    print(f"ONNX: {onnx_per_sentence:.2f}ms per sentence ({pytorch_time/onnx_time:.1f}x faster)")
except Exception as e:
    print(f"ONNX benchmark skipped: {e}")
    onnx_time = pytorch_time
    onnx_per_sentence = pytorch_per_sentence

# Benchmark quantized
try:
    quantized_model = SentenceTransformer(
        str(OUTPUT_DIR / "quantized_model"),
        backend="onnx",
        model_kwargs={"file_name": "model_quantized.onnx"}
    )
    _ = quantized_model.encode(TEST_SENTENCES[:5])
    start = time.time()
    quantized_embeddings = quantized_model.encode(TEST_SENTENCES)
    quantized_time = time.time() - start
    quantized_per_sentence = (quantized_time / len(TEST_SENTENCES)) * 1000
    print(f"INT8: {quantized_per_sentence:.2f}ms per sentence ({pytorch_time/quantized_time:.1f}x faster)")
except Exception as e:
    print(f"Quantized benchmark skipped: {e}")
    quantized_time = onnx_time
    quantized_per_sentence = onnx_per_sentence

# Calculate sizes
def get_dir_size(path):
    total = 0
    for f in Path(path).rglob("*"):
        if f.is_file():
            total += f.stat().st_size
    return total

onnx_size = get_dir_size(OUTPUT_DIR / "onnx_model") if (OUTPUT_DIR / "onnx_model").exists() else 0
quant_size = get_dir_size(OUTPUT_DIR / "quantized_model") if (OUTPUT_DIR / "quantized_model").exists() else 0

# Save manifest
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
        "speedup": round(pytorch_time/quantized_time, 2)
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

# Print summary
speedup = pytorch_time/quantized_time
size_reduction = (1 - quant_size/onnx_size) * 100 if onnx_size > 0 else 0

print(f"""
╔═══════════════════════════════════════════════════════════════╗
║                    🎉 OPTIMIZATION COMPLETE! 🎉                ║
╠═══════════════════════════════════════════════════════════════╣
║  SPEEDUP: {speedup:.1f}x faster                                        ║
║  SIZE:    {size_reduction:.0f}% smaller                                         ║
║  OUTPUT:  {str(OUTPUT_DIR):<50} ║
╚═══════════════════════════════════════════════════════════════╝
""")
`;

  return new Promise((resolve, reject) => {
    // Task #22 fix: Use getPythonPath() instead of hardcoded 'python3'
    const pythonPath = getPythonPath();
    const py = spawn(pythonPath, ['-c', optimizeScript], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let error = '';

    py.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    py.stderr.on('data', (data) => {
      const text = data.toString();
      error += text;
      // Filter out noisy warnings
      if (!text.includes('WARNING') && !text.includes('FutureWarning') && !text.includes('UserWarning')) {
        process.stdout.write(`${DIM}${text}${RESET}`);
      }
    });

    py.on('close', (code) => {
      if (code === 0) {
        console.log(`${GREEN}${BOLD}✓ Optimization complete!${RESET}\n`);
        resolve();
      } else {
        console.log(`${YELLOW}⚠ Optimization had issues but base model is ready${RESET}`);
        console.log(`${DIM}SpecMem will use PyTorch model (still fast!)${RESET}`);
        // Don't fail - continue with unoptimized model
        resolve();
      }
    });
  });
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

// Show final summary
function showSummary() {
  try {
    const manifestPath = path.join(OPTIMIZED_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    console.log(`\n${GREEN}${BOLD}╔═══════════════════════════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${GREEN}${BOLD}║                         🚀 SPECMEM READY TO FLY! 🚀                           ║${RESET}`);
    console.log(`${GREEN}${BOLD}╠═══════════════════════════════════════════════════════════════════════════════╣${RESET}`);
    console.log(`${GREEN}${BOLD}║${RESET}  Model: ${CYAN}${manifest.base_model}${RESET}${' '.repeat(42)}${GREEN}${BOLD}║${RESET}`);
    console.log(`${GREEN}${BOLD}║${RESET}  Speedup: ${MAGENTA}${manifest.benchmark.speedup}x faster${RESET}${' '.repeat(50)}${GREEN}${BOLD}║${RESET}`);
    console.log(`${GREEN}${BOLD}║${RESET}  Latency: ${YELLOW}${manifest.benchmark.quantized_ms}ms${RESET} per embedding${' '.repeat(41)}${GREEN}${BOLD}║${RESET}`);
    console.log(`${GREEN}${BOLD}║${RESET}  Size: ${BLUE}${manifest.sizes?.quantized_mb || '~22'}MB${RESET} (quantized)${' '.repeat(42)}${GREEN}${BOLD}║${RESET}`);
    console.log(`${GREEN}${BOLD}╚═══════════════════════════════════════════════════════════════════════════════╝${RESET}`);
    console.log(`\n${DIM}Run 'specmem start' to launch the server!${RESET}\n`);
  } catch (e) {
    console.log(`\n${GREEN}✓ Models optimized and ready!${RESET}\n`);
  }
}

// Main
async function main() {
  showBanner();
  checkProjectDirectory();

  // Check if already done
  if (modelsExist()) {
    console.log(`${GREEN}✓ Optimized models already exist!${RESET}`);
    showSummary();
    return;
  }

  // Check Python
  if (!checkPython()) {
    console.log(`${RED}✗ Python 3 is required but not found${RESET}`);
    console.log(`  Install with: apt install python3 python3-pip`);
    process.exit(1);
  }

  console.log(`${GREEN}✓ Python 3 found${RESET}\n`);

  // Install deps
  installPythonDeps();
  installNodeDeps();

  try {
    // Download base model
    await downloadBaseModel();

    // Optimize it (non-fatal if fails)
    try {
      await optimizeModel();
    } catch (optErr) {
      console.log(`\n${YELLOW}⚠ Optimization skipped - using base PyTorch model${RESET}`);
      console.log(`${DIM}This is fine! Base model still works great.${RESET}\n`);
    }

    // Show summary
    showSummary();

    // Create marker file so init knows setup completed
    const markerPath = path.join(SPECMEM_DIR, '.setup-complete');
    fs.writeFileSync(markerPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      model: MODEL_NAME,
      optimized: fs.existsSync(path.join(OPTIMIZED_DIR, 'quantized_model'))
    }));

    // ========== Configure MCP in Claude Code global config ==========
    // This ensures Claude Code can find SpecMem MCP even before init runs
    const claudeConfigPath = path.join(os.homedir(), '.claude', 'config.json');
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    try {
      // Ensure .claude directory exists
      fs.mkdirSync(path.join(os.homedir(), '.claude'), { recursive: true });

      // Configure MCP in config.json (global level)
      let config = {};
      if (fs.existsSync(claudeConfigPath)) {
        config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf8'));
      }
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers.specmem = {
        command: "node",
        args: ["--max-old-space-size=250", path.join(SPECMEM_PKG, 'bootstrap.cjs')],
        env: {
          HOME: os.homedir(),
          SPECMEM_PROJECT_PATH: "${PWD}",
          SPECMEM_DB_HOST: "localhost",
          SPECMEM_DB_PORT: "5432",
          SPECMEM_DB_NAME: "specmem_westayunprofessional",
          SPECMEM_DB_USER: "specmem_westayunprofessional",
          SPECMEM_DB_PASSWORD: "specmem_westayunprofessional"
        }
      };
      fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));

      // Also add to settings.json
      let settings = {};
      if (fs.existsSync(claudeSettingsPath)) {
        settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
      }
      if (!settings.mcpServers) settings.mcpServers = {};
      settings.mcpServers.specmem = config.mcpServers.specmem;
      fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2));

      console.log(`${GREEN}✓ MCP configured in Claude Code${RESET}`);
    } catch (e) {
      console.log(`${DIM}⚠ Could not configure MCP: ${e.message}${RESET}`);
    }

    console.log(`${GREEN}${BOLD}✓ Setup complete! Run 'specmem init' in your project.${RESET}\n`);

  } catch (e) {
    console.log(`\n${RED}${BOLD}Setup failed: ${e.message}${RESET}`);
    console.log(`${DIM}Try: pip3 install torch sentence-transformers${RESET}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, modelsExist, downloadBaseModel, optimizeModel };
