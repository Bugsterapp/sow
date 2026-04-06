import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedConnection } from "./types.js";
import { isValidPostgresUrl } from "./validate.js";

const DRIZZLE_CONFIG_FILES = [
  "drizzle.config.ts",
  "drizzle.config.js",
  "drizzle.config.mjs",
];

// Matches: connectionString: "postgresql://...", url: "postgresql://..."
const LITERAL_URL_RE =
  /(?:connectionString|url)\s*:\s*["'`](postgres(?:ql)?:\/\/[^"'`]+)["'`]/g;

// Matches: connectionString: process.env.VAR_NAME, url: process.env.VAR_NAME
const ENV_REF_RE =
  /(?:connectionString|url)\s*:\s*process\.env\.(\w+)/g;

export function detectFromDrizzle(
  projectRoot: string,
  envMap: Record<string, string>,
): DetectedConnection[] {
  const results: DetectedConnection[] = [];

  for (const file of DRIZZLE_CONFIG_FILES) {
    const filePath = join(projectRoot, file);
    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Look for literal connection strings
    for (const match of content.matchAll(LITERAL_URL_RE)) {
      const url = match[1];
      if (isValidPostgresUrl(url)) {
        results.push({
          source: "Drizzle config",
          sourceFile: file,
          connectionString: url,
          confidence: "medium",
        });
      }
    }

    // Look for process.env references
    for (const match of content.matchAll(ENV_REF_RE)) {
      const varName = match[1];
      const value = process.env[varName] || envMap[varName];
      if (value && isValidPostgresUrl(value)) {
        results.push({
          source: "Drizzle config",
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
