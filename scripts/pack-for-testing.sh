#!/bin/bash
# =============================================================================
# PACK SPECMEM FOR PRIVATE TESTING
# =============================================================================
#
# Creates a tarball for private testing WITHOUT publishing to npm.
#
# Installation methods:
#   1. npm install ./specmem-hardwicksoftware-1.0.0.tgz
#   2. npm install https://justcalljon.pro/downloads/specmem-hardwicksoftware-1.0.0.tgz
#   3. npm install git+https://github.com/hardwicksoftware/specmem-private.git
#
# @author hardwicksoftwareservices
# @website https://justcalljon.pro
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_DIR="$(dirname "$SCRIPT_DIR")"
NPM_STUB_DIR="$SPECMEM_DIR/npm-stub"
DIST_DIR="$SPECMEM_DIR/dist-packages"
VERSION=$(node -p "require('$NPM_STUB_DIR/package.json').version")

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         PACKING SPECMEM FOR PRIVATE TESTING                   ║"
echo "║         https://justcalljon.pro                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Create dist directories
mkdir -p "$DIST_DIR"
mkdir -p "$DIST_DIR/core"

echo "═══ Packing NPM Stub Package ═══"
echo ""

cd "$NPM_STUB_DIR"

# Create npm package tarball
echo "Creating npm package tarball..."
npm pack --pack-destination "$DIST_DIR"

TARBALL_NAME="specmem-hardwicksoftware-${VERSION}.tgz"
echo "✓ Created: $DIST_DIR/$TARBALL_NAME"

echo ""
echo "═══ Packing Core Distribution ═══"
echo ""

# Pack the core SpecMem files for the download server
cd "$SPECMEM_DIR"

# Files to include in core package
CORE_FILES=(
  "bin/"
  "dist/"
  "claude-hooks/"
  "scripts/first-run-model-setup.cjs"
  "scripts/optimize-embedding-model.py"
  "bootstrap.cjs"
  "specmem-health.cjs"
  "specmem.env"
  "package.json"
)

# Create core tarball
echo "Creating core package..."
tar -czf "$DIST_DIR/specmem-core.tar.gz" \
  --exclude="node_modules" \
  --exclude=".git" \
  --exclude="*.log" \
  --transform="s|^|specmem/|" \
  ${CORE_FILES[@]} 2>/dev/null || {
  # Fallback if some files don't exist
  tar -czf "$DIST_DIR/specmem-core.tar.gz" \
    --exclude="node_modules" \
    --exclude=".git" \
    bin/ dist/ claude-hooks/ bootstrap.cjs package.json 2>/dev/null || true
}

CORE_SIZE=$(du -h "$DIST_DIR/specmem-core.tar.gz" 2>/dev/null | cut -f1 || echo "unknown")
echo "✓ Created: specmem-core.tar.gz ($CORE_SIZE)"

# Pack hooks separately
echo "Creating hooks package..."
tar -czf "$DIST_DIR/specmem-hooks.tar.gz" \
  --transform="s|^claude-hooks/||" \
  claude-hooks/ 2>/dev/null || echo "⚠ Hooks packing skipped"

# Pack models if they exist
if [ -d "$SPECMEM_DIR/models/optimized" ]; then
  echo "Creating models package..."
  tar -czf "$DIST_DIR/specmem-models.tar.gz" \
    -C "$SPECMEM_DIR/models" \
    optimized/ 2>/dev/null || echo "⚠ Models packing skipped"
fi

echo ""
echo "═══ Packages Created ═══"
echo ""
ls -lh "$DIST_DIR"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                 🎉 READY FOR TESTING! 🎉                      ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                               ║"
echo "║  OPTION 1: Local tarball install                              ║"
echo "║    npm install -g $DIST_DIR/$TARBALL_NAME"
echo "║                                                               ║"
echo "║  OPTION 2: URL install (after uploading to server)            ║"
echo "║    npm install -g https://justcalljon.pro/dl/$TARBALL_NAME"
echo "║                                                               ║"
echo "║  OPTION 3: Private git repo                                   ║"
echo "║    npm install -g git+ssh://git@github.com/YOU/specmem.git    ║"
echo "║                                                               ║"
echo "║  OPTION 4: npm link (for development)                         ║"
echo "║    cd $NPM_STUB_DIR && npm link"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Files to upload to justcalljon.pro:"
echo "  - $DIST_DIR/specmem-core.tar.gz"
echo "  - $DIST_DIR/specmem-hooks.tar.gz"
echo "  - $DIST_DIR/specmem-models.tar.gz (if exists)"
echo ""
echo "Run the download server:"
echo "  node $SPECMEM_DIR/server/download-server.cjs"
echo ""
