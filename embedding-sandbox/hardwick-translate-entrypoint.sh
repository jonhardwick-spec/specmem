#!/bin/bash
# HARDWICK TRANSLATE - Optimized Neural MT
# LibreTranslate optimized by Hardwick Software
# justcalljon.pro
# =============================================

cat << 'BANNER'

 ██╗  ██╗ █████╗ ██████╗ ██████╗ ██╗    ██╗██╗ ██████╗██╗  ██╗
 ██║  ██║██╔══██╗██╔══██╗██╔══██╗██║    ██║██║██╔════╝██║ ██╔╝
 ███████║███████║██████╔╝██║  ██║██║ █╗ ██║██║██║     █████╔╝
 ██╔══██║██╔══██║██╔══██╗██║  ██║██║███╗██║██║██║     ██╔═██╗
 ██║  ██║██║  ██║██║  ██║██████╔╝╚███╔███╔╝██║╚██████╗██║  ██╗
 ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚══╝╚══╝ ╚═╝ ╚═════╝╚═╝  ╚═╝
            ████████╗██████╗  █████╗ ███╗   ██╗███████╗██╗      █████╗ ████████╗███████╗
            ╚══██╔══╝██╔══██╗██╔══██╗████╗  ██║██╔════╝██║     ██╔══██╗╚══██╔══╝██╔════╝
               ██║   ██████╔╝███████║██╔██╗ ██║███████╗██║     ███████║   ██║   █████╗
               ██║   ██╔══██╗██╔══██║██║╚██╗██║╚════██║██║     ██╔══██║   ██║   ██╔══╝
               ██║   ██║  ██║██║  ██║██║ ╚████║███████║███████╗██║  ██║   ██║   ███████╗
               ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

  LibreTranslate optimized by Hardwick Software
  justcalljon.pro | SpecMem Codebook Learning Engine

BANNER

echo "[Hardwick Translate] Applying optimizations..."

# ═══════════════════════════════════════════════════════════════
# OPTIMIZATION 1: CTranslate2 INT8 quantization settings
# Same approach as frankenstein ONNX quantization
# ═══════════════════════════════════════════════════════════════
export CT2_VERBOSE=0
# Force INT8 quantization for lower memory + faster inference
export CT2_COMPUTE_TYPE="${CT2_COMPUTE_TYPE:-int8}"
# Inter-op parallelism (keep low for resource cap)
export CT2_INTER_THREADS="${CT2_INTER_THREADS:-1}"
# Intra-op parallelism (within single translation)
export CT2_INTRA_THREADS="${CT2_INTRA_THREADS:-1}"

# ═══════════════════════════════════════════════════════════════
# OPTIMIZATION 2: CPU pinning & memory management
# Same as frankenstein layer-by-layer resource management
# ═══════════════════════════════════════════════════════════════
# Limit OpenMP threads
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-1}"
# Disable NUMA for single-CPU container
export OMP_PLACES=cores
export OMP_PROC_BIND=close
# Python garbage collection optimization
export PYTHONMALLOC=malloc
export MALLOC_TRIM_THRESHOLD_=65536
export MALLOC_MMAP_THRESHOLD_=65536

# ═══════════════════════════════════════════════════════════════
# OPTIMIZATION 3: Gunicorn worker tuning
# Single sync worker — we're resource-capped, no point in multiple
# ═══════════════════════════════════════════════════════════════
export GUNICORN_NUM_WORKERS="${GUNICORN_NUM_WORKERS:-1}"
# Worker timeout (translations can be slow on first request)
export GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-120}"
# Max requests before worker recycle (prevents memory leaks)
export GUNICORN_MAX_REQUESTS="${GUNICORN_MAX_REQUESTS:-500}"
export GUNICORN_MAX_REQUESTS_JITTER="${GUNICORN_MAX_REQUESTS_JITTER:-50}"

# ═══════════════════════════════════════════════════════════════
# OPTIMIZATION 4: Batch size & response optimization
# Adaptive like frankenstein's batch sizing
# ═══════════════════════════════════════════════════════════════
# LibreTranslate batch size for multi-line translations
export LT_BATCH_LIMIT="${LT_BATCH_LIMIT:-100}"
# Character limit per request (prevent OOM on huge inputs)
export LT_CHAR_LIMIT="${LT_CHAR_LIMIT:-5000}"
# Disable features we don't need
export LT_SUGGESTIONS=false
export LT_DISABLE_WEB_UI=true
export LT_API_KEYS=false
export LT_METRICS=false
export LT_DISABLE_FILES_TRANSLATION=true

echo "[Hardwick Translate] Optimizations applied:"
echo "  Compute: ${CT2_COMPUTE_TYPE} quantization"
echo "  Threads: ${CT2_INTRA_THREADS} intra / ${CT2_INTER_THREADS} inter"
echo "  Workers: ${GUNICORN_NUM_WORKERS} (max ${GUNICORN_MAX_REQUESTS} req/worker)"
echo "  Batch:   ${LT_BATCH_LIMIT} lines, ${LT_CHAR_LIMIT} chars max"
echo "  Memory:  malloc optimized, trim threshold 64K"
echo ""
echo "[Hardwick Translate] Starting translation engine..."

# Hand off to the original LibreTranslate entrypoint
# Patch original LibreTranslate banner to say "Optimized by Hardwick Software"
cd /app 2>/dev/null || true
if [ -f ./scripts/entrypoint.sh ]; then
  # Replace the ASCII art block with our branding
  sed -i '/░.*░/d' ./scripts/entrypoint.sh 2>/dev/null || true
  # Find the version line and add our branding after it
  sed -i 's/^v[0-9]\+\.[0-9]\+\.[0-9]\+$/& — Optimized by Hardwick Software · justcalljon.pro/' ./scripts/entrypoint.sh 2>/dev/null || true
fi
exec ./scripts/entrypoint.sh "$@"
