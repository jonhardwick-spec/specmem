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
# Skip build if no src/ folder (pre-built distribution)
if [ -d "src" ]; then
  npm run build
else
  echo "   Skipping build (pre-built distribution - no src/ folder)"
fi

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

echo "6. Deploying hooks to ~/.claude/hooks/..."
HOOKS_SRC="$(pwd)/claude-hooks"
HOOKS_DST="$HOME/.claude/hooks"
mkdir -p "$HOOKS_DST"

# Copy all hook files
HOOK_COUNT=0
for f in "$HOOKS_SRC"/*.js "$HOOKS_SRC"/*.cjs; do
  [ -f "$f" ] || continue
  cp "$f" "$HOOKS_DST/"
  ((HOOK_COUNT++)) || true
done
echo "   Copied $HOOK_COUNT hook files"

echo "7. Merging settings.json (preserving non-hook settings)..."
SETTINGS_SRC="$HOOKS_SRC/settings.json"
SETTINGS_DST="$HOME/.claude/settings.json"

if [ -f "$SETTINGS_SRC" ]; then
  if [ -f "$SETTINGS_DST" ]; then
    # Backup existing
    cp "$SETTINGS_DST" "$SETTINGS_DST.backup.$(date +%s)"

    # Merge: take hooks from source, preserve other keys from existing
    node -e "
      const fs = require('fs');
      const src = JSON.parse(fs.readFileSync('$SETTINGS_SRC', 'utf8'));
      let dst = {};
      try { dst = JSON.parse(fs.readFileSync('$SETTINGS_DST', 'utf8')); } catch(e) {}
      const merged = { ...dst, hooks: src.hooks };
      fs.writeFileSync('$SETTINGS_DST', JSON.stringify(merged, null, 2));
      const hookCount = Object.keys(merged.hooks || {}).length;
      console.log('   Merged ' + hookCount + ' hook event types');
    "
  else
    cp "$SETTINGS_SRC" "$SETTINGS_DST"
    echo "   Installed fresh settings.json"
  fi

  # Verify
  HOOK_TYPES=$(node -p "Object.keys(JSON.parse(require('fs').readFileSync('$SETTINGS_DST','utf8')).hooks||{}).join(', ')")
  echo "   ✓ Verified hooks: $HOOK_TYPES"
else
  echo "   ⚠ No source settings.json found"
fi

echo ""
echo "Done! SpecMem v$VERSION deployed globally."
echo "Hooks: $HOOK_COUNT files -> ~/.claude/hooks/"
echo "Settings: ~/.claude/settings.json (merged)"
echo ""
echo "Run: specmem-init"
