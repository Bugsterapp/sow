import { describe, it, expect, afterEach } from "vitest";
import { createConnector } from "../branching/connector.js";
import { createBranch, deleteBranch, resetBranch, execBranch } from "../branching/manager.js";
import { BUGSTER_DB_URL, cleanupConnector } from "./helpers.js";

// Skip unless explicitly enabled — this test boots Docker, builds a real
// 10k-row schema, and is too heavy for the regular unit run.
const HAS_BUGSTER = !!process.env.BUGSTER_DB_URL || !!process.env.RUN_PERF_TESTS;

const tracked: { branch: string; connector: string }[] = [];

afterEach(async () => {
  for (const { branch, connector } of tracked) {
    try {
      await deleteBranch(branch);
    } catch {
      // ignore
    }
    cleanupConnector(connector);
  }
  tracked.length = 0;
});

describe.skipIf(!HAS_BUGSTER)("docker provider — reset perf (Lane B)", () => {
  it("resetBranch completes in under 1.5s on a 10k-row schema", async () => {
    const connector = "perf-reset-bench";
    const branchName = "perf-feature";
    cleanupConnector(connector);

    await createConnector(BUGSTER_DB_URL, { name: connector });
    const branch = await createBranch(branchName, connector);
    tracked.push({ branch: branchName, connector });

    // Write some divergent data so reset has something to undo.
    try {
      await execBranch(
        branchName,
        "CREATE TABLE IF NOT EXISTS _scratch (id int); INSERT INTO _scratch SELECT generate_series(1,1000);",
      );
    } catch {
      // schema-level changes may fail on read-only/bizarre snapshots; not fatal
    }

    const start = Date.now();
    await resetBranch(branchName);
    const elapsed = Date.now() - start;

    // The whole point of Lane B: reset must complete in <1.5s.
    expect(elapsed).toBeLessThan(1500);
    expect(branch.connectionString).toContain("postgresql://");
  }, 120_000);
});
