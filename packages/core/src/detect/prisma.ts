import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DetectedConnection } from "./types.js";
import { isValidPostgresUrl } from "./validate.js";

interface PrismaDetectResult {
  connections: DetectedConnection[];
  warnings: string[];
}

function resolveEnvRef(
  envExpr: string,
  envMap: Record<string, string>,
): string | undefined {
  const match = envExpr.match(/env\(\s*"([^"]+)"\s*\)/);
  if (!match) return undefined;
  const varName = match[1];
  return process.env[varName] || envMap[varName] || undefined;
}

function parseDatasourceBlock(content: string): {
  provider?: string;
  url?: string;
  directUrl?: string;
  urlEnvVar?: string;
  directUrlEnvVar?: string;
} {
  const dsMatch = content.match(
    /datasource\s+\w+\s*\{([^}]+)\}/s,
  );
  if (!dsMatch) return {};

  const block = dsMatch[1];

  const providerMatch = block.match(
    /provider\s*=\s*"([^"]+)"/,
  );
  const urlMatch = block.match(
    /(?<!\w)url\s*=\s*(env\(\s*"[^"]+"\s*\)|"[^"]+")/,
  );
  const directUrlMatch = block.match(
    /directUrl\s*=\s*(env\(\s*"[^"]+"\s*\)|"[^"]+")/,
  );

  const result: ReturnType<typeof parseDatasourceBlock> = {
    provider: providerMatch?.[1],
  };

  if (urlMatch) {
    const val = urlMatch[1];
    if (val.startsWith("env(")) {
      result.urlEnvVar = val.match(/env\(\s*"([^"]+)"\s*\)/)?.[1];
    } else {
      result.url = val.slice(1, -1);
    }
  }

  if (directUrlMatch) {
    const val = directUrlMatch[1];
    if (val.startsWith("env(")) {
      result.directUrlEnvVar = val.match(/env\(\s*"([^"]+)"\s*\)/)?.[1];
    } else {
      result.directUrl = val.slice(1, -1);
    }
  }

  return result;
}

export function detectFromPrisma(
  projectRoot: string,
  envMap: Record<string, string>,
): PrismaDetectResult {
  const connections: DetectedConnection[] = [];
  const warnings: string[] = [];

  const schemaPaths: string[] = [];
  const singleFile = join(projectRoot, "prisma", "schema.prisma");
  if (existsSync(singleFile)) {
    schemaPaths.push(singleFile);
  }

  // Multi-file schema: prisma/schema/*.prisma
  const multiDir = join(projectRoot, "prisma", "schema");
  if (existsSync(multiDir)) {
    try {
      const files = readdirSync(multiDir).filter((f) => f.endsWith(".prisma"));
      for (const f of files) {
        schemaPaths.push(join(multiDir, f));
      }
    } catch {
      // ignore read errors
    }
  }

  if (schemaPaths.length === 0) return { connections, warnings };

  for (const schemaPath of schemaPaths) {
    let content: string;
    try {
      content = readFileSync(schemaPath, "utf-8");
    } catch {
      continue;
    }

    const ds = parseDatasourceBlock(content);
    if (!ds.provider && !ds.url && !ds.urlEnvVar) continue;

    const relPath = schemaPath.startsWith(projectRoot)
      ? schemaPath.slice(projectRoot.length + 1)
      : schemaPath;

    if (ds.provider && ds.provider !== "postgresql" && ds.provider !== "postgres") {
      warnings.push(
        `Detected Prisma but provider is "${ds.provider}" (only PostgreSQL is supported)`,
      );
      continue;
    }

    // Prefer directUrl (unpooled) over url
    const candidates: { value?: string; envVar?: string; label: string }[] = [];
    if (ds.directUrl || ds.directUrlEnvVar) {
      candidates.push({
        value: ds.directUrl,
        envVar: ds.directUrlEnvVar,
        label: "directUrl",
      });
    }
    if (ds.url || ds.urlEnvVar) {
      candidates.push({
        value: ds.url,
        envVar: ds.urlEnvVar,
        label: "url",
      });
    }

    let found = false;
    for (const candidate of candidates) {
      let connStr: string | undefined;
      let envVar: string | undefined;

      if (candidate.value) {
        connStr = candidate.value;
      } else if (candidate.envVar) {
        envVar = candidate.envVar;
        connStr = resolveEnvRef(`env("${candidate.envVar}")`, envMap);

        if (!connStr) {
          warnings.push(
            `Prisma schema references ${candidate.envVar} but no value found in .env or environment`,
          );
        }
      }

      if (connStr && isValidPostgresUrl(connStr)) {
        connections.push({
          source: "Prisma schema",
          sourceFile: relPath,
          envVar,
          connectionString: connStr,
          confidence: "medium",
        });
        found = true;
        break;
      }
    }

    if (!found && candidates.length > 0 && ds.provider === "postgresql") {
      // We know it's a Postgres project but couldn't resolve a URL
    }
  }

  return { connections, warnings };
}
