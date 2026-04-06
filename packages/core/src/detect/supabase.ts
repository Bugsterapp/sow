import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedConnection } from "./types.js";

/**
 * Detect Supabase CLI local dev projects.
 * Supabase CLI creates supabase/config.toml with a [db] section.
 * Local Supabase always uses postgres:postgres@localhost:<port>/postgres.
 */
export function detectFromSupabase(
  projectRoot: string,
): DetectedConnection[] {
  const configPath = join(projectRoot, "supabase", "config.toml");
  if (!existsSync(configPath)) return [];

  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    return [];
  }

  // Minimal TOML parsing: find [db] section and extract port
  const dbSectionMatch = content.match(/\[db\]([\s\S]*?)(?=\n\[|$)/);
  if (!dbSectionMatch) return [];

  const dbSection = dbSectionMatch[1];
  const portMatch = dbSection.match(/port\s*=\s*(\d+)/);
  const port = portMatch ? portMatch[1] : "54322";

  return [{
    source: "Supabase local",
    sourceFile: "supabase/config.toml",
    connectionString: `postgresql://postgres:postgres@localhost:${port}/postgres`,
    confidence: "medium",
  }];
}
