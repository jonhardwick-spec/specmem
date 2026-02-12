#!/usr/bin/env python3
"""
HARDWICK TRANSLATE - Lean Argos Translate Socket Server

Direct replacement for LibreTranslate Docker container (AGPL → MIT).
Uses argostranslate directly over Unix socket, same pattern as frankenstein-embeddings.py.

Protocol (newline-delimited JSON):
  Request:  {"q": "word1\nword2", "source": "en", "target": "zh"}
  Response: {"translatedText": "翻译1\n翻译2"}
  Health:   {"q": "__health_check__", "source": "en", "target": "zh"}
           → {"translatedText": "ok", "status": "healthy"}

@author hardwicksoftwareservices
"""

import signal
import sys
import os
import socket
import json
import time
import re
import unicodedata
import argparse
import threading
import subprocess
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor


def _ensure_deps():
    """Auto-install dependencies if missing."""
    needed = []
    for mod, pkg in [('argostranslate', 'argostranslate'), ('ctranslate2', 'ctranslate2'),
                     ('sentencepiece', 'sentencepiece'), ('emoji', 'emoji')]:
        try:
            __import__(mod)
        except ImportError:
            needed.append(pkg)
    if needed:
        print(f"⏳ Installing missing deps: {needed}", file=sys.stderr)
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--break-system-packages', '-q'] + needed)
        print(f"✅ Deps installed", file=sys.stderr)

_ensure_deps()

# Resource limits — keep CPU/RAM low
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
os.environ.setdefault('CT2_COMPUTE_TYPE', 'int8')

# Ignore SIGPIPE
signal.signal(signal.SIGPIPE, signal.SIG_IGN)

# Language aliases (Argos uses full codes internally)
LANG_ALIASES = {
    'zh': 'zh-Hans',
    'zt': 'zh-Hant',
}

# Model directory search order — packed models first, never download
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_MODEL_SEARCH_PATHS = [
    os.path.join(_SCRIPT_DIR, 'models', 'argos-translate'),  # Packed with npm package
    '/tmp/specmem-hardwick-models/share/argos-translate/packages',
    os.path.expanduser('~/.local/share/argos-translate/packages'),
]

def _find_model_dir():
    """Find first existing model directory with actual model folders."""
    for p in _MODEL_SEARCH_PATHS:
        if os.path.isdir(p) and any(d.startswith('translate-') for d in os.listdir(p)):
            return p
    return _MODEL_SEARCH_PATHS[0]

DEFAULT_MODEL_DIR = _find_model_dir()

# Emoji detection — use Python's emoji category check
def _is_emoji_only(text):
    """Check if text is only emoji/whitespace/punctuation (nothing translatable)."""
    import emoji as emoji_lib
    stripped = text.strip()
    if not stripped:
        return True
    # Remove all emoji characters
    demojized = emoji_lib.replace_emoji(stripped, replace='')
    # Check if anything meaningful remains
    remaining = demojized.strip()
    if not remaining:
        return True
    for ch in remaining:
        cat = unicodedata.category(ch)
        if cat[0] not in ('P', 'Z', 'S', 'C'):
            return False
    return True


def detect_translatable(text):
    """Check if text contains translatable content (not just emoji/whitespace)."""
    return not _is_emoji_only(text)


def improve_translation_formatting(source, translation):
    """
    Adapted from LibreTranslate's language.py — preserve formatting from source.
    Handles: punctuation preservation, case fixing, salad bug.
    """
    if not source or not translation:
        return translation

    # Salad bug: model repeats a single word for short inputs
    # e.g. "hello" → "你好 你好 你好"
    if len(source.split()) <= 2:
        words = translation.split()
        if len(words) > 1 and len(set(words)) == 1:
            translation = words[0]

    # Preserve trailing punctuation from source
    src_trailing = ''
    for ch in reversed(source):
        if unicodedata.category(ch).startswith('P'):
            src_trailing = ch + src_trailing
        else:
            break

    if src_trailing:
        # Strip existing trailing punct from translation, add source's
        trans_stripped = translation.rstrip()
        while trans_stripped and unicodedata.category(trans_stripped[-1]).startswith('P'):
            trans_stripped = trans_stripped[:-1]
        if trans_stripped:
            translation = trans_stripped + src_trailing

    # Case preservation
    if source and source[0].islower() and translation and translation[0].isupper():
        # Source starts lowercase but translation starts uppercase — fix
        # Only if source language uses case (Latin scripts)
        if source[0].isascii():
            translation = translation[0].lower() + translation[1:]
    elif source and source[0].isupper() and translation and translation[0].islower():
        if translation[0].isascii():
            translation = translation[0].upper() + translation[1:]

    return translation


class HardwickTranslate:
    """Unix socket translation server using Argos Translate directly."""

    def __init__(self, socket_path, model_dir=None):
        self.socket_path = socket_path
        self.model_dir = model_dir or DEFAULT_MODEL_DIR
        self.shutdown_requested = False
        self.warm_restart = False
        self.last_request_time = time.time()

        # Lazy-loaded translation models
        self._models_loaded = False
        self._load_lock = threading.Lock()
        self._installed_languages = None

        # Set up model directory
        os.environ['ARGOS_PACKAGES_DIR'] = self.model_dir
        # Also set XDG for argostranslate's internal paths
        os.environ.setdefault('XDG_DATA_HOME', os.path.dirname(os.path.dirname(self.model_dir)))

        # Signal handlers
        signal.signal(signal.SIGHUP, self._handle_sighup)
        signal.signal(signal.SIGTERM, self._handle_sigterm)
        signal.signal(signal.SIGINT, self._handle_sigterm)

    def _handle_sighup(self, signum, frame):
        """Warm restart — clear cache, keep models loaded."""
        print(f"♻️  SIGHUP received — warm restart", file=sys.stderr)
        self.warm_restart = True
        self._clear_cache()

    def _handle_sigterm(self, signum, frame):
        """Graceful shutdown."""
        print(f"🛑 SIGTERM received — shutting down", file=sys.stderr)
        self.shutdown_requested = True

    def _clear_cache(self):
        """Clear translation cache."""
        self._cached_translate.cache_clear()
        print(f"   Cache cleared", file=sys.stderr)

    def _ensure_models(self):
        """Lazy-load Argos Translate models on first real request."""
        if self._models_loaded:
            return

        with self._load_lock:
            if self._models_loaded:
                return

            print(f"⏳ Loading Argos Translate models...", file=sys.stderr)
            start = time.time()

            try:
                import argostranslate.translate
                import argostranslate.package

                # Check if models are already installed
                self._installed_languages = argostranslate.translate.get_installed_languages()
                lang_codes = [l.code for l in self._installed_languages]
                print(f"   Installed languages: {lang_codes}", file=sys.stderr)

                # Check we have en and zh
                has_en = any(l.code == 'en' for l in self._installed_languages)
                has_zh = any(l.code in ('zh', 'zh-Hans') for l in self._installed_languages)

                if not has_en or not has_zh:
                    # Register packed models — NO downloads, internalized only
                    self._register_packed_models()
                    self._installed_languages = argostranslate.translate.get_installed_languages()
                    lang_codes = [l.code for l in self._installed_languages]
                    has_en = any(l.code == 'en' for l in self._installed_languages)
                    has_zh = any(l.code in ('zh', 'zh-Hans') for l in self._installed_languages)
                    if not has_en or not has_zh:
                        raise RuntimeError(f"Packed models not found in {self.model_dir}. Models must be shipped with the package — no downloads.")

                elapsed = time.time() - start
                print(f"✅ Models loaded in {elapsed:.1f}s", file=sys.stderr)
                self._models_loaded = True

            except Exception as e:
                print(f"❌ Model loading failed: {e}", file=sys.stderr)
                raise

    def _register_packed_models(self):
        """Register packed model directories so argostranslate can find them."""
        import argostranslate.package
        model_dir = self.model_dir
        if not os.path.isdir(model_dir):
            return
        # Copy packed models to argos's expected location if needed
        argos_dir = os.path.join(os.environ.get('XDG_DATA_HOME', os.path.expanduser('~/.local/share')),
                                  'argos-translate', 'packages')
        os.makedirs(argos_dir, exist_ok=True)
        for d in os.listdir(model_dir):
            if d.startswith('translate-'):
                src = os.path.join(model_dir, d)
                dst = os.path.join(argos_dir, d)
                if not os.path.exists(dst):
                    print(f"   Registering packed model: {d}", file=sys.stderr)
                    os.symlink(src, dst)

    def _get_translation(self, source_code, target_code):
        """Get a translation object for the given language pair."""
        src_lang = None
        tgt_lang = None

        # Try exact code first, then alias, then base code
        for code_variants in [(source_code, LANG_ALIASES.get(source_code), source_code.split('-')[0]),
                               (target_code, LANG_ALIASES.get(target_code), target_code.split('-')[0])]:
            found = None
            for variant in code_variants:
                if variant is None:
                    continue
                for lang in self._installed_languages:
                    if lang.code == variant:
                        found = lang
                        break
                if found:
                    break
            if code_variants[0] == source_code:
                src_lang = found
            else:
                tgt_lang = found

        if not src_lang:
            raise ValueError(f"Source language not found: {source_code}")
        if not tgt_lang:
            raise ValueError(f"Target language not found: {target_code}")

        translation = src_lang.get_translation(tgt_lang)
        if not translation:
            raise ValueError(f"No translation available: {source_code} → {target_code}")

        return translation

    def translate(self, text, source, target):
        """Translate text, handling newline-separated batches."""
        self._ensure_models()

        lines = text.split('\n')
        results = []

        for line in lines:
            stripped = line.strip()
            if not stripped:
                results.append('')
                continue

            if not detect_translatable(stripped):
                results.append(stripped)
                continue

            # Use cached translation
            translated = self._cached_translate(stripped, source, target)
            results.append(translated)

        return '\n'.join(results)

    @lru_cache(maxsize=10000)
    def _cached_translate(self, text, source, target):
        """Cached translation — avoids re-translating the same words."""
        return self._translate_single(text, source, target)

    def _translate_single(self, text, source, target):
        """Translate a single string using Argos."""
        translation = self._get_translation(source, target)
        result = translation.translate(text)
        return improve_translation_formatting(text, result)

    def _handle_connection(self, conn):
        """Handle a single client connection."""
        try:
            # Read request (newline-delimited JSON)
            data = b''
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk
                if b'\n' in chunk:
                    break

            if not data:
                return

            request = json.loads(data.decode('utf-8'))

            # Update keepalive
            self.last_request_time = time.time()

            # Health check
            if request.get('q') == '__health_check__':
                response = {'translatedText': 'ok', 'status': 'healthy'}
                conn.sendall(json.dumps(response).encode('utf-8') + b'\n')
                return

            # Translate
            q = request.get('q', '')
            source = request.get('source', 'en')
            target = request.get('target', 'zh')

            translated = self.translate(q, source, target)
            response = {'translatedText': translated}
            conn.sendall(json.dumps(response).encode('utf-8') + b'\n')

        except BrokenPipeError:
            pass
        except ConnectionResetError:
            pass
        except socket.timeout:
            pass
        except Exception as e:
            import traceback
            print(f"❌ Connection error: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            try:
                conn.sendall(json.dumps({'error': str(e)}).encode('utf-8') + b'\n')
            except:
                pass
        finally:
            try:
                conn.close()
            except:
                pass

    def start(self):
        """Start the Unix socket server."""
        # Resolve socket path
        if not self.socket_path:
            project = os.environ.get('SPECMEM_PROJECT_PATH', os.getcwd())
            self.socket_path = os.path.join(project, 'specmem', 'sockets', 'translate.sock')

        # Remove old socket
        if os.path.exists(self.socket_path):
            os.remove(self.socket_path)

        # Create directory
        os.makedirs(os.path.dirname(self.socket_path), exist_ok=True)

        # Create Unix socket
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        old_umask = os.umask(0o077)
        try:
            server.bind(self.socket_path)
            os.chmod(self.socket_path, 0o660)
        finally:
            os.umask(old_umask)

        server.listen(32)
        server.settimeout(60)

        executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='translate-worker')

        print(f"", file=sys.stderr)
        print(f"HARDWICK TRANSLATE - Argos Translate Socket Server", file=sys.stderr)
        print(f"   Socket: {self.socket_path}", file=sys.stderr)
        print(f"   Models: {self.model_dir}", file=sys.stderr)
        print(f"   Workers: 2", file=sys.stderr)
        print(f"   Cache: LRU (10000 entries)", file=sys.stderr)
        print(f"   Compute: int8 quantization", file=sys.stderr)
        print(f"   Model loading: lazy (on first request)", file=sys.stderr)
        print(f"", file=sys.stderr)

        try:
            while not self.shutdown_requested:
                # Handle warm restart
                if self.warm_restart:
                    self.warm_restart = False
                    print(f"♻️  Warm restart complete", file=sys.stderr)

                try:
                    conn, _ = server.accept()
                    conn.settimeout(120)
                    executor.submit(self._handle_connection, conn)
                except TimeoutError:
                    continue
                except Exception as e:
                    if self.shutdown_requested:
                        break
                    print(f"❌ Accept error: {e}", file=sys.stderr)
        finally:
            print(f"🛑 Hardwick Translate shutting down...", file=sys.stderr)
            executor.shutdown(wait=True, cancel_futures=True)
            server.close()
            if os.path.exists(self.socket_path):
                os.remove(self.socket_path)
            print(f"✅ Shutdown complete.", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description='Hardwick Translate - Argos Translate Socket Server')
    parser.add_argument(
        '--socket',
        default=None,
        help='Unix socket path (default: {project}/specmem/sockets/translate.sock)'
    )
    parser.add_argument(
        '--model-dir',
        default=os.environ.get('ARGOS_PACKAGES_DIR', DEFAULT_MODEL_DIR),
        help='Argos model package directory'
    )
    parser.add_argument(
        '--service',
        action='store_true',
        help='Run in service mode (no idle shutdown)'
    )
    args = parser.parse_args()

    service = HardwickTranslate(
        socket_path=args.socket,
        model_dir=args.model_dir,
    )
    service.start()


if __name__ == '__main__':
    main()
