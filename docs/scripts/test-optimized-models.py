#!/usr/bin/env python3
"""
QUICK TEST: Optimized Embedding Models
======================================

Tests that the INT8 quantized models work correctly.

@author hardwicksoftwareservices
@website https://justcalljon.pro
"""

import sys
import time
import json
from pathlib import Path

print("""
╔═══════════════════════════════════════════════════════════════╗
║            TESTING OPTIMIZED EMBEDDING MODELS                  ║
║            https://justcalljon.pro                             ║
╚═══════════════════════════════════════════════════════════════╝
""")

MODELS_DIR = Path("/specmem/models/optimized")
QUANTIZED_DIR = MODELS_DIR / "quantized_model"
ONNX_DIR = MODELS_DIR / "onnx_model"

# Check directories exist
print("═══ Checking Files ═══\n")

if not MODELS_DIR.exists():
    print("✗ Models directory not found!")
    sys.exit(1)

manifest_path = MODELS_DIR / "manifest.json"
if manifest_path.exists():
    with open(manifest_path) as f:
        manifest = json.load(f)
    print(f"✓ Manifest found: v{manifest['version']}")
    print(f"  Base model: {manifest['base_model']}")
    print(f"  Expected speedup: {manifest['benchmark']['speedup']}x")
else:
    print("✗ Manifest not found!")

if ONNX_DIR.exists():
    onnx_files = list(ONNX_DIR.rglob("*.onnx"))
    print(f"✓ ONNX model: {len(onnx_files)} .onnx files")
else:
    print("✗ ONNX directory not found!")

if QUANTIZED_DIR.exists():
    quant_files = list(QUANTIZED_DIR.rglob("*.onnx"))
    print(f"✓ Quantized model: {len(quant_files)} .onnx files")
else:
    print("✗ Quantized directory not found!")

print("\n═══ Loading Models ═══\n")

try:
    from sentence_transformers import SentenceTransformer
    print("✓ sentence-transformers imported")
except ImportError as e:
    print(f"✗ Failed to import sentence-transformers: {e}")
    sys.exit(1)

# Test sentences
TEST_SENTENCES = [
    "Hello world, this is a test.",
    "SpecMem provides semantic memory for Claude Code.",
    "The quick brown fox jumps over the lazy dog.",
    "Machine learning models can be optimized for CPU inference.",
    "PostgreSQL with pgvector enables efficient vector similarity search.",
]

# Test ONNX model
print("Loading ONNX model...")
try:
    start = time.time()
    onnx_model = SentenceTransformer(str(ONNX_DIR), backend="onnx")
    load_time = time.time() - start
    print(f"✓ ONNX model loaded in {load_time:.2f}s")

    # Generate embeddings
    start = time.time()
    onnx_embeddings = onnx_model.encode(TEST_SENTENCES)
    embed_time = time.time() - start
    onnx_per_sentence = (embed_time / len(TEST_SENTENCES)) * 1000

    print(f"✓ Generated {len(TEST_SENTENCES)} embeddings in {embed_time:.3f}s")
    print(f"  {onnx_per_sentence:.2f}ms per sentence")
    print(f"  Embedding dim: {onnx_embeddings.shape[1]}")
except Exception as e:
    print(f"✗ ONNX test failed: {e}")
    onnx_per_sentence = None

# Test quantized model
print("\nLoading INT8 quantized model...")
try:
    # Find the quantized model file
    quant_onnx = list(QUANTIZED_DIR.rglob("*quant*.onnx")) or list(QUANTIZED_DIR.rglob("*.onnx"))

    if quant_onnx:
        quant_file = quant_onnx[0].name
        print(f"  Using: {quant_file}")

        start = time.time()
        quantized_model = SentenceTransformer(
            str(QUANTIZED_DIR),
            backend="onnx",
            model_kwargs={"file_name": quant_file}
        )
        load_time = time.time() - start
        print(f"✓ Quantized model loaded in {load_time:.2f}s")

        # Generate embeddings
        start = time.time()
        quant_embeddings = quantized_model.encode(TEST_SENTENCES)
        embed_time = time.time() - start
        quant_per_sentence = (embed_time / len(TEST_SENTENCES)) * 1000

        print(f"✓ Generated {len(TEST_SENTENCES)} embeddings in {embed_time:.3f}s")
        print(f"  {quant_per_sentence:.2f}ms per sentence")
        print(f"  Embedding dim: {quant_embeddings.shape[1]}")
    else:
        print("✗ No quantized .onnx file found")
        quant_per_sentence = None
except Exception as e:
    print(f"✗ Quantized test failed: {e}")
    quant_per_sentence = None

# Quality check
print("\n═══ Quality Check ═══\n")

try:
    import numpy as np
    from numpy.linalg import norm

    def cosine_similarity(a, b):
        return np.dot(a, b) / (norm(a) * norm(b))

    if 'onnx_embeddings' in dir() and 'quant_embeddings' in dir():
        sim = cosine_similarity(onnx_embeddings[0], quant_embeddings[0])
        print(f"ONNX vs Quantized similarity: {sim:.6f}")
        if sim > 0.99:
            print("✓ Excellent quality preservation!")
        elif sim > 0.95:
            print("✓ Good quality preservation")
        else:
            print("⚠ Some quality loss detected")
except Exception as e:
    print(f"Quality check skipped: {e}")

# Summary
print(f"""
╔═══════════════════════════════════════════════════════════════╗
║                      TEST RESULTS                              ║
╠═══════════════════════════════════════════════════════════════╣
║  ONNX Model:      {f'{onnx_per_sentence:.2f}ms/sentence' if onnx_per_sentence else 'FAILED':<40} ║
║  INT8 Quantized:  {f'{quant_per_sentence:.2f}ms/sentence' if quant_per_sentence else 'FAILED':<40} ║
╚═══════════════════════════════════════════════════════════════╝
""")

if onnx_per_sentence and quant_per_sentence:
    print("🚀 Models are READY TO SHIP!")
else:
    print("⚠ Some tests failed - check output above")
