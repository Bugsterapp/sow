import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSQL } from "./sql.js";
import type { SchemaInfo, SanitizedTable } from "../types.js";

/**
 * Regression: enum-typed tables were silently dropped during
 * `sow branch create` because `columnDef` emitted enum types unquoted
 * (`source LeadSource`) while `CREATE TYPE` emitted them quoted
 * (`"LeadSource"`). Postgres folds the unquoted reference to lowercase
 * and errors `type "leadsource" does not exist`. Combined with the
 * best-effort restore (ON_ERROR_STOP=0) the failure was invisible.
 */
describe("exportSQL — enum case-sensitivity", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "sow-sql-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const schema: SchemaInfo = {
    enums: [
      {
        name: "LeadSource",
        schema: "public",
        values: ["WEBSITE", "REFERRAL", "AD"],
      },
    ],
    tables: [
      {
        name: "leads",
        schema: "public",
        primaryKey: ["id"],
        constraints: [],
        columns: [
          {
            name: "id",
            type: "int4",
            nullable: false,
            defaultValue: null,
            maxLength: null,
            isGenerated: false,
          },
          {
            name: "source",
            type: "LeadSource",
            nullable: false,
            defaultValue: null,
            maxLength: null,
            isGenerated: false,
          },
          {
            name: "tags",
            type: "LeadSource[]",
            nullable: true,
            defaultValue: null,
            maxLength: null,
            isGenerated: false,
          },
        ],
      },
    ],
    relationships: [],
    indexes: [],
    extensions: [],
  };

  const data: SanitizedTable[] = [
    {
      table: "leads",
      rows: [
        { id: 1, source: "WEBSITE", tags: null },
        { id: 2, source: "REFERRAL", tags: null },
      ],
    },
  ];

  it("quotes enum type names in column DDL", () => {
    exportSQL(schema, data, ["leads"], tmp);
    const sql = readFileSync(join(tmp, "sow.sql"), "utf-8");

    // The column must reference the enum with the same quoting that
    // CREATE TYPE used — otherwise Postgres folds the ident to lowercase.
    expect(sql).toContain('"source" "LeadSource"');
    // Array form preserves the [] suffix outside the quotes.
    expect(sql).toContain('"tags" "LeadSource"[]');
    // And the enum itself is still quoted on creation.
    expect(sql).toContain('CREATE TYPE "LeadSource"');
  });

  it("quotes enum literal values in INSERT statements", () => {
    exportSQL(schema, data, ["leads"], tmp);
    const sql = readFileSync(join(tmp, "sow.sql"), "utf-8");

    // Enum literals must be single-quoted — otherwise Postgres tries to
    // resolve `WEBSITE` as a bare identifier and errors.
    expect(sql).toContain("'WEBSITE'");
    expect(sql).toContain("'REFERRAL'");
    // And crucially, they must NOT appear as bare identifiers.
    expect(sql).not.toMatch(/VALUES\s*\([^)]*,\s*WEBSITE[,\s)]/);
  });

  it("does not quote built-in Postgres types", () => {
    exportSQL(schema, data, ["leads"], tmp);
    const sql = readFileSync(join(tmp, "sow.sql"), "utf-8");

    // `int4` is a built-in — must stay unquoted.
    expect(sql).toContain('"id" int4');
    expect(sql).not.toContain('"int4"');
  });
});
