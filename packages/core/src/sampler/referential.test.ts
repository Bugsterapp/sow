import { ensureReferentialIntegrity } from "./referential.js";
import { quoteIdent } from "../sql/identifiers.js";
import type {
  DatabaseAdapter,
  Relationship,
  SchemaInfo,
  TableStats,
  ColumnStats,
  ConnectionInfo,
} from "../types.js";

// -----------------------------------------------------------------------
// quoteIdent — SQL identifier safety
// -----------------------------------------------------------------------

describe("quoteIdent", () => {
  it("wraps a simple identifier in double quotes", () => {
    expect(quoteIdent("users")).toBe('"users"');
  });

  it("wraps a column name with underscores", () => {
    expect(quoteIdent("created_at")).toBe('"created_at"');
  });

  it("doubles embedded double quotes to escape them", () => {
    // An identifier containing " must become ""
    expect(quoteIdent('weird"name')).toBe('"weird""name"');
  });

  it("handles multiple embedded quotes", () => {
    expect(quoteIdent('a"b"c')).toBe('"a""b""c"');
  });

  it("handles an identifier that is itself quoted (defense in depth)", () => {
    // A catalog row that accidentally includes a semicolon or SQL keywords
    // cannot break out of the quoted identifier.
    expect(quoteIdent('users"; DROP TABLE users; --')).toBe(
      '"users""; DROP TABLE users; --"',
    );
  });

  it("throws on empty string (would produce an invalid identifier)", () => {
    expect(() => quoteIdent("")).toThrow(/cannot be empty/);
  });

  it("throws on NUL byte (libpq rejects these at a distant layer)", () => {
    expect(() => quoteIdent("users\0evil")).toThrow(/NUL byte/);
  });
});

// -----------------------------------------------------------------------
// SpyAdapter — records every query call so tests can assert SQL shape
// -----------------------------------------------------------------------

interface QueryCall {
  sql: string;
  params?: unknown[];
}

class SpyAdapter implements DatabaseAdapter {
  calls: QueryCall[] = [];
  // Rows keyed by targetTable; returned from query() when the table is hit.
  responses: Map<string, Record<string, unknown>[]> = new Map();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async getSchema(): Promise<SchemaInfo> {
    return { tables: [], constraints: [], relationships: [], indexes: [], enumTypes: [] };
  }
  async getTableStats(): Promise<TableStats> {
    return { table: "", rowCount: 0, sizeBytes: 0, columns: [] };
  }
  async getColumnStats(): Promise<ColumnStats> {
    return {
      column: "",
      dataType: "",
      nullable: false,
      nullCount: 0,
      distinctCount: 0,
      sampleValues: [],
    };
  }
  async getSampleRows(): Promise<Record<string, unknown>[]> {
    return [];
  }
  async getAllRows(): Promise<Record<string, unknown>[]> {
    return [];
  }
  async getRandomSample(): Promise<Record<string, unknown>[]> {
    return [];
  }
  async getRowCount(): Promise<number> {
    return 0;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    this.calls.push({ sql, params: params ? [...params] : undefined });
    // Route by the FROM clause — find any response whose key appears in the SQL.
    for (const [key, rows] of this.responses) {
      if (sql.includes(`"${key}"`)) {
        return rows as T[];
      }
    }
    return [];
  }

  getConnectionInfo(): ConnectionInfo {
    return {
      host: "localhost",
      port: 5432,
      database: "test",
      user: "test",
    };
  }
}

// -----------------------------------------------------------------------
// Regression tests — SQL injection safety in ensureReferentialIntegrity
// -----------------------------------------------------------------------

describe("ensureReferentialIntegrity — SQL parameterization", () => {
  it("binds text primary keys with embedded single quotes via $1 placeholders (regression: O'Brien crash)", async () => {
    // The child table `orders` references a user whose PK contains a single
    // quote. Pre-fix, the SQL was built with raw interpolation:
    //   SELECT * FROM "users" WHERE "id" = 'O'Brien'  <- parse error
    // The catch{} swallowed the error silently and the parent row was dropped.
    // Post-fix, the value flows through $1 and the query is valid.
    const adapter = new SpyAdapter();
    adapter.responses.set("users", [
      { id: "O'Brien", name: "Sean" },
    ]);

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      // Seed users with an unrelated row so the loop body actually runs
      // (it early-returns when either side is empty). The row referenced
      // by orders (O'Brien) is missing and must be fetched.
      ["users", [{ id: "other-user", name: "Existing" }]],
      ["orders", [{ id: 1, user_id: "O'Brien" }]],
    ]);

    const relationships: Relationship[] = [
      {
        name: "orders_user_id_fkey",
        sourceTable: "orders",
        sourceColumns: ["user_id"],
        targetTable: "users",
        targetColumns: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      },
    ];

    const result = await ensureReferentialIntegrity(
      adapter,
      sampledTables,
      relationships,
    );

    // The missing-parent fetch must have been issued. Find it.
    const parentFetch = adapter.calls.find(
      (c) =>
        c.sql.includes('FROM "users"') &&
        c.sql.includes('"id" = $1'),
    );
    expect(parentFetch).toBeDefined();

    // The value must appear in params, NOT in the SQL string.
    expect(parentFetch!.params).toEqual(["O'Brien"]);
    expect(parentFetch!.sql).not.toContain("O'Brien");

    // And the user row must have landed in the result, proving the query
    // actually succeeded (the old behavior silently dropped it).
    const users = result.get("users") || [];
    expect(users.some((u) => u.id === "O'Brien")).toBe(true);
  });

  it("uses placeholders not string interpolation for composite foreign keys", async () => {
    const adapter = new SpyAdapter();
    adapter.responses.set("composite_parent", [
      { tenant_id: "t1", entity_id: "e1", data: "ok" },
    ]);

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      // Seed composite_parent with an unrelated row so the loop runs;
      // the (t1, e1) key is missing and triggers the fetch path.
      [
        "composite_parent",
        [{ tenant_id: "other", entity_id: "other", data: "seed" }],
      ],
      [
        "composite_child",
        [{ id: 1, p_tenant: "t1", p_entity: "e1" }],
      ],
    ]);

    const relationships: Relationship[] = [
      {
        name: "composite_fk",
        sourceTable: "composite_child",
        sourceColumns: ["p_tenant", "p_entity"],
        targetTable: "composite_parent",
        targetColumns: ["tenant_id", "entity_id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      },
    ];

    await ensureReferentialIntegrity(adapter, sampledTables, relationships);

    const parentFetch = adapter.calls.find((c) =>
      c.sql.includes('FROM "composite_parent"'),
    );
    expect(parentFetch).toBeDefined();
    // Two placeholders, one per column
    expect(parentFetch!.sql).toContain('"tenant_id" = $1');
    expect(parentFetch!.sql).toContain('"entity_id" = $2');
    expect(parentFetch!.params).toEqual(["t1", "e1"]);
  });

  it("does not interpolate raw values into the SQL text (defense against crafted payloads)", async () => {
    // If a source DB had a hostile primary key like "'; DROP TABLE x; --"
    // the pre-fix code would execute it. Post-fix, it must flow through
    // params where it is inert text.
    const adapter = new SpyAdapter();
    const hostile = "'; DROP TABLE users; --";
    adapter.responses.set("targets", [{ id: hostile, ok: true }]);

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      // Seed targets with an unrelated row so the loop runs.
      ["targets", [{ id: "benign", ok: true }]],
      ["refs", [{ id: 1, target_id: hostile }]],
    ]);

    const relationships: Relationship[] = [
      {
        name: "refs_target_fkey",
        sourceTable: "refs",
        sourceColumns: ["target_id"],
        targetTable: "targets",
        targetColumns: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      },
    ];

    await ensureReferentialIntegrity(adapter, sampledTables, relationships);

    const parentFetch = adapter.calls.find((c) =>
      c.sql.includes('FROM "targets"'),
    );
    expect(parentFetch).toBeDefined();
    // The hostile payload must NEVER appear inline in the SQL string.
    expect(parentFetch!.sql).not.toContain("DROP TABLE");
    expect(parentFetch!.sql).not.toContain(hostile);
    // It flows through params verbatim, where Postgres will treat it as
    // a literal string value, not executable SQL.
    expect(parentFetch!.params).toEqual([hostile]);
  });
});
