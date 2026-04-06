#!/bin/bash
# CI/CD pipeline: create branch, run tests, show diff, clean up
#
# Usage: ./ci-pipeline.sh <test-command>
# Example: ./ci-pipeline.sh "npm test"
# Example: ./ci-pipeline.sh "pytest"
#
# Expects DATABASE_URL to be set for the initial connector (or already created).
# Creates a unique branch per CI run, runs the test command, then cleans up.
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <test-command>"
  echo "Example: $0 'npm test'"
  exit 1
fi

BRANCH="ci-${CI_COMMIT_SHA:-$(date +%s)}-$$"

cleanup() {
  echo ""
  echo "Cleaning up branch: $BRANCH"
  sow branch delete "$BRANCH" 2>/dev/null || true
}
trap cleanup EXIT

# Ensure a connector exists
if ! sow connector list --quiet 2>/dev/null | grep -q .; then
  if [ -z "$DATABASE_URL" ]; then
    echo "Error: No connector found and DATABASE_URL is not set."
    echo "Run 'sow connect <url>' first, or set DATABASE_URL."
    exit 1
  fi
  echo "Creating connector from DATABASE_URL..."
  sow connect "$DATABASE_URL" --quiet
fi

echo "Creating branch: $BRANCH"
BRANCH_URL=$(sow branch create "$BRANCH" --quiet)
echo "Branch URL: $BRANCH_URL"

echo ""
echo "Running tests..."
DATABASE_URL="$BRANCH_URL" eval "$@"
TEST_EXIT=$?

echo ""
echo "Changes made during tests:"
sow branch diff "$BRANCH" 2>/dev/null || true

exit $TEST_EXIT
