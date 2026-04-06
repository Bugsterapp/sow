import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedConnection } from "./types.js";
import { isValidPostgresUrl } from "./validate.js";

const SEQUELIZE_CONFIG_FILES = [
  "config/config.json",
  "config/database.json",
];

interface SequelizeEnvConfig {
  dialect?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  use_env_variable?: string;
}

export function detectFromSequelize(
  projectRoot: string,
  envMap: Record<string, string>,
): DetectedConnection[] {
  const results: DetectedConnection[] = [];

  for (const file of SEQUELIZE_CONFIG_FILES) {
    const filePath = join(projectRoot, file);
    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    let config: Record<string, SequelizeEnvConfig>;
    try {
      config = JSON.parse(content);
    } catch {
      continue;
    }

    // Check development, then test, then default keys
    const envKeys = ["development", "test"];
    for (const envKey of envKeys) {
      const cfg = config[envKey];
      if (!cfg) continue;
      if (cfg.dialect !== "postgres" && cfg.dialect !== "postgresql") continue;

      // use_env_variable takes priority
      if (cfg.use_env_variable) {
        const value = process.env[cfg.use_env_variable] || envMap[cfg.use_env_variable];
        if (value && isValidPostgresUrl(value)) {
          results.push({
            source: "Sequelize config",
            sourceFile: file,
            envVar: cfg.use_env_variable,
            connectionString: value,
            confidence: "medium",
          });
          return results;
        }
      }

      if (cfg.host) {
        const url = `postgresql://${cfg.username || "postgres"}:${cfg.password || ""}@${cfg.host}:${cfg.port || 5432}/${cfg.database || "postgres"}`;
        if (isValidPostgresUrl(url)) {
          results.push({
            source: "Sequelize config",
            sourceFile: file,
            connectionString: url,
            confidence: "medium",
          });
          return results;
        }
      }
    }
  }

  return results;
}
