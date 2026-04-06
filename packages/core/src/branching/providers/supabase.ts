import type {
  BranchProvider,
  ProviderDetection,
  ProviderBranchOpts,
  ProviderBranchResult,
  ProviderSnapshotData,
} from "../provider.js";
import type { Branch, BranchStatus, AuthUserMapping } from "../types.js";
import type { DatabaseAdapter, SanitizedTable } from "../../types.js";
import {
  detectSupabaseLocal,
  loadIntoSupabase,
  createTestAuthUsers,
  cleanSupabaseBranch,
} from "../supabase.js";
import { transformValue } from "../../sanitizer/transformer.js";

/** Supabase provider metadata stored in Branch.providerMeta. */
export interface SupabaseProviderMeta {
  supabaseUrl: string;
  anonKey: string;
  publishableKey: string;
}

const USER_ID_COLUMNS = new Set([
  "user_id", "owner_id", "created_by", "author_id", "updated_by",
  "deleted_by", "assigned_to", "reviewer_id", "member_id",
]);

function extractUserIds(tables: { rows: Record<string, unknown>[] }[]): string[] {
  const ids = new Set<string>();
  for (const table of tables) {
    if (table.rows.length === 0) continue;
    const userCols = Object.keys(table.rows[0]).filter((col) =>
      USER_ID_COLUMNS.has(col),
    );
    for (const row of table.rows) {
      for (const col of userCols) {
        const val = row[col];
        if (typeof val === "string" && val.length > 10) {
          ids.add(val);
        }
      }
    }
  }
  return Array.from(ids);
}

async function fetchAuthUserMappings(
  adapter: DatabaseAdapter,
  userIds: string[],
): Promise<AuthUserMapping[]> {
  if (userIds.length === 0) return [];
  try {
    const idList = userIds.map((id) => `'${id}'`).join(",");
    const rows = await adapter.query<{ id: string; email: string }>(
      `SELECT id::text, email FROM auth.users WHERE id IN (${idList})`,
    );
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      sanitizedEmail: transformValue(row.email, "email") as string,
    }));
  } catch {
    return [];
  }
}

export class SupabaseBranchProvider implements BranchProvider {
  readonly name = "supabase";

  async detect(): Promise<ProviderDetection | null> {
    const info = await detectSupabaseLocal();
    if (!info) return null;
    return {
      meta: {
        dbUrl: info.dbUrl,
        apiUrl: info.apiUrl,
        anonKey: info.anonKey,
        publishableKey: info.publishableKey,
        dbPort: info.dbPort,
      },
    };
  }

  async createBranch(opts: ProviderBranchOpts): Promise<ProviderBranchResult> {
    const det = opts.detection.meta as {
      dbUrl: string;
      apiUrl: string;
      anonKey: string;
      publishableKey: string;
      dbPort: number;
    };

    await loadIntoSupabase(opts.initSqlPath, det.dbUrl);

    const testEmails = await createTestAuthUsers(det.dbUrl, opts.authMappings);

    return {
      connectionString: det.dbUrl,
      port: det.dbPort,
      providerMeta: {
        supabaseUrl: det.apiUrl,
        anonKey: det.anonKey,
        publishableKey: det.publishableKey,
      } satisfies SupabaseProviderMeta,
      testEmails,
    };
  }

  async deleteBranch(branch: Branch): Promise<void> {
    await cleanSupabaseBranch(branch.connectionString);
  }

  async resetBranch(branch: Branch, initSqlPath: string): Promise<void> {
    await loadIntoSupabase(initSqlPath, branch.connectionString);
    await createTestAuthUsers(branch.connectionString);
  }

  async execSQL(branch: Branch, sqlStr: string): Promise<string> {
    const pg = (await import("postgres")).default;
    const sql = pg(branch.connectionString, { max: 1, connect_timeout: 10, onnotice: () => {} });
    try {
      const rows = await sql.unsafe(sqlStr);
      if (rows.length === 0) return "";
      const cols = Object.keys(rows[0]);
      const header = cols.join(" | ");
      const separator = cols.map((c) => "-".repeat(c.length)).join("-+-");
      const lines = rows.map((r: any) => cols.map((c) => String(r[c] ?? "")).join(" | "));
      return [header, separator, ...lines].join("\n");
    } finally {
      await sql.end();
    }
  }

  async getBranchStatus(_branch: Branch): Promise<BranchStatus> {
    const info = await detectSupabaseLocal();
    return info ? "running" : "error";
  }

  async postSnapshot(
    adapter: DatabaseAdapter,
    tables: SanitizedTable[],
  ): Promise<ProviderSnapshotData> {
    const userIds = extractUserIds(tables);
    const authUsers = await fetchAuthUserMappings(adapter, userIds);
    return authUsers.length > 0 ? { authUsers } : {};
  }
}
