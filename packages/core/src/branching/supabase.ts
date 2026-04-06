import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import postgres from "postgres";
import { quoteIdent } from "../sql/identifiers.js";

const SUPABASE_DB_PORT = 54322;
const SUPABASE_API_PORT = 54321;

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
 * Load a SQL file into the local Supabase Postgres, replacing the public schema.
 */
export async function loadIntoSupabase(
  initSqlPath: string,
  dbUrl: string,
): Promise<void> {
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

    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      try {
        await sql.unsafe(stmt);
      } catch {
        // Skip bad statements (e.g., broken JSON in sanitized data)
      }
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
      const quotedTable = quoteIdent(tableName);
      try {
        // Parameterize the value `tableName` in information_schema lookups.
        // Identifiers (the policy name, the qualified table reference) are
        // quoted via quoteIdent because SQL binds values only, not names.
        const cols = await sql.unsafe(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name IN ('user_id', 'owner_id', 'created_by')",
          [tableName] as unknown as Parameters<typeof sql.unsafe>[1],
        );

        await sql.unsafe(`ALTER TABLE public.${quotedTable} ENABLE ROW LEVEL SECURITY`);

        if (cols.length > 0) {
          const userCol = cols[0].column_name as string;
          const quotedUserCol = quoteIdent(userCol);
          await sql.unsafe(
            `CREATE POLICY "sow_owner" ON public.${quotedTable} FOR ALL USING (${quotedUserCol} = auth.uid())`,
          );
        } else {
          const hasProjId = await sql.unsafe(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'project_id' LIMIT 1",
            [tableName] as unknown as Parameters<typeof sql.unsafe>[1],
          );

          if (hasProjId.length > 0) {
            await sql.unsafe(
              `CREATE POLICY "sow_project" ON public.${quotedTable} FOR ALL USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))`,
            );
          } else {
            await sql.unsafe(
              `CREATE POLICY "sow_open" ON public.${quotedTable} FOR ALL USING (auth.role() = 'authenticated')`,
            );
          }
        }
      } catch {
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
