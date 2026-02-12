#!/bin/bash
# Install Argos Translate dependencies (models are packed with the package)
# Usage: bash install-argos.sh

set -e

echo "=== Installing Argos Translate dependencies ==="
pip install --break-system-packages argostranslate ctranslate2 sentencepiece emoji

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL_DIR="$SCRIPT_DIR/models/argos-translate"

echo ""
echo "=== Verifying packed models ==="
if [ -d "$MODEL_DIR/translate-en_zh-1_9" ] && [ -d "$MODEL_DIR/translate-zh_en-1_9" ]; then
    echo "Models found at: $MODEL_DIR"
    ls -la "$MODEL_DIR/"
else
    echo "ERROR: Packed models not found at $MODEL_DIR"
    echo "Models must be shipped with the package — no downloads."
    exit 1
fi

echo ""
echo "=== Testing translation ==="
ARGOS_PACKAGES_DIR="$MODEL_DIR" python3 -c "
import os, sys
# Symlink packed models so argos can find them
argos_dir = os.path.expanduser('~/.local/share/argos-translate/packages')
os.makedirs(argos_dir, exist_ok=True)
model_dir = '$MODEL_DIR'
for d in os.listdir(model_dir):
    src = os.path.join(model_dir, d)
    dst = os.path.join(argos_dir, d)
    if not os.path.exists(dst):
        os.symlink(src, dst)

import argostranslate.translate
langs = argostranslate.translate.get_installed_languages()
en = next(l for l in langs if l.code == 'en')
zh = next(l for l in langs if l.code in ('zh', 'zh-Hans'))
print(f'en→zh: hello world → {en.get_translation(zh).translate(\"hello world\")}')
print(f'zh→en: 你好世界 → {zh.get_translation(en).translate(\"你好世界\")}')
print()
print('✅ Translation working!')
"

echo ""
echo "=== Done ==="
echo "Start server: python3 hardwick-translate.py --socket /path/to/translate.sock"
