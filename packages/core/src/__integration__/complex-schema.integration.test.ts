import { describe, it, expect, afterEach } from "vitest";
import { createConnector } from "../branching/connector.js";
import {
  BUGSTER_DB_URL,
  readSnapshotSQL,
  countSnapshotRows,
  hasTable,
  parseSnapshotRows,
  unquote,
  cleanupConnector,
  loadMetadata,
} from "./helpers.js";

const BUGSTER_TABLES = [
  "projects",
  "project_access",
  "project_context",
  "project_credentials",
  "analysis_runs",
  "issue_groups",
  "issues",
  "pending_issues",
  "patterns",
  "pattern_occurrences",
  "session_summaries",
  "event_session_summaries",
  "session_processing_logs",
  "session_rules",
  "feedback_rules",
  "insight_reports",
  "integrations",
  "detector_run_metrics",
];

const connectorNames: string[] = [];

function trackConnector(name: string): string {
  connectorNames.push(name);
  return name;
}

afterEach(() => {
  for (const name of connectorNames) {
    cleanupConnector(name);
  }
  connectorNames.length = 0;
});

describe("bugsterdb integration tests (complex schema)", () => {
  describe("complex schema handling", () => {
    it("should snapshot all tables with UUIDs, jsonb, and no FKs", async () => {
      const name = trackConnector("test-bugster");
      const result = await createConnector(BUGSTER_DB_URL, {
        name,
        noSanitize: true,
      });

      expect(result.tables).toBeGreaterThanOrEqual(BUGSTER_TABLES.length);
      expect(result.rows).toBeGreaterThan(0);

      const sql = readSnapshotSQL(name);

      for (const tableName of BUGSTER_TABLES) {
        expect(hasTable(sql, tableName)).toBe(true);
      }

      // Verify UUID primary keys are handled
      const projectRows = parseSnapshotRows(sql, "projects");
      expect(projectRows.length).toBe(5);
      for (const row of projectRows) {
        const id = unquote(row.id);
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }

      // Verify jsonb columns are exported
      const issueGroupRows = parseSnapshotRows(sql, "issue_groups");
      expect(issueGroupRows.length).toBeGreaterThan(0);

      // Verify tables without FK constraints are all independently sampled
      expect(countSnapshotRows(sql, "patterns")).toBeGreaterThan(0);
      expect(countSnapshotRows(sql, "session_rules")).toBeGreaterThan(0);
      expect(countSnapshotRows(sql, "feedback_rules")).toBeGreaterThan(0);
      expect(countSnapshotRows(sql, "insight_reports")).toBeGreaterThan(0);
    });

    it("should detect PII in project_access.email", async () => {
      const name = trackConnector("test-bugster-pii");
      await createConnector(BUGSTER_DB_URL, { name });

      const meta = loadMetadata(name);
      expect(meta.piiColumnsDetected).toBeGreaterThan(0);

      const piiColumns = meta.analysis.patterns.piiColumns.map(
        (p) => `${p.table}.${p.column}`,
      );
      expect(piiColumns).toContain("project_access.email");

      // Since sanitization is on by default, emails should be replaced
      const sql = readSnapshotSQL(name);
      const accessRows = parseSnapshotRows(sql, "project_access");
      const emails = accessRows.map((r) => unquote(r.email));

      expect(emails).not.toContain("alice.fakerson@example.com");
      expect(emails).not.toContain("bob.testington@example.com");
    });
  });

  describe("full copy on complex schema", () => {
    it("should copy all rows from every table exactly", async () => {
      const name = trackConnector("test-bugster-full");
      const result = await createConnector(BUGSTER_DB_URL, {
        name,
        full: true,
        noSanitize: true,
      });

      const meta = loadMetadata(name);
      // Infinity becomes null in JSON serialization
      expect(meta.samplingConfig.maxRowsPerTable).toBeNull();

      const sql = readSnapshotSQL(name);

      expect(countSnapshotRows(sql, "projects")).toBe(5);
      expect(countSnapshotRows(sql, "project_access")).toBe(7);
      expect(countSnapshotRows(sql, "project_context")).toBe(3);
      expect(countSnapshotRows(sql, "project_credentials")).toBe(5);
      expect(countSnapshotRows(sql, "analysis_runs")).toBe(6);
      expect(countSnapshotRows(sql, "issue_groups")).toBe(7);
      expect(countSnapshotRows(sql, "issues")).toBe(8);
      expect(countSnapshotRows(sql, "patterns")).toBe(4);
      expect(countSnapshotRows(sql, "pattern_occurrences")).toBe(4);
      expect(countSnapshotRows(sql, "session_summaries")).toBe(5);
      expect(countSnapshotRows(sql, "event_session_summaries")).toBe(4);
      expect(countSnapshotRows(sql, "session_rules")).toBe(5);
      expect(countSnapshotRows(sql, "feedback_rules")).toBe(4);
      expect(countSnapshotRows(sql, "insight_reports")).toBe(3);
      expect(countSnapshotRows(sql, "integrations")).toBe(4);
      expect(countSnapshotRows(sql, "detector_run_metrics")).toBe(5);
      expect(countSnapshotRows(sql, "session_processing_logs")).toBe(4);
      expect(countSnapshotRows(sql, "pending_issues")).toBe(4);

      expect(result.rows).toBe(meta.rows);
    });
  });
});
