#!/bin/bash
# =============================================================================
# PACK DOCKER IMAGES FOR NPM DISTRIBUTION
# =============================================================================
#
# Builds and saves Docker images as tar files to include in npm package.
# Run this before `npm publish` to pack the images.
#
# @author hardwicksoftwareservices
# @website https://justcalljon.pro
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPECMEM_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIST_DIR="$SPECMEM_DIR/docker-dist"

echo "╔═══════════════════════════════════════════╗"
echo "║   PACKING DOCKER IMAGES FOR NPM           ║"
echo "╚═══════════════════════════════════════════╝"

# Create docker-dist directory
mkdir -p "$DOCKER_DIST_DIR"

# Build and save embedding service image
echo ""
echo "═══ Building specmem-embedding image ═══"
cd "$SPECMEM_DIR/embedding-sandbox"

# Build the image
docker build -t specmem-embedding:latest -f Dockerfile . 2>&1 || {
  echo "Building from root Dockerfile..."
  docker build -t specmem-embedding:latest -f "$SPECMEM_DIR/Dockerfile" "$SPECMEM_DIR"
}

# Save as compressed tar
echo "Saving image to tar..."
docker save specmem-embedding:latest | gzip > "$DOCKER_DIST_DIR/specmem-embedding.tar.gz"

# Get image size
SIZE=$(du -h "$DOCKER_DIST_DIR/specmem-embedding.tar.gz" | cut -f1)
echo "✓ Saved: specmem-embedding.tar.gz ($SIZE)"

# Create manifest
cat > "$DOCKER_DIST_DIR/manifest.json" << EOF
{
  "version": "1.0.0",
  "images": [
    {
      "name": "specmem-embedding",
      "file": "specmem-embedding.tar.gz",
      "tag": "latest"
    }
  ],
  "packed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "packed_on": "$(uname -a)"
}
EOF

echo ""
echo "═══ Docker Images Packed ═══"
echo "Location: $DOCKER_DIST_DIR"
ls -lh "$DOCKER_DIST_DIR"

echo ""
echo "✓ Ready for npm publish!"
echo "  Images will be extracted and loaded on 'npm install -g'"
