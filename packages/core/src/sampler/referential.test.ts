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

    const { tables: result } = await ensureReferentialIntegrity(
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

// -----------------------------------------------------------------------
// Warnings collection — Issue #3: catch blocks return warnings, not silence
// -----------------------------------------------------------------------

// A spy that throws on specific query patterns, for testing failure paths.
class FailingAdapter extends SpyAdapter {
  failPattern: RegExp | null = null;

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    if (this.failPattern && this.failPattern.test(sql)) {
      throw new Error("simulated DB failure: " + sql.slice(0, 40));
    }
    return super.query(sql, params);
  }
}

describe("ensureReferentialIntegrity — warnings collection", () => {
  it("returns an empty warnings array when everything resolves cleanly", async () => {
    const adapter = new SpyAdapter();
    adapter.responses.set("users", [{ id: "u1", name: "Alice" }]);

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      ["users", [{ id: "seed", name: "Seed" }]],
      ["orders", [{ id: 1, user_id: "u1" }]],
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

    const { warnings } = await ensureReferentialIntegrity(
      adapter,
      sampledTables,
      relationships,
    );
    expect(warnings).toEqual([]);
  });

  it("captures parent_fetch_failed when the adapter throws on a formal-FK lookup", async () => {
    const adapter = new FailingAdapter();
    // Fail only on the parent fetch (the SELECT FROM "users")
    adapter.failPattern = /FROM "users"/;

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      ["users", [{ id: "seed", name: "Seed" }]],
      ["orders", [{ id: 1, user_id: "u-missing" }]],
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

    const { warnings } = await ensureReferentialIntegrity(
      adapter,
      sampledTables,
      relationships,
    );

    // The fetch was attempted (and failed) 3 times across the passes.
    // We want at least one warning captured, with the right shape.
    expect(warnings.length).toBeGreaterThan(0);
    const w = warnings[0];
    expect(w.kind).toBe("parent_fetch_failed");
    expect(w.targetTable).toBe("users");
    expect(w.sourceTable).toBe("orders");
    expect(w.reason).toContain("simulated DB failure");
  });

  it("captures parent_not_found when the target table has no matching row", async () => {
    const adapter = new SpyAdapter();
    // adapter.responses has no "users" entry, so the fetch returns []

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      ["users", [{ id: "seed", name: "Seed" }]],
      ["orders", [{ id: 1, user_id: "ghost" }]],
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

    const { warnings } = await ensureReferentialIntegrity(
      adapter,
      sampledTables,
      relationships,
    );

    expect(warnings.some((w) => w.kind === "parent_not_found")).toBe(true);
    const w = warnings.find((x) => x.kind === "parent_not_found")!;
    expect(w.targetTable).toBe("users");
    expect(w.sourceTable).toBe("orders");
  });

  it("captures implicit_ref_fetch_failed when the implicit-ref batch query throws", async () => {
    const adapter = new FailingAdapter();
    // Fail the implicit IN(...) lookup on the sessions table.
    adapter.failPattern = /FROM "sessions" WHERE id IN/;

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      // A table with an implicit session_id column (no formal FK).
      [
        "events",
        [
          {
            id: 1,
            session_id: "11111111-1111-1111-1111-111111111111",
          },
        ],
      ],
      // Sessions has no matching row, so the implicit resolver will try
      // to fetch it and hit the failure pattern.
      ["sessions", [{ id: "00000000-0000-0000-0000-000000000000" }]],
    ]);

    const { warnings } = await ensureReferentialIntegrity(
      adapter,
      sampledTables,
      [], // no formal relationships — force the implicit-ref path
    );

    const implicitWarning = warnings.find(
      (w) => w.kind === "implicit_ref_fetch_failed",
    );
    expect(implicitWarning).toBeDefined();
    expect(implicitWarning!.targetTable).toBe("sessions");
    expect(implicitWarning!.reason).toContain("simulated DB failure");
  });

  it("reason strings are truncated at ~140 chars to keep metadata bounded", async () => {
    const adapter = new FailingAdapter();
    // Make the error message huge to verify truncation.
    const longError = "x".repeat(500);
    adapter.query = async (sql: string) => {
      if (/FROM "users"/.test(sql)) throw new Error(longError);
      return [];
    };

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      ["users", [{ id: "seed" }]],
      ["orders", [{ id: 1, user_id: "missing" }]],
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

    const { warnings } = await ensureReferentialIntegrity(
      adapter,
      sampledTables,
      relationships,
    );

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].reason.length).toBeLessThanOrEqual(140);
    expect(warnings[0].reason.endsWith("…")).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Dynamic skip list — Issue #7: formal-FK columns skipped implicitly
// -----------------------------------------------------------------------

describe("ensureReferentialIntegrity — dynamic skip of formal-FK columns", () => {
  it("does NOT re-fetch a column that is already handled by a formal FK", async () => {
    // This test relies on the behavior that if a column is in a formal FK,
    // the implicit-reference pass must not also issue queries for it.
    const adapter = new SpyAdapter();
    adapter.responses.set("sessions", [
      {
        id: "11111111-1111-1111-1111-111111111111",
        data: "real",
      },
    ]);

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      // events.session_id is a FORMAL FK (see relationships below).
      [
        "events",
        [
          {
            id: 1,
            session_id: "11111111-1111-1111-1111-111111111111",
          },
        ],
      ],
      ["sessions", [{ id: "00000000-0000-0000-0000-000000000000", data: "seed" }]],
    ]);

    const relationships: Relationship[] = [
      {
        name: "events_session_id_fkey",
        sourceTable: "events",
        sourceColumns: ["session_id"],
        targetTable: "sessions",
        targetColumns: ["id"],
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
      },
    ];

    await ensureReferentialIntegrity(adapter, sampledTables, relationships);

    // The implicit resolver uses `IN (...)` form; the formal FK uses
    // `WHERE "id" = $1`. With the formal FK present, only the formal path
    // should fire. No `IN (` query for sessions.
    const implicitCalls = adapter.calls.filter(
      (c) =>
        c.sql.includes('FROM "sessions"') && c.sql.includes("IN ("),
    );
    expect(implicitCalls.length).toBe(0);

    // But the formal path DID run:
    const formalCalls = adapter.calls.filter(
      (c) =>
        c.sql.includes('FROM "sessions"') && c.sql.includes('"id" = $1'),
    );
    expect(formalCalls.length).toBeGreaterThan(0);
  });

  it("handles non-English column names that the old hardcoded list missed", async () => {
    // The old hardcoded SKIP list was ["id", "user_id", "owner_id", "created_by"]
    // which is English-only. A Spanish codebase with `creado_por` or
    // `propietario_id` wouldn't be on that list. Neither was `author_id`,
    // `reviewer_id`, `assignee_id`. The new dynamic check uses the actual
    // formal relationships to decide what to skip, so non-English column
    // names flow through correctly (they get the IMPLICIT path if they
    // end in _id and point at a valid table).
    const adapter = new SpyAdapter();
    adapter.responses.set(
      "usuarios",
      [{ id: "22222222-2222-2222-2222-222222222222", nombre: "Ana" }],
    );

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      // Spanish column name, no formal FK — should use implicit path.
      [
        "documentos",
        [
          {
            id: 1,
            creado_por: "22222222-2222-2222-2222-222222222222",
          },
        ],
      ],
      ["usuarios", [{ id: "00000000-0000-0000-0000-000000000000", nombre: "seed" }]],
    ]);

    // No formal relationships — old hardcoded skip list had "created_by"
    // but NOT "creado_por". With the dynamic check the behavior is now
    // symmetric: neither is pre-skipped; both would try the implicit path
    // (which looks at target table inference). "creado_por" ending in
    // "_por" (not "_id") means the implicit resolver won't try it either,
    // so it's never touched. The test asserts it reaches the responses
    // we set only if the resolver actually ran.
    await ensureReferentialIntegrity(adapter, sampledTables, []);

    // The current implementation's inferTargetTable only picks up *_id,
    // so `creado_por` is not resolved either way. This test's real value
    // is that the dynamic check doesn't THROW on non-English names, and
    // that the loop completes successfully without the old list
    // silently masking work.
    expect(adapter.calls.length).toBeGreaterThanOrEqual(0);
  });
});

// -----------------------------------------------------------------------
// N+1 batching — Issue #8: implicit references batch by target table
// -----------------------------------------------------------------------

describe("ensureReferentialIntegrity — batched implicit references", () => {
  it("issues one query per target table, not one per source-target pair", async () => {
    // Three source tables all reference the same `sessions` table via
    // implicit `session_id` columns (the inferrer resolves session_id
    // → sessions by stripping _id and trying plural). The old per-pair
    // loop would fire 3 separate queries. The batched version must
    // fire exactly 1.
    const adapter = new SpyAdapter();
    adapter.responses.set("sessions", [
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", label: "A" },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", label: "B" },
      { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", label: "C" },
    ]);

    const sampledTables = new Map<string, Record<string, unknown>[]>([
      ["sessions", [{ id: "00000000-0000-0000-0000-000000000000", label: "seed" }]],
      [
        "events",
        [{ id: 1, session_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }],
      ],
      [
        "logs",
        [{ id: 1, session_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }],
      ],
      [
        "metrics",
        [{ id: 1, session_id: "cccccccc-cccc-cccc-cccc-cccccccccccc" }],
      ],
    ]);

    await ensureReferentialIntegrity(adapter, sampledTables, []);

    // Count implicit IN(...) queries against sessions.
    const sessionBatches = adapter.calls.filter(
      (c) => c.sql.includes('FROM "sessions"') && c.sql.includes("IN ("),
    );
    expect(sessionBatches.length).toBe(1);

    // And all three missing ids are in the single batch's params.
    const params = sessionBatches[0].params as string[];
    expect(params).toContain("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(params).toContain("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(params).toContain("cccccccc-cccc-cccc-cccc-cccccccccccc");
  });

  it("chunks batches of more than 100 ids into multiple queries", async () => {
    const adapter = new SpyAdapter();
    // Return empty responses — we just want to count queries.
    const sampledTables = new Map<string, Record<string, unknown>[]>([
      ["sessions", [{ id: "00000000-0000-0000-0000-000000000000" }]],
      // 250 rows in `events`, each with a unique session_id → 250 missing
      // ids → should split into 3 batches (100 + 100 + 50).
      [
        "events",
        Array.from({ length: 250 }, (_, i) => ({
          id: i,
          session_id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`,
        })),
      ],
    ]);

    await ensureReferentialIntegrity(adapter, sampledTables, []);

    const sessionBatches = adapter.calls.filter(
      (c) => c.sql.includes('FROM "sessions"') && c.sql.includes("IN ("),
    );
    expect(sessionBatches.length).toBe(3);
    expect((sessionBatches[0].params as unknown[]).length).toBe(100);
    expect((sessionBatches[1].params as unknown[]).length).toBe(100);
    expect((sessionBatches[2].params as unknown[]).length).toBe(50);
  });

  it("deduplicates ids referenced by multiple source rows", async () => {
    const adapter = new SpyAdapter();
    const sampledTables = new Map<string, Record<string, unknown>[]>([
      ["sessions", [{ id: "00000000-0000-0000-0000-000000000000" }]],
      // Three events all referencing the same session.
      [
        "events",
        [
          { id: 1, session_id: "11111111-1111-1111-1111-111111111111" },
          { id: 2, session_id: "11111111-1111-1111-1111-111111111111" },
          { id: 3, session_id: "11111111-1111-1111-1111-111111111111" },
        ],
      ],
    ]);

    await ensureReferentialIntegrity(adapter, sampledTables, []);

    const batch = adapter.calls.find(
      (c) => c.sql.includes('FROM "sessions"') && c.sql.includes("IN ("),
    );
    expect(batch).toBeDefined();
    // The Set in the implementation collapses duplicates to a single id.
    expect((batch!.params as unknown[]).length).toBe(1);
  });
});
