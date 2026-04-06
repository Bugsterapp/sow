import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedConnection } from "./types.js";
import { isValidPostgresUrl } from "./validate.js";

const KNEX_CONFIG_FILES = ["knexfile.js", "knexfile.ts", "knexfile.mjs"];

const PG_CLIENT_RE = /client\s*:\s*["'](?:pg|postgresql)["']/;

// Matches: connection: "postgresql://..."
const LITERAL_CONN_RE =
  /connection\s*:\s*["'`](postgres(?:ql)?:\/\/[^"'`]+)["'`]/g;

// Matches: connection: process.env.VAR_NAME
const ENV_CONN_RE = /connection\s*:\s*process\.env\.(\w+)/g;

export function detectFromKnex(
  projectRoot: string,
  envMap: Record<string, string>,
): DetectedConnection[] {
  const results: DetectedConnection[] = [];

  for (const file of KNEX_CONFIG_FILES) {
    const filePath = join(projectRoot, file);
    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Only proceed if client is pg/postgresql
    if (!PG_CLIENT_RE.test(content)) continue;

    for (const match of content.matchAll(LITERAL_CONN_RE)) {
      const url = match[1];
      if (isValidPostgresUrl(url)) {
        results.push({
          source: "Knex config",
          sourceFile: file,
          connectionString: url,
          confidence: "medium",
        });
      }
    }

    for (const match of content.matchAll(ENV_CONN_RE)) {
      const varName = match[1];
      const value = process.env[varName] || envMap[varName];
      if (value && isValidPostgresUrl(value)) {
        results.push({
          source: "Knex config",
          sourceFile: file,
          envVar: varName,
          connectionString: value,
          confidence: "medium",
        });
      }
    }
  }

  return results;
}
