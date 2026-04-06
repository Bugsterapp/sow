#!/bin/bash
# Test a database migration safely using sow
#
# Usage: ./migration-test.sh <migration-command>
# Example: ./migration-test.sh "npx prisma migrate dev"
# Example: ./migration-test.sh "npx knex migrate:latest"
#
# Creates a throwaway branch, runs the migration, shows the diff, cleans up.
# Exit code 0 = migration succeeded. Non-zero = migration failed.
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <migration-command>"
  echo "Example: $0 'npx prisma migrate dev'"
  exit 1
fi

BRANCH="migration-$(date +%s)"

echo "Creating test branch: $BRANCH"
URL=$(sow branch create "$BRANCH" --quiet)
echo "Branch URL: $URL"

echo ""
echo "Running migration..."
DATABASE_URL="$URL" eval "$@"
MIGRATION_EXIT=$?

echo ""
echo "Migration result (diff):"
sow branch diff "$BRANCH"

echo ""
echo "Cleaning up..."
sow branch delete "$BRANCH"

if [ $MIGRATION_EXIT -ne 0 ]; then
  echo "Migration FAILED (exit code $MIGRATION_EXIT)"
  exit $MIGRATION_EXIT
fi

echo "Migration succeeded."
