import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import postgres from "postgres";
import { quoteIdent } from "../sql/identifiers.js";

const SUPABASE_DB_PORT = 54322;
const SUPABASE_API_PORT = 54321;

/**
 * Is the given directory a Supabase-CLI-managed project?
 *
 * We check for `supabase/config.toml` (the file the Supabase CLI
 * creates on `supabase init`). A bare `supabase/` directory is not
 * enough — some projects have that name for unrelated reasons.
 *
 * This check is the FIRST of three gates the Supabase branch provider
 * uses before doing anything destructive. See provider-registry.ts
 * and providers/supabase.ts for the other two.
 */
export function isSupabaseProject(cwd: string): boolean {
  try {
    const configPath = join(cwd, "supabase", "config.toml");
    if (!existsSync(configPath)) return false;
    const s = statSync(configPath);
    return s.isFile();
  } catch {
    return false;
  }
}

export interface SupabaseLocalInfo {
  dbUrl: string;
  apiUrl: string;
  anonKey: string;
  publishableKey: string;
  dbPort: number;
}

function canConnect(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 2000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Detect if local Supabase is running.
 * Tries `supabase status` first, falls back to TCP connect on port 54322.
 */
export async function detectSupabaseLocal(): Promise<SupabaseLocalInfo | null> {
  // Try supabase status first (most reliable)
  try {
    const output = execSync("supabase status --output json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });

    const status = JSON.parse(output);
    if (status.DB_URL) {
      return {
        dbUrl: status.DB_URL,
        apiUrl: status.API_URL || `http://localhost:${SUPABASE_API_PORT}`,
        anonKey: status.ANON_KEY || "",
        publishableKey: status.PUBLISHABLE_KEY || "",
        dbPort: SUPABASE_DB_PORT,
      };
    }
  } catch {
    // supabase CLI not installed or not linked
  }

  // Fall back to TCP connect check on the default Supabase Postgres port
  const reachable = await canConnect(SUPABASE_DB_PORT);
  if (!reachable) return null;

  return {
    dbUrl: `postgresql://postgres:postgres@localhost:${SUPABASE_DB_PORT}/postgres`,
    apiUrl: `http://localhost:${SUPABASE_API_PORT}`,
    anonKey: "",
    publishableKey: "",
    dbPort: SUPABASE_DB_PORT,
  };
}

/**
 * Redact user:password from a Postgres URL for safe logging.
 * Keeps host/port/db so the user can identify WHICH Supabase is being
 * clobbered, but never leaks the credential.
 */
function redactDbUrl(dbUrl: string): string {
  try {
    const u = new URL(dbUrl);
    return `${u.protocol}//${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return "<unparseable url>";
  }
}

/**
 * Load a SQL file into the local Supabase Postgres, replacing the public
 * schema.
 *
 * This is a DESTRUCTIVE operation: it drops everything in the `public`
 * schema of the target DB. Callers must have passed all three gates in
 * SupabaseBranchProvider.detect() before reaching here. As a final
 * defense-in-depth measure, we print a prominent stderr warning naming
 * the exact target URL (credential-redacted) before the DROP runs.
 * If the user sees this warning and was NOT expecting it, something
 * upstream of this function is wrong — stop the process immediately
 * and file an issue.
 */
export async function loadIntoSupabase(
  initSqlPath: string,
  dbUrl: string,
): Promise<void> {
  // Audit-trail warning. Always printed, even with --yes or --json,
  // because the destructive action is worth announcing no matter what.
  // Writes to stderr so JSON consumers on stdout are unaffected.
  process.stderr.write(
    `\n  ⚠ Supabase branch provider: about to DROP schema public of ${redactDbUrl(dbUrl)}\n` +
    `    All tables in that schema will be replaced with sanitized sample data.\n` +
    `    (This is the opted-in Supabase branch flow. If you did not expect\n` +
    `     this, abort now with Ctrl+C and see docs/sandbox.md.)\n\n`,
  );

  const sql = postgres(dbUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });

  try {
    // Drop and recreate public schema (clean slate)
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO postgres");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO public");

    // Load the init.sql — run each statement separately so errors don't block
    const initSql = readFileSync(initSqlPath, "utf-8");
    const statements = splitStatements(initSql);

    // Classify each statement. DDL failures are fatal — a branch that
    // silently lost a CREATE TABLE is exactly the "trustworthy sandbox"
    // contract we must not break. DML (INSERT) failures are tolerated
    // because sanitized rows can legitimately fail a CHECK constraint,
    // but we count and report them so the user is never fooled into
    // thinking a silent load was a clean load.
    const isDdl = (stmt: string): boolean => {
      const head = stmt.trim().replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*/g, "").toUpperCase();
      return (
        head.startsWith("CREATE") ||
        head.startsWith("ALTER") ||
        head.startsWith("DROP") ||
        head.startsWith("DO ") ||
        head.startsWith("DO$") ||
        head.startsWith("GRANT") ||
        head.startsWith("REVOKE") ||
        head.startsWith("COMMENT") ||
        head.startsWith("TRUNCATE") ||
        head.startsWith("SELECT SETVAL")
      );
    };

    let dmlFailures = 0;
    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      try {
        await sql.unsafe(stmt);
      } catch (err) {
        if (isDdl(stmt)) {
          const preview = stmt.trim().slice(0, 160).replace(/\s+/g, " ");
          throw new Error(
            `Supabase restore failed on DDL statement: ${(err as Error).message}\n` +
              `  Statement: ${preview}${stmt.length > 160 ? "..." : ""}`,
          );
        }
        dmlFailures++;
      }
    }
    if (dmlFailures > 0) {
      process.stderr.write(
        `  ⚠ Supabase restore: ${dmlFailures} INSERT statement(s) failed and were skipped.\n` +
          `    This usually means sanitized data violated a CHECK constraint or\n` +
          `    row-level policy. Inspect the branch and consider re-running with\n` +
          `    adjusted sanitizer rules if row counts look off.\n`,
      );
    }

    // Grant access to Supabase roles
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO anon, authenticated");
    await sql.unsafe("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated");
    await sql.unsafe("GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated");

    // Set up RLS policies per table
    const tables = await sql.unsafe(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );

    for (const t of tables) {
      const tableName = t.tablename as string;
      // tableName comes from the sandbox DB's pg_catalog. Even though we
      // control the sandbox, a catalog row containing an unusual character
      // (e.g. a double quote from a quoted DDL identifier in the source
      // schema) must not break out of our identifier quoting.
      let quotedTable: string;
      let cols: { column_name: string }[];
      let hasProjId: unknown[] = [];

      // Per-table introspection. A transient failure here (connection blip,
      // catalog contention, quoteIdent rejecting a degenerate name) skips
      // this ONE table without affecting the others. Critically, this does
      // NOT disable RLS on failure — unconfigured tables remain locked
      // (fail-safe) rather than falling open. Callers that need write
      // access to a skipped table can retry via `sow branch reset`.
      try {
        quotedTable = quoteIdent(tableName);
        cols = (await sql.unsafe(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name IN ('user_id', 'owner_id', 'created_by')",
          [tableName] as unknown as Parameters<typeof sql.unsafe>[1],
        )) as { column_name: string }[];

        if (cols.length === 0) {
          hasProjId = await sql.unsafe(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'project_id' LIMIT 1",
            [tableName] as unknown as Parameters<typeof sql.unsafe>[1],
          );
        }
      } catch {
        // Introspection failed for this table — skip without touching RLS.
        // This is the fail-safe branch: if we can't read the shape, we
        // don't trust ourselves to configure access, and leaving RLS in
        // whatever state the restore put it in is safer than disabling.
        continue;
      }

      try {
        await sql.unsafe(`ALTER TABLE public.${quotedTable} ENABLE ROW LEVEL SECURITY`);

        if (cols.length > 0) {
          const userCol = cols[0].column_name;
          const quotedUserCol = quoteIdent(userCol);
          await sql.unsafe(
            `CREATE POLICY "sow_owner" ON public.${quotedTable} FOR ALL USING (${quotedUserCol} = auth.uid())`,
          );
        } else if (hasProjId.length > 0) {
          await sql.unsafe(
            `CREATE POLICY "sow_project" ON public.${quotedTable} FOR ALL USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))`,
          );
        } else {
          await sql.unsafe(
            `CREATE POLICY "sow_open" ON public.${quotedTable} FOR ALL USING (auth.role() = 'authenticated')`,
          );
        }
      } catch {
        // Policy creation failed (e.g. conflicting existing policy). Disable
        // RLS so the dev can still use the sandbox table. This is a
        // dev-sandbox fallback, not a production concession — branches are
        // sanitized and ephemeral.
        try {
          await sql.unsafe(`ALTER TABLE public.${quotedTable} DISABLE ROW LEVEL SECURITY`);
        } catch { /* ignore */ }
      }
    }
  } finally {
    await sql.end();
  }
}

/**
 * Split SQL file into individual statements.
 * Handles multi-line INSERT VALUES that contain semicolons inside strings.
 */
function splitStatements(content: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      current += ch;
      if (ch === stringChar && content[i - 1] !== "\\") {
        // Check for escaped quote ('' in SQL)
        if (ch === "'" && content[i + 1] === "'") {
          current += content[++i];
          continue;
        }
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }

    if (ch === "-" && content[i + 1] === "-") {
      // Line comment — skip to end of line
      const eol = content.indexOf("\n", i);
      if (eol === -1) break;
      i = eol;
      continue;
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);

  return statements;
}

export interface AuthUserInput {
  id: string;
  email: string;
}

/**
 * Create auth users in the local Supabase's auth schema.
 * If mappings are provided (from connector metadata), uses real UUIDs + sanitized emails.
 * Otherwise creates fallback test users.
 */
export async function createTestAuthUsers(
  dbUrl: string,
  mappings?: AuthUserInput[],
): Promise<string[]> {
  const users = mappings && mappings.length > 0
    ? mappings
    : [
        { id: "", email: "test@sow.dev" },
        { id: "", email: "admin@sow.dev" },
        { id: "", email: "user@sow.dev" },
      ];

  const sql = postgres(dbUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });

  try {
    for (const user of users) {
      try {
        // Remove existing entries for this ID or email to avoid conflicts.
        // user.id flows through $1 (cast server-side to uuid), not into
        // the SQL text. Empty/malformed ids raise a cast error which is
        // caught below, which is the intended behavior.
        if (user.id) {
          await sql.unsafe(
            "DELETE FROM auth.identities WHERE user_id = $1::uuid",
            [user.id] as unknown as Parameters<typeof sql.unsafe>[1],
          );
          await sql.unsafe(
            "DELETE FROM auth.users WHERE id = $1::uuid",
            [user.id] as unknown as Parameters<typeof sql.unsafe>[1],
          );
        }

        // When user.id is empty, we want `gen_random_uuid()` as the id.
        // That's SQL, not a value, so it cannot be parameterized directly.
        // Branch on whether we have an id: either bind $1::uuid, or use
        // the SQL function literal.
        if (user.id) {
          await sql.unsafe(
            `
            INSERT INTO auth.users (
              instance_id, id, aud, role, email, encrypted_password,
              email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
              created_at, updated_at, confirmation_token, email_change,
              email_change_token_new, recovery_token
            ) VALUES (
              '00000000-0000-0000-0000-000000000000',
              $1::uuid, 'authenticated', 'authenticated',
              $2,
              crypt('password123', gen_salt('bf')),
              now(),
              '{"provider":"email","providers":["email"]}',
              '{}',
              now(), now(), '', '', '', ''
            )
          `,
            [user.id, user.email] as unknown as Parameters<typeof sql.unsafe>[1],
          );
        } else {
          await sql.unsafe(
            `
            INSERT INTO auth.users (
              instance_id, id, aud, role, email, encrypted_password,
              email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
              created_at, updated_at, confirmation_token, email_change,
              email_change_token_new, recovery_token
            ) VALUES (
              '00000000-0000-0000-0000-000000000000',
              gen_random_uuid(), 'authenticated', 'authenticated',
              $1,
              crypt('password123', gen_salt('bf')),
              now(),
              '{"provider":"email","providers":["email"]}',
              '{}',
              now(), now(), '', '', '', ''
            )
          `,
            [user.email] as unknown as Parameters<typeof sql.unsafe>[1],
          );
        }

        // Create matching identity for login — bind the email value.
        await sql.unsafe(
          `
          INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
          SELECT gen_random_uuid(), id, id,
            format('{"sub":"%s","email":"%s"}', id::text, email)::jsonb,
            'email', now(), now(), now()
          FROM auth.users WHERE email = $1
        `,
          [user.email] as unknown as Parameters<typeof sql.unsafe>[1],
        );
      } catch {
        // Skip users that can't be created
      }
    }

    return users.map((u) => u.email);
  } finally {
    await sql.end();
  }
}

/**
 * Clean up sow data from local Supabase (for branch delete).
 */
export async function cleanSupabaseBranch(dbUrl: string): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });

  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO postgres");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO public");

    await sql.unsafe("DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@sow.dev')");
    await sql.unsafe("DELETE FROM auth.users WHERE email LIKE '%@sow.dev'");
  } finally {
    await sql.end();
  }
}
