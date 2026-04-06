import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedConnection } from "./types.js";
import { POSTGRES_ENV_VARS, DOTENV_FILES, SUBDIRECTORY_ENV_PATHS } from "./types.js";
import { isValidPostgresUrl } from "./validate.js";
import { parseDotenv } from "./dotenv-parser.js";

export interface DotenvScanResult {
  connections: DetectedConnection[];
  /** Merged key-value map from all parsed .env files (for reuse by ORM detectors). */
  envMap: Record<string, string>;
}

export function detectFromDotenv(projectRoot: string): DotenvScanResult {
  const connections: DetectedConnection[] = [];
  const envMap: Record<string, string> = {};

  // Scan root .env files first, then common subdirectories
  const allFiles = [
    ...DOTENV_FILES,
    ...SUBDIRECTORY_ENV_PATHS,
  ];

  for (const file of allFiles) {
    const filePath = join(projectRoot, file);
    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const parsed = parseDotenv(content);

    // Later files override earlier ones
    Object.assign(envMap, parsed);

    const seen = new Set<string>();

    for (const varName of POSTGRES_ENV_VARS) {
      const value = parsed[varName];
      if (value && isValidPostgresUrl(value)) {
        seen.add(varName);
        connections.push({
          source: ".env file",
          sourceFile: file,
          envVar: varName,
          connectionString: value,
          confidence: "high",
        });
      }
    }

    // Wildcard: catch any other variable with a postgres:// value
    for (const [key, value] of Object.entries(parsed)) {
      if (seen.has(key)) continue;
      if (value && isValidPostgresUrl(value)) {
        connections.push({
          source: ".env file",
          sourceFile: file,
          envVar: key,
          connectionString: value,
          confidence: "high",
        });
      }
    }
  }

  return { connections, envMap };
}
