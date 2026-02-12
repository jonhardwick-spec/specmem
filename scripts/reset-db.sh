#!/bin/bash
# Reset database and run migrations fresh

export PGPASSWORD="${PGPASSWORD:-specmem_westayunprofessional}"
DB_HOST="${SPECMEM_DB_HOST:-localhost}"
DB_PORT="${SPECMEM_DB_PORT:-5433}"
DB_NAME="${SPECMEM_DB_NAME:-specmem_westayunprofessional}"
DB_USER="${SPECMEM_DB_USER:-specmem_westayunprofessional}"

echo "=== Resetting Database ==="
echo "Host: $DB_HOST:$DB_PORT"
echo "Database: $DB_NAME"
echo ""

# Drop all tables
echo "Dropping existing tables..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO "$DB_USER";
GRANT ALL ON SCHEMA public TO public;
EOF

echo ""
echo "Database reset. Running migrations..."
node scripts/run-migrations.js

echo ""
echo "=== Tables After Migration ==="
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\dt" | head -30
