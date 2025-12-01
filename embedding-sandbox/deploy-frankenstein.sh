#!/bin/bash
#
# Deploy Frankenstein Embeddings v3 - ULTIMATE Dynamic Dimension System
#
# Features:
# - TRULY DYNAMIC dimensions 256↔20,000 based on data & query complexity
# - Dimension EXPANSION: Go BEYOND native model dims!
# - Dimension COMPRESSION: PCA for efficient reduction
# - Self-training transforms that learn from YOUR data
# - RAM guard: Auto-throttles to stay under 4GB
# - Stats endpoint for monitoring
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_HOME="${SPECMEM_HOME:-$(dirname "$SCRIPT_DIR")}"
SPECMEM_RUN_DIR="${SPECMEM_RUN_DIR:-${SPECMEM_HOME}/run}"
SPECMEM_SOCKET_DIR="${SPECMEM_SOCKET_DIR:-${SPECMEM_RUN_DIR}}"

SOCKET_PATH="${SPECMEM_SOCKET_DIR}/embeddings.sock"
LOG_FILE="/tmp/frankenstein-embeddings.log"
PID_FILE="/tmp/frankenstein-embeddings.pid"

echo "========================================================================"
echo "🧟 FRANKENSTEIN EMBEDDINGS v3 - ULTIMATE DEPLOYMENT"
echo "========================================================================"
echo ""
echo "Features:"
echo "  ⚡ TRULY DYNAMIC dimensions: 256 → 20,000!"
echo "  📈 Dimension EXPANSION: Go BEYOND native model dims!"
echo "  📉 Dimension COMPRESSION: PCA for efficient reduction"
echo "  🧠 Self-training transforms: Learns from YOUR data"
echo "  🔒 RAM guard: Up to 4GB with auto-throttling"
echo "  📊 Stats endpoint: Send {\"stats\": true}"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python3 not found"
    exit 1
fi

# Check if running from correct directory
if [ ! -f "$SCRIPT_DIR/frankenstein-embeddings.py" ]; then
    echo "❌ Error: frankenstein-embeddings.py not found in $SCRIPT_DIR"
    exit 1
fi

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip3 install -q sentence-transformers scikit-learn torch numpy 2>/dev/null || {
    echo "  Installing with --user flag..."
    pip3 install --user -q sentence-transformers scikit-learn torch numpy
}

# Download model (will be cached)
echo ""
echo "📥 Downloading embedding model..."
echo "   Model: all-MiniLM-L6-v2 (~80MB)"
python3 << 'DOWNLOAD'
import sys
try:
    from sentence_transformers import SentenceTransformer
    print("  Loading model (will cache for future runs)...")
    model = SentenceTransformer(
        "sentence-transformers/all-MiniLM-L6-v2",
        device='cpu',
        cache_folder="/tmp/frankenstein-models"
    )
    dims = model.get_sentence_embedding_dimension()
    print(f"  ✅ Model loaded! Native dims: {dims}")
except Exception as e:
    print(f"  ❌ Error: {e}", file=sys.stderr)
    sys.exit(1)
DOWNLOAD

# Stop existing server
echo ""
echo "🛑 Stopping existing embedding server..."
pkill -f "frankenstein-embeddings.py" 2>/dev/null || true
if [ -f "$PID_FILE" ]; then
    kill $(cat "$PID_FILE") 2>/dev/null || true
    rm -f "$PID_FILE"
fi
sleep 2

# Remove old socket
rm -f "$SOCKET_PATH"

# Get database config from environment
DB_HOST="${SPECMEM_DB_HOST:-localhost}"
DB_PORT="${SPECMEM_DB_PORT:-5432}"
DB_NAME="${SPECMEM_DB_NAME:-specmem_westayunprofessional}"
DB_USER="${SPECMEM_DB_USER:-specmem_westayunprofessional}"
DB_PASSWORD="${SPECMEM_DB_PASSWORD:-${SPECMEM_PASSWORD:-specmem_westayunprofessional}}"

# Launch Frankenstein server with QQMS throttling
echo ""
echo "🚀 Launching Frankenstein v3 ULTIMATE server with QQMS throttling..."
python3 "$SCRIPT_DIR/frankenstein-embeddings.py" \
    --socket "$SOCKET_PATH" \
    --db-host "$DB_HOST" \
    --db-port "$DB_PORT" \
    --db-name "$DB_NAME" \
    --db-user "$DB_USER" \
    --db-password "$DB_PASSWORD" \
    --max-rps "${SPECMEM_EMBEDDING_MAX_RPS:-10}" \
    --base-delay "${SPECMEM_EMBEDDING_BASE_DELAY:-100}" \
    --cpu-threshold "${SPECMEM_EMBEDDING_CPU_THRESHOLD:-60}" \
    > "$LOG_FILE" 2>&1 &

FRANK_PID=$!
echo "$FRANK_PID" > "$PID_FILE"
echo "   PID: $FRANK_PID"

# Wait for socket
echo ""
echo "⏳ Waiting for server to start..."
for i in {1..30}; do
    if [ -S "$SOCKET_PATH" ]; then
        echo "   ✅ Socket ready after ${i}s!"
        break
    fi
    if ! kill -0 $FRANK_PID 2>/dev/null; then
        echo "   ❌ Process died! Check logs:"
        tail -20 "$LOG_FILE"
        exit 1
    fi
    sleep 1
done

if [ ! -S "$SOCKET_PATH" ]; then
    echo "   ❌ Socket not created after 30s!"
    tail -20 "$LOG_FILE"
    exit 1
fi

# Test the server
echo ""
echo "🧪 Testing Frankenstein v2..."
python3 << 'TEST'
import socket
import json
import sys

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    sock.connect('${SPECMEM_SOCKET_DIR}/embeddings.sock')
    sock.settimeout(30)

    # Test 1: Simple semantic query (should use 256 dims)
    request = {'text': 'find all memories about testing'}
    sock.sendall(json.dumps(request).encode('utf-8') + b'\n')
    data = sock.recv(65536)
    response = json.loads(data.decode('utf-8'))

    if 'embedding' in response:
        print(f"  ✅ Simple query: {response['dimensions']}D ({response.get('query_type', '?')})")
    else:
        print(f"  ❌ Error: {response}")
        sys.exit(1)

    sock.close()

    # Test 2: Code query (should use 384 dims)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect('${SPECMEM_SOCKET_DIR}/embeddings.sock')
    sock.settimeout(30)

    request = {'text': 'async function handleRequest() { return await database.query(); }'}
    sock.sendall(json.dumps(request).encode('utf-8') + b'\n')
    data = sock.recv(65536)
    response = json.loads(data.decode('utf-8'))

    if 'embedding' in response:
        print(f"  ✅ Code query: {response['dimensions']}D ({response.get('query_type', '?')})")
    else:
        print(f"  ❌ Error: {response}")

    sock.close()

    # Test 3: Get stats
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect('${SPECMEM_SOCKET_DIR}/embeddings.sock')
    sock.settimeout(30)

    request = {'stats': True}
    sock.sendall(json.dumps(request).encode('utf-8') + b'\n')
    data = sock.recv(65536)
    response = json.loads(data.decode('utf-8'))

    if 'stats' in response:
        stats = response['stats']
        print(f"  ✅ Stats: {stats['total_embeddings']} total, {stats['current_dims']}D mode, {stats['ram_usage_mb']}MB RAM")

    sock.close()

except Exception as e:
    print(f"  ❌ Test error: {e}")
    sys.exit(1)
TEST

if [ $? -ne 0 ]; then
    echo "❌ Tests failed!"
    exit 1
fi

echo ""
echo "========================================================================"
echo "✅ FRANKENSTEIN v3 ULTIMATE DEPLOYED!"
echo "========================================================================"
echo ""
echo "Server Info:"
echo "  PID: $FRANK_PID"
echo "  Socket: $SOCKET_PATH"
echo "  Logs: $LOG_FILE"
echo "  PID file: $PID_FILE"
echo ""
echo "TRULY DYNAMIC Dimensions (256 → 20,000!):"
echo "  • Simple queries      → 256D  (ultra-fast)"
echo "  • Technical queries   → 512-1024D (balanced)"
echo "  • Code queries        → 1024-1536D (quality)"
echo "  • Scientific queries  → 1536-3072D (high quality)"
echo "  • Maximum complexity  → up to 20,000D (MAXIMUM!)"
echo ""
echo "Features:"
echo "  • Dimension EXPANSION: Go BEYOND native model dims!"
echo "  • Dimension COMPRESSION: PCA for efficient reduction"
echo "  • RAM Guard: Up to 4GB with auto-throttling"
echo ""
echo "Commands:"
echo "  Monitor: tail -f $LOG_FILE"
echo "  Stop: kill \$(cat $PID_FILE)"
echo "  Stats: echo '{\"stats\":true}' | nc -U $SOCKET_PATH"
echo ""

# Show recent logs
echo "Recent logs:"
tail -10 "$LOG_FILE"
