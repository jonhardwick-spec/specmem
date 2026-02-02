#!/bin/bash
# Setup database schema for SpecMem codebase search

set -e

DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5433}"
DB_NAME="${PGDATABASE:-specmem_westayunprofessional}"
DB_USER="${PGUSER:-specmem_westayunprofessional}"
export PGPASSWORD="${PGPASSWORD:-specmem_westayunprofessional}"

echo "=== SpecMem DB Setup ==="
echo "Host: $DB_HOST:$DB_PORT"
echo "Database: $DB_NAME"
echo ""

# Check connection
echo "Checking connection..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" > /dev/null

# Run schema init
echo "Running schema initialization..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f /specmem/src/db/projectSchemaInit.sql

echo ""
echo "=== Tables Created ==="
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\dt"

echo ""
echo "=== code_definitions table ==="
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\d code_definitions"

echo ""
echo "Done!"
