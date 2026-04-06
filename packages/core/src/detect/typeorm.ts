import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedConnection } from "./types.js";
import { isValidPostgresUrl } from "./validate.js";

const TYPEORM_CONFIG_FILES = [
  "ormconfig.json",
  "ormconfig.js",
  "ormconfig.ts",
  "data-source.ts",
  "data-source.js",
  "src/data-source.ts",
  "src/data-source.js",
];

const PG_TYPE_RE = /type\s*:\s*["']postgres(?:ql)?["']/;

// url: "postgresql://..." or url: 'postgresql://...'
const LITERAL_URL_RE =
  /url\s*:\s*["'`](postgres(?:ql)?:\/\/[^"'`]+)["'`]/g;

// url: process.env.VAR_NAME
const ENV_URL_RE = /url\s*:\s*process\.env\.(\w+)/g;

export function detectFromTypeorm(
  projectRoot: string,
  envMap: Record<string, string>,
): DetectedConnection[] {
  const results: DetectedConnection[] = [];

  for (const file of TYPEORM_CONFIG_FILES) {
    const filePath = join(projectRoot, file);
    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // For JSON files, try structured parsing
    if (file.endsWith(".json")) {
      try {
        const config = JSON.parse(content);
        const configs = Array.isArray(config) ? config : [config];
        for (const cfg of configs) {
          if (cfg.type !== "postgres" && cfg.type !== "postgresql") continue;

          if (cfg.url && isValidPostgresUrl(cfg.url)) {
            results.push({
              source: "TypeORM config",
              sourceFile: file,
              connectionString: cfg.url,
              confidence: "medium",
            });
          } else if (cfg.host) {
            const url = `postgresql://${cfg.username || "postgres"}:${cfg.password || ""}@${cfg.host}:${cfg.port || 5432}/${cfg.database || "postgres"}`;
            if (isValidPostgresUrl(url)) {
              results.push({
                source: "TypeORM config",
                sourceFile: file,
                connectionString: url,
                confidence: "medium",
              });
            }
          }
        }
      } catch {
        // Invalid JSON, fall through to regex
      }
      continue;
    }

    // For TS/JS files, regex scan
    if (!PG_TYPE_RE.test(content)) continue;

    for (const match of content.matchAll(LITERAL_URL_RE)) {
      const url = match[1];
      if (isValidPostgresUrl(url)) {
        results.push({
          source: "TypeORM config",
          sourceFile: file,
          connectionString: url,
          confidence: "medium",
        });
      }
    }

    for (const match of content.matchAll(ENV_URL_RE)) {
      const varName = match[1];
      const value = process.env[varName] || envMap[varName];
      if (value && isValidPostgresUrl(value)) {
        results.push({
          source: "TypeORM config",
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
