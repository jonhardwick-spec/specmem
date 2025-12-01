#!/usr/bin/env python3
"""
SPECMEM EMBEDDING MODEL OPTIMIZER
=================================

Optimizes the embedding model for CPU inference WITHOUT GPU!
- ONNX export
- INT8 quantization (2-4x speedup)
- Benchmark before/after

Run on server with 32GB RAM - NO GPU NEEDED!

@author hardwicksoftwareservices
@website https://justcalljon.pro
"""

import os
import sys
import time
import json
import hashlib
from pathlib import Path

print("""
╔═══════════════════════════════════════════════════════════════╗
║   SPECMEM EMBEDDING MODEL OPTIMIZER                           ║
║   CPU-Only Optimization (No GPU Required!)                    ║
║   https://justcalljon.pro                                     ║
╚═══════════════════════════════════════════════════════════════╝
""")

# Output directory
OUTPUT_DIR = Path("/specmem/models/optimized")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Check dependencies
print("═══ Checking Dependencies ═══\n")

try:
    import torch
    print(f"✓ PyTorch {torch.__version__}")
except ImportError:
    print("✗ PyTorch not found - installing...")
    os.system("pip install torch --index-url https://download.pytorch.org/whl/cpu")
    import torch

try:
    from sentence_transformers import SentenceTransformer
    print(f"✓ sentence-transformers installed")
except ImportError:
    print("✗ sentence-transformers not found - installing...")
    os.system("pip install sentence-transformers[onnx]")
    from sentence_transformers import SentenceTransformer

try:
    import onnx
    print(f"✓ ONNX {onnx.__version__}")
except ImportError:
    print("✗ ONNX not found - installing...")
    os.system("pip install onnx onnxruntime")
    import onnx

try:
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from optimum.onnxruntime.configuration import AutoQuantizationConfig
    from optimum.onnxruntime import ORTQuantizer
    print(f"✓ Hugging Face Optimum installed")
except ImportError:
    print("✗ Optimum not found - installing...")
    os.system("pip install optimum[onnxruntime]")
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from optimum.onnxruntime.configuration import AutoQuantizationConfig
    from optimum.onnxruntime import ORTQuantizer

import numpy as np

# Model to optimize
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

print(f"\n═══ Loading Base Model ═══\n")
print(f"Model: {MODEL_NAME}")

# Load the base PyTorch model for benchmarking
print("Loading PyTorch model...")
start = time.time()
pytorch_model = SentenceTransformer(MODEL_NAME)
pytorch_load_time = time.time() - start
print(f"✓ PyTorch model loaded in {pytorch_load_time:.2f}s")

# Test sentences for benchmarking
TEST_SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "Machine learning models can be optimized for CPU inference.",
    "SpecMem provides semantic memory for Claude Code.",
    "Quantization reduces model size and increases inference speed.",
    "PostgreSQL with pgvector enables efficient vector similarity search.",
] * 20  # 100 sentences total

print(f"\n═══ Benchmarking PyTorch Model ═══\n")
print(f"Running {len(TEST_SENTENCES)} embeddings...")

# Warm up
_ = pytorch_model.encode(TEST_SENTENCES[:5])

# Benchmark PyTorch
start = time.time()
pytorch_embeddings = pytorch_model.encode(TEST_SENTENCES)
pytorch_time = time.time() - start
pytorch_per_sentence = (pytorch_time / len(TEST_SENTENCES)) * 1000

print(f"✓ PyTorch: {pytorch_time:.3f}s total, {pytorch_per_sentence:.2f}ms per sentence")

# Get model size
pytorch_size = sum(p.numel() * p.element_size() for p in pytorch_model[0].auto_model.parameters())
print(f"  Model size: {pytorch_size / 1024 / 1024:.2f} MB")

print(f"\n═══ Exporting to ONNX ═══\n")

onnx_path = OUTPUT_DIR / "model.onnx"
onnx_quantized_path = OUTPUT_DIR / "model_quantized.onnx"

# Export to ONNX using sentence-transformers
print("Exporting to ONNX format...")
start = time.time()

try:
    # Try using sentence-transformers ONNX backend
    onnx_model = SentenceTransformer(MODEL_NAME, backend="onnx")

    # Save the ONNX model
    onnx_model.save(str(OUTPUT_DIR / "onnx_model"))
    export_time = time.time() - start
    print(f"✓ ONNX export completed in {export_time:.2f}s")
except Exception as e:
    print(f"  Using alternative export method: {e}")
    # Alternative: use optimum
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from transformers import AutoTokenizer

    ort_model = ORTModelForFeatureExtraction.from_pretrained(MODEL_NAME, export=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

    ort_model.save_pretrained(str(OUTPUT_DIR / "onnx_model"))
    tokenizer.save_pretrained(str(OUTPUT_DIR / "onnx_model"))
    export_time = time.time() - start
    print(f"✓ ONNX export (via Optimum) completed in {export_time:.2f}s")

print(f"\n═══ Quantizing to INT8 ═══\n")
print("This is where the MAGIC happens - 2-4x speedup!")

try:
    # Try sentence-transformers quantization
    from sentence_transformers import export_dynamic_quantized_onnx_model

    print("Using sentence-transformers quantization...")
    start = time.time()

    # Reload as ONNX model
    onnx_model = SentenceTransformer(MODEL_NAME, backend="onnx")

    # Export quantized version
    export_dynamic_quantized_onnx_model(
        model=onnx_model,
        quantization_config="avx512",  # Use AVX512 for modern CPUs
        model_name_or_path=str(OUTPUT_DIR / "quantized_model")
    )

    quant_time = time.time() - start
    print(f"✓ INT8 quantization completed in {quant_time:.2f}s")

except Exception as e:
    print(f"  Using Optimum quantization: {e}")

    from optimum.onnxruntime import ORTQuantizer
    from optimum.onnxruntime.configuration import AutoQuantizationConfig

    # Load the ONNX model
    quantizer = ORTQuantizer.from_pretrained(str(OUTPUT_DIR / "onnx_model"))

    # Configure quantization
    qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=False)

    # Quantize
    start = time.time()
    quantizer.quantize(
        save_dir=str(OUTPUT_DIR / "quantized_model"),
        quantization_config=qconfig,
    )
    quant_time = time.time() - start
    print(f"✓ INT8 quantization (via Optimum) completed in {quant_time:.2f}s")

print(f"\n═══ Benchmarking Optimized Models ═══\n")

# Benchmark ONNX model
print("Loading ONNX model...")
try:
    onnx_model = SentenceTransformer(str(OUTPUT_DIR / "onnx_model"), backend="onnx")

    # Warm up
    _ = onnx_model.encode(TEST_SENTENCES[:5])

    # Benchmark
    start = time.time()
    onnx_embeddings = onnx_model.encode(TEST_SENTENCES)
    onnx_time = time.time() - start
    onnx_per_sentence = (onnx_time / len(TEST_SENTENCES)) * 1000

    print(f"✓ ONNX: {onnx_time:.3f}s total, {onnx_per_sentence:.2f}ms per sentence")
    print(f"  Speedup vs PyTorch: {pytorch_time/onnx_time:.2f}x")
except Exception as e:
    print(f"  ONNX benchmark failed: {e}")
    onnx_time = pytorch_time
    onnx_per_sentence = pytorch_per_sentence

# Benchmark quantized model
print("\nLoading INT8 quantized model...")
try:
    # Find the quantized model file
    quant_model_path = OUTPUT_DIR / "quantized_model"

    quantized_model = SentenceTransformer(
        str(quant_model_path),
        backend="onnx",
        model_kwargs={"file_name": "model_quantized.onnx"}
    )

    # Warm up
    _ = quantized_model.encode(TEST_SENTENCES[:5])

    # Benchmark
    start = time.time()
    quantized_embeddings = quantized_model.encode(TEST_SENTENCES)
    quantized_time = time.time() - start
    quantized_per_sentence = (quantized_time / len(TEST_SENTENCES)) * 1000

    print(f"✓ INT8 Quantized: {quantized_time:.3f}s total, {quantized_per_sentence:.2f}ms per sentence")
    print(f"  Speedup vs PyTorch: {pytorch_time/quantized_time:.2f}x")
    print(f"  Speedup vs ONNX: {onnx_time/quantized_time:.2f}x")
except Exception as e:
    print(f"  Quantized benchmark skipped: {e}")
    quantized_time = onnx_time
    quantized_per_sentence = onnx_per_sentence

# Calculate file sizes
print(f"\n═══ Model Sizes ═══\n")

def get_dir_size(path):
    total = 0
    for f in Path(path).rglob("*"):
        if f.is_file():
            total += f.stat().st_size
    return total

onnx_size = get_dir_size(OUTPUT_DIR / "onnx_model") if (OUTPUT_DIR / "onnx_model").exists() else 0
quant_size = get_dir_size(OUTPUT_DIR / "quantized_model") if (OUTPUT_DIR / "quantized_model").exists() else 0

print(f"PyTorch model:    {pytorch_size / 1024 / 1024:.2f} MB (in memory)")
print(f"ONNX model:       {onnx_size / 1024 / 1024:.2f} MB (on disk)")
print(f"Quantized model:  {quant_size / 1024 / 1024:.2f} MB (on disk)")

if quant_size > 0 and onnx_size > 0:
    print(f"Size reduction:   {(1 - quant_size/onnx_size) * 100:.1f}%")

# Verify embedding quality
print(f"\n═══ Quality Check ═══\n")

# Compare embeddings similarity
from numpy.linalg import norm

def cosine_similarity(a, b):
    return np.dot(a, b) / (norm(a) * norm(b))

if 'onnx_embeddings' in dir() and 'pytorch_embeddings' in dir():
    sim = cosine_similarity(pytorch_embeddings[0], onnx_embeddings[0])
    print(f"PyTorch vs ONNX similarity: {sim:.6f}")

if 'quantized_embeddings' in dir() and 'pytorch_embeddings' in dir():
    sim = cosine_similarity(pytorch_embeddings[0], quantized_embeddings[0])
    print(f"PyTorch vs INT8 similarity: {sim:.6f}")

print("(Values > 0.99 = excellent quality preservation)")

# Summary
print(f"""
╔═══════════════════════════════════════════════════════════════╗
║                      OPTIMIZATION SUMMARY                      ║
╠═══════════════════════════════════════════════════════════════╣
║  Model: {MODEL_NAME:<43} ║
╠═══════════════════════════════════════════════════════════════╣
║  BENCHMARK RESULTS ({len(TEST_SENTENCES)} sentences)                           ║
║  ─────────────────────────────────────────────────────────────║
║  PyTorch:     {pytorch_per_sentence:>6.2f} ms/sentence                          ║
║  ONNX:        {onnx_per_sentence:>6.2f} ms/sentence  ({pytorch_time/onnx_time:.1f}x faster)              ║
║  INT8:        {quantized_per_sentence:>6.2f} ms/sentence  ({pytorch_time/quantized_time:.1f}x faster)              ║
╠═══════════════════════════════════════════════════════════════╣
║  Output: {str(OUTPUT_DIR):<50} ║
╚═══════════════════════════════════════════════════════════════╝
""")

# Create manifest for hosting
manifest = {
    "version": "1.0.0",
    "model_name": "specmem-embedding-v1",
    "base_model": MODEL_NAME,
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
    }
}

with open(OUTPUT_DIR / "manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

print(f"✓ Manifest saved to {OUTPUT_DIR / 'manifest.json'}")
print(f"\n🚀 Models ready for hosting on justcalljon.pro!")
