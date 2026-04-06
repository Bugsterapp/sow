#!/bin/bash
# Set up a test database and prepare for E2E testing
#
# Usage: ./e2e-test-setup.sh [branch-name]
#
# Creates a branch, writes the connection string to .env.test,
# and prints instructions for starting your app and cleaning up.
set -e

BRANCH="${1:-e2e-$(date +%s)}"

echo "Creating branch: $BRANCH"
URL=$(sow branch create "$BRANCH" --quiet)

echo "DATABASE_URL=$URL" > .env.test
echo "SOW_BRANCH=$BRANCH" >> .env.test

echo ""
echo "Branch '$BRANCH' ready."
echo "Connection: $URL"
echo ""
echo "Written to .env.test. Start your app with:"
echo "  source .env.test && npm run dev"
echo ""
echo "Or directly:"
echo "  DATABASE_URL=$URL npm run dev"
echo ""
echo "When done, see what changed and clean up:"
echo "  sow branch diff $BRANCH"
echo "  sow branch delete $BRANCH"
echo "  rm .env.test"
