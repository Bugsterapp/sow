import { createSanitizer, SanitizationAbort } from "./index.js";
import type { SampledTable, TableInfo, SanitizationConfig } from "../types.js";

function col(name: string, type: string) {
  return { name, type, nullable: true, defaultValue: null, maxLength: null, isGenerated: false };
}

function makeTable(name: string, columns: ReturnType<typeof col>[]): TableInfo {
  return { name, schema: "public", columns, primaryKey: [], constraints: [] };
}

function baseConfig(overrides: Partial<SanitizationConfig> = {}): SanitizationConfig {
  return { enabled: true, rules: [], skipColumns: [], ...overrides };
}

describe("sanitizer fail-closed gate", () => {
  it("throws SanitizationAbort when an unknown type is encountered by default", () => {
    const tables = [makeTable("events", [col("id", "int4"), col("payload", "pg_lsn")])];
    const sampled: SampledTable[] = [
      { table: "events", rows: [{ id: 1, payload: "0/3000000" }], totalRowsInSource: 1, edgeCasesIncluded: [] },
    ];
    const sanitizer = createSanitizer({ config: baseConfig(), tables });
    expect(() => sanitizer.sanitize(sampled)).toThrow(SanitizationAbort);
  });

  it("error message lists each unhandled column with its pg type", () => {
    const tables = [
      makeTable("events", [col("props", "hstore")]),
      makeTable("users", [col("role", "user_role_unknown")]),
    ];
    const sampled: SampledTable[] = [
      { table: "events", rows: [{ props: "a=>1" }], totalRowsInSource: 1, edgeCasesIncluded: [] },
      { table: "users", rows: [{ role: "admin" }], totalRowsInSource: 1, edgeCasesIncluded: [] },
    ];
    const sanitizer = createSanitizer({ config: baseConfig(), tables });
    let err: SanitizationAbort | null = null;
    try {
      sanitizer.sanitize(sampled);
    } catch (e) {
      err = e as SanitizationAbort;
    }
    expect(err).toBeInstanceOf(SanitizationAbort);
    expect(err!.message).toContain("events.props");
    expect(err!.message).toContain("hstore");
    expect(err!.message).toContain("users.role");
    expect(err!.message).toContain("user_role_unknown");
    expect(err!.unhandledColumns).toHaveLength(2);
    expect(err!.message).toContain("--allow-unsafe");
  });

  it("does not throw when allowUnsafe=true and NULLs the offending columns", () => {
    const tables = [makeTable("events", [col("id", "int4"), col("payload", "pg_lsn")])];
    const sampled: SampledTable[] = [
      {
        table: "events",
        rows: [
          { id: 1, payload: "0/3000000" },
          { id: 2, payload: "0/4000000" },
        ],
        totalRowsInSource: 2,
        edgeCasesIncluded: [],
      },
    ];
    const sanitizer = createSanitizer({
      config: baseConfig({ allowUnsafe: true }),
      tables,
    });
    const result = sanitizer.sanitize(sampled);
    expect(result.tables[0].rows[0].payload).toBeNull();
    expect(result.tables[0].rows[1].payload).toBeNull();
    expect(result.tables[0].rows[0].id).toBe(1);
    expect(result.unhandledColumns).toHaveLength(1);
    expect(result.warnings && result.warnings.length).toBeGreaterThan(0);
  });

  it("explicit config rule takes precedence over type detection (gate skips it)", () => {
    const tables = [makeTable("events", [col("weird", "pg_lsn")])];
    const sampled: SampledTable[] = [
      { table: "events", rows: [{ weird: "0/3000000" }], totalRowsInSource: 1, edgeCasesIncluded: [] },
    ];
    const sanitizer = createSanitizer({
      config: baseConfig({
        rules: [{ table: "events", column: "weird", type: "free_text" }],
      }),
      tables,
    });
    const result = sanitizer.sanitize(sampled);
    // No throw, no unhandled, the rule was applied.
    expect(result.unhandledColumns).toEqual([]);
    expect(result.tables[0].rows[0].weird).not.toBe("0/3000000");
  });

  it("known Postgres types (int4, timestamp, bool, text, uuid) do not trip the gate", () => {
    const tables = [
      makeTable("users", [
        col("id", "int4"),
        col("created_at", "timestamp"),
        col("active", "bool"),
        col("bio", "text"),
        col("uid", "uuid"),
      ]),
    ];
    const sampled: SampledTable[] = [
      {
        table: "users",
        rows: [{ id: 1, created_at: new Date(), active: true, bio: "hello", uid: "11111111-1111-1111-1111-111111111111" }],
        totalRowsInSource: 1,
        edgeCasesIncluded: [],
      },
    ];
    const sanitizer = createSanitizer({ config: baseConfig(), tables });
    expect(() => sanitizer.sanitize(sampled)).not.toThrow();
  });

  it("custom enum types from analyzer are treated as safe", () => {
    const tables = [makeTable("users", [col("role", "user_role")])];
    const sampled: SampledTable[] = [
      { table: "users", rows: [{ role: "admin" }], totalRowsInSource: 1, edgeCasesIncluded: [] },
    ];
    const sanitizer = createSanitizer({
      config: baseConfig(),
      tables,
      enumTypes: [{ name: "user_role", schema: "public", values: ["admin", "user"] }],
    });
    const result = sanitizer.sanitize(sampled);
    expect(result.tables[0].rows[0].role).toBe("admin");
  });

  it("sanitizes a jsonb column end-to-end through createSanitizer", () => {
    const tables = [makeTable("audit", [col("id", "int4"), col("metadata", "jsonb")])];
    const sampled: SampledTable[] = [
      {
        table: "audit",
        rows: [{ id: 1, metadata: JSON.stringify({ email: "pii@leak.com", action: "login" }) }],
        totalRowsInSource: 1,
        edgeCasesIncluded: [],
      },
    ];
    const sanitizer = createSanitizer({ config: baseConfig(), tables });
    const result = sanitizer.sanitize(sampled);
    const out = JSON.parse(result.tables[0].rows[0].metadata as string);
    expect(out.action).toBe("login");
    expect(out.email).not.toBe("pii@leak.com");
    expect(out.email).toContain("@");
  });

  it("passes allowUnsafe config without errors when no unknown types exist", () => {
    const tables = [makeTable("users", [col("id", "int4")])];
    const sampled: SampledTable[] = [
      { table: "users", rows: [{ id: 1 }], totalRowsInSource: 1, edgeCasesIncluded: [] },
    ];
    const sanitizer = createSanitizer({
      config: baseConfig({ allowUnsafe: true }),
      tables,
    });
    const result = sanitizer.sanitize(sampled);
    expect(result.unhandledColumns).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
