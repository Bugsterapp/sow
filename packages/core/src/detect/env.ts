import type { DetectedConnection } from "./types.js";
import { POSTGRES_ENV_VARS } from "./types.js";
import { isValidPostgresUrl } from "./validate.js";

export function detectFromEnv(): DetectedConnection[] {
  const results: DetectedConnection[] = [];
  const seen = new Set<string>();

  for (const varName of POSTGRES_ENV_VARS) {
    const value = process.env[varName];
    if (value && isValidPostgresUrl(value)) {
      seen.add(varName);
      results.push({
        source: "Environment variable",
        sourceFile: `process.env.${varName}`,
        envVar: varName,
        connectionString: value,
        confidence: "high",
      });
    }
  }

  // Wildcard: catch any other env var with a postgres:// value
  for (const [key, value] of Object.entries(process.env)) {
    if (seen.has(key)) continue;
    if (value && isValidPostgresUrl(value)) {
      results.push({
        source: "Environment variable",
        sourceFile: `process.env.${key}`,
        envVar: key,
        connectionString: value,
        confidence: "high",
      });
    }
  }

  return results;
}
