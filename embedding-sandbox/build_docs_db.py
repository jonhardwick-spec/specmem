#!/usr/bin/env python3
"""
BUILD DOCS DB - Process Python/JS docs into SQLite for Mini-COT

This creates a lightweight knowledge base that Mini-COT uses for
intelligent decision making. Baked into the container at build time.

Output: /app/docs.db (SQLite, ~20MB)
"""

import os
import re
import sqlite3
import hashlib
from pathlib import Path
from typing import Generator, Tuple

# Paths
PYTHON_DOCS_DIR = "/usr/share/doc/python3.12/html/_sources"
OUTPUT_DB = os.environ.get("DOCS_DB", "/app/docs.db")

def clean_rst(text: str) -> str:
    """Clean RST markup to plain text"""
    # Remove RST directives
    text = re.sub(r'\.\. [a-z]+::[^\n]*\n', '', text)
    text = re.sub(r'::[^\n]*\n', '', text)

    # Remove role markup like :func:`name` -> name
    text = re.sub(r':[a-z]+:`([^`]+)`', r'\1', text)

    # Remove inline literals
    text = re.sub(r'``([^`]+)``', r'\1', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)

    # Remove reference targets
    text = re.sub(r'\.\. _[^:]+:', '', text)

    # Remove index entries
    text = re.sub(r'\.\. index::[^\n]*\n', '', text)

    # Clean up whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)

    return text.strip()

def extract_sections(text: str) -> Generator[Tuple[str, str], None, None]:
    """Extract sections from RST document"""
    # Split on section headers (lines followed by === or ---)
    lines = text.split('\n')
    current_title = "Introduction"
    current_content = []

    for i, line in enumerate(lines):
        # Check if next line is underline (section marker)
        if i + 1 < len(lines):
            next_line = lines[i + 1]
            if next_line and len(next_line) >= 3 and next_line == next_line[0] * len(next_line):
                if next_line[0] in '=-~^':
                    # This line is a title
                    if current_content:
                        content = '\n'.join(current_content).strip()
                        if len(content) > 50:  # Skip tiny sections
                            yield (current_title, clean_rst(content))
                    current_title = line.strip()
                    current_content = []
                    continue

        current_content.append(line)

    # Yield last section
    if current_content:
        content = '\n'.join(current_content).strip()
        if len(content) > 50:
            yield (current_title, clean_rst(content))

def process_python_docs() -> Generator[Tuple[str, str, str, str], None, None]:
    """Process Python documentation files"""
    docs_path = Path(PYTHON_DOCS_DIR)

    if not docs_path.exists():
        print(f"Python docs not found at {PYTHON_DOCS_DIR}")
        return

    for rst_file in docs_path.rglob("*.txt"):
        try:
            # Get relative path for categorization
            rel_path = rst_file.relative_to(docs_path)
            category = str(rel_path.parent) if rel_path.parent.name else "general"

            content = rst_file.read_text(encoding='utf-8', errors='ignore')

            # Extract document title (first line usually)
            lines = content.split('\n')
            doc_title = lines[0].strip() if lines else rst_file.stem

            # Process sections
            for section_title, section_content in extract_sections(content):
                if len(section_content) > 100:  # Skip tiny sections
                    yield (
                        "python",
                        f"{category}/{doc_title}",
                        section_title,
                        section_content[:5000]  # Cap at 5KB per section
                    )

        except Exception as e:
            print(f"Error processing {rst_file}: {e}")

def create_database():
    """Create the docs SQLite database"""
    os.makedirs(os.path.dirname(OUTPUT_DB) if os.path.dirname(OUTPUT_DB) else '.', exist_ok=True)

    conn = sqlite3.connect(OUTPUT_DB)

    # Create tables
    conn.execute("""
        CREATE TABLE IF NOT EXISTS docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            language TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            content_hash TEXT UNIQUE,
            created_at REAL DEFAULT (julianday('now'))
        )
    """)

    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_language ON docs(language)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_category ON docs(category)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_title ON docs(title)")

    # FTS for full-text search
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
            title, content, content='docs', content_rowid='id'
        )
    """)

    conn.commit()
    return conn

def build_database():
    """Build the complete docs database"""
    print("Building docs database...")

    conn = create_database()

    # Process Python docs
    print("Processing Python documentation...")
    python_count = 0

    for language, category, title, content in process_python_docs():
        content_hash = hashlib.md5(content.encode()).hexdigest()

        try:
            cursor = conn.execute("""
                INSERT INTO docs (language, category, title, content, content_hash)
                VALUES (?, ?, ?, ?, ?)
            """, (language, category, title, content, content_hash))

            # Update FTS
            conn.execute("""
                INSERT INTO docs_fts (rowid, title, content)
                VALUES (?, ?, ?)
            """, (cursor.lastrowid, title, content))

            python_count += 1

        except sqlite3.IntegrityError:
            pass  # Duplicate

    conn.commit()

    print(f"Processed {python_count} Python doc sections")

    # Show stats
    cursor = conn.execute("SELECT COUNT(*), SUM(LENGTH(content)) FROM docs")
    total, size = cursor.fetchone()
    print(f"\nTotal: {total} sections, {size/1024/1024:.1f} MB")

    # Show by category
    cursor = conn.execute("""
        SELECT language, category, COUNT(*)
        FROM docs
        GROUP BY language, category
        ORDER BY COUNT(*) DESC
        LIMIT 20
    """)

    print("\nTop categories:")
    for row in cursor:
        print(f"  {row[0]}/{row[1]}: {row[2]} sections")

    conn.close()
    print(f"\nDatabase saved to: {OUTPUT_DB}")
    print(f"Size: {os.path.getsize(OUTPUT_DB)/1024/1024:.1f} MB")

def search_docs(query: str, limit: int = 5):
    """Search the docs database"""
    conn = sqlite3.connect(OUTPUT_DB)

    cursor = conn.execute("""
        SELECT d.language, d.category, d.title,
               snippet(docs_fts, 1, '>>>', '<<<', '...', 50) as snippet
        FROM docs_fts
        JOIN docs d ON docs_fts.rowid = d.id
        WHERE docs_fts MATCH ?
        ORDER BY rank
        LIMIT ?
    """, (query, limit))

    results = cursor.fetchall()
    conn.close()

    return results

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Build docs database for Mini-COT")
    parser.add_argument("--build", action="store_true", help="Build the database")
    parser.add_argument("--search", type=str, help="Search the database")
    parser.add_argument("--output", type=str, default=OUTPUT_DB, help="Output database path")

    args = parser.parse_args()

    if args.output:
        OUTPUT_DB = args.output

    if args.build:
        build_database()
    elif args.search:
        results = search_docs(args.search)
        for lang, cat, title, snippet in results:
            print(f"\n[{lang}] {cat}/{title}")
            print(f"  {snippet}")
    else:
        print("Usage: python build_docs_db.py --build|--search <query>")
