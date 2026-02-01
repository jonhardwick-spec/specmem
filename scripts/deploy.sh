#!/bin/bash
# SpecMem Deploy Script - The Right Way Every Time
# Usage: ./deploy.sh [patch|minor|major]
#
# 1. Build
# 2. Bump version (default: patch)
# 3. Pack (create tarball)
# 4. Uninstall old global install
# 5. Install new tarball globally

set -e

cd "$(dirname "$0")/.."

# Version bump type (default: patch)
BUMP_TYPE="${1:-patch}"
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 [patch|minor|major]"
  echo "  patch - 1.1.20 -> 1.1.21 (default)"
  echo "  minor - 1.1.20 -> 1.2.0"
  echo "  major - 1.1.20 -> 2.0.0"
  exit 1
fi

echo "1. Building..."
npm run build

echo "2. Bumping version ($BUMP_TYPE)..."
npm version "$BUMP_TYPE" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
echo "   Version: $VERSION"

echo "3. Packing tarball..."
npm pack >/dev/null 2>&1
TARBALL="specmem-hardwicksoftware-${VERSION}.tgz"
if [ ! -f "$TARBALL" ]; then
  echo "   ERROR: Expected tarball not found: $TARBALL"
  exit 1
fi
echo "   Created: $TARBALL"

echo "4. Uninstalling old global install..."
sudo npm uninstall -g specmem-hardwicksoftware 2>/dev/null || true
sudo rm -rf /usr/lib/node_modules/specmem-hardwicksoftware 2>/dev/null || true
sudo rm -rf /usr/lib/node_modules/.specmem-hardwicksoftware* 2>/dev/null || true

echo "5. Installing new tarball globally..."
sudo npm install -g "$TARBALL"

echo ""
echo "Done! SpecMem v$VERSION deployed globally."
echo "Run: specmem-init"
