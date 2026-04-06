#!/bin/bash
# Test multiple scenarios using save/load and exec
#
# Usage: ./scenario-testing.sh
#
# Creates a branch, runs through multiple test scenarios using
# save/load to manage state and exec to set up data.
# Modify the SCENARIOS array for your use case.
set -e

BRANCH="scenario-$(date +%s)"

cleanup() {
  echo ""
  echo "Cleaning up branch: $BRANCH"
  sow branch delete "$BRANCH" 2>/dev/null || true
}
trap cleanup EXIT

echo "Creating branch: $BRANCH"
URL=$(sow branch create "$BRANCH" --quiet)
echo "Branch URL: $URL"

# Save the clean state as a checkpoint
sow branch save "$BRANCH" clean
echo "Saved 'clean' checkpoint"

# --- Scenario 1: Expired user plan ---
echo ""
echo "=== Scenario 1: Expired user plan ==="
sow branch exec "$BRANCH" --sql "UPDATE users SET plan = 'expired' WHERE id = 1"

echo "Running tests for expired plan scenario..."
# DATABASE_URL="$URL" npm test -- --grep "expired plan"
echo "(Replace this with your test command)"

sow branch diff "$BRANCH"
sow branch load "$BRANCH" clean
echo "Restored to clean state"

# --- Scenario 2: Empty cart ---
echo ""
echo "=== Scenario 2: Empty cart ==="
sow branch exec "$BRANCH" --sql "DELETE FROM cart_items WHERE user_id = 1"

echo "Running tests for empty cart scenario..."
# DATABASE_URL="$URL" npm test -- --grep "empty cart"
echo "(Replace this with your test command)"

sow branch diff "$BRANCH"
sow branch load "$BRANCH" clean
echo "Restored to clean state"

# --- Scenario 3: Admin user ---
echo ""
echo "=== Scenario 3: Admin user ==="
sow branch exec "$BRANCH" --sql "UPDATE users SET role = 'admin' WHERE id = 1"

echo "Running tests for admin user scenario..."
# DATABASE_URL="$URL" npm test -- --grep "admin"
echo "(Replace this with your test command)"

sow branch diff "$BRANCH"

echo ""
echo "All scenarios complete."
