import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface DepHint {
  label: string;
  hint: string;
  /** If set, skip this hint when the named source was already detected. */
  skipIfDetected?: string;
}

const PG_PACKAGES: Record<string, DepHint> = {
  pg: {
    label: "pg",
    hint: "Found pg driver — set DATABASE_URL=postgresql://... in .env",
  },
  postgres: {
    label: "postgres.js",
    hint: "Found postgres.js driver — set DATABASE_URL=postgresql://... in .env",
  },
  "@neondatabase/serverless": {
    label: "@neondatabase/serverless",
    hint: "Found Neon — get your connection string from neon.tech/console",
    skipIfDetected: "neon",
  },
  "@prisma/client": {
    label: "@prisma/client",
    hint: "Found @prisma/client — run `npx prisma init` or check prisma/schema.prisma",
    skipIfDetected: "Prisma schema",
  },
  "drizzle-orm": {
    label: "drizzle-orm",
    hint: "Found drizzle-orm — create drizzle.config.ts with your connection string",
    skipIfDetected: "Drizzle config",
  },
  knex: {
    label: "knex",
    hint: "Found knex — add a knexfile with client: 'pg' and your connection string",
    skipIfDetected: "Knex config",
  },
  typeorm: {
    label: "typeorm",
    hint: "Found typeorm — add ormconfig.json or data-source.ts with type: 'postgres'",
    skipIfDetected: "TypeORM config",
  },
  sequelize: {
    label: "sequelize",
    hint: "Found sequelize — add config/config.json with dialect: 'postgres'",
    skipIfDetected: "Sequelize config",
  },
  "@supabase/supabase-js": {
    label: "@supabase/supabase-js",
    hint: "Found Supabase — get your direct connection string from supabase.com/dashboard → Settings → Database",
    skipIfDetected: "supabase",
  },
};

/**
 * Scan package.json for Postgres-related packages.
 * @param detectedSources - source names that were already detected (e.g. "Prisma schema"),
 *   used to suppress redundant hints.
 */
export function detectFromDependencies(
  projectRoot: string,
  detectedSources: Set<string> = new Set(),
): string[] {
  const hints: string[] = [];
  const pkgPath = join(projectRoot, "package.json");

  if (!existsSync(pkgPath)) return hints;

  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return hints;
  }

  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  for (const [name, info] of Object.entries(PG_PACKAGES)) {
    if (!allDeps[name]) continue;
    if (info.skipIfDetected && detectedSources.has(info.skipIfDetected)) continue;
    hints.push(info.hint);
  }

  return hints;
}
