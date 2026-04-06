import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { DetectedConnection } from "./types.js";

const COMPOSE_FILES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

function resolveVarRefs(
  value: string,
  envMap: Record<string, string>,
): string {
  return value.replace(/\$\{(\w+)(?::-[^}]*)?\}/g, (_, name) => {
    return process.env[name] || envMap[name] || "";
  });
}

/**
 * Normalize Docker Compose environment to a key-value object.
 * Handles both object format ({ KEY: "value" }) and array format (["KEY=value"]).
 */
function normalizeEnv(env: unknown): Record<string, string> {
  if (Array.isArray(env)) {
    const result: Record<string, string> = {};
    for (const item of env) {
      const str = String(item);
      const eq = str.indexOf("=");
      if (eq !== -1) result[str.slice(0, eq)] = str.slice(eq + 1);
    }
    return result;
  }
  return (env as Record<string, string>) || {};
}

export function detectFromDocker(
  projectRoot: string,
  envMap: Record<string, string>,
): DetectedConnection[] {
  const results: DetectedConnection[] = [];

  for (const file of COMPOSE_FILES) {
    const filePath = join(projectRoot, file);
    if (!existsSync(filePath)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    let compose: any;
    try {
      compose = YAML.parse(content);
    } catch {
      continue;
    }

    if (!compose?.services) continue;

    for (const [, service] of Object.entries(compose.services)) {
      const svc = service as any;
      const image = String(svc.image || "");

      if (!image.startsWith("postgres")) continue;

      const env = normalizeEnv(svc.environment);
      const user = resolveVarRefs(String(env.POSTGRES_USER || "postgres"), envMap);
      const pass = resolveVarRefs(String(env.POSTGRES_PASSWORD || "postgres"), envMap);
      const db = resolveVarRefs(String(env.POSTGRES_DB || user), envMap);

      // Find host port from ports mapping
      let port = "5432";
      if (Array.isArray(svc.ports)) {
        for (const p of svc.ports) {
          const portStr = String(p);
          if (portStr.includes(":")) {
            const hostPort = portStr.split(":")[0];
            // Handle "0.0.0.0:5432:5432" format
            port = hostPort.includes(".") ? portStr.split(":")[1] : hostPort;
          }
        }
      }

      const connStr = `postgresql://${user}:${pass}@localhost:${port}/${db}`;

      results.push({
        source: "Docker Compose",
        sourceFile: file,
        connectionString: connStr,
        confidence: "low",
        dockerStart: {
          image,
          env: { POSTGRES_USER: user, POSTGRES_PASSWORD: pass, POSTGRES_DB: db },
          port,
        },
      });
    }
  }

  return results;
}
