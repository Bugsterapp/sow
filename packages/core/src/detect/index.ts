export type { DetectedConnection, DetectedProvider, DetectionResult } from "./types.js";
export { isValidPostgresUrl, normalizePostgresUrl } from "./validate.js";

import type { DetectedConnection, DetectionResult } from "./types.js";
import { detectFromEnv } from "./env.js";
import { detectFromDotenv } from "./dotenv.js";
import { detectFromPrisma } from "./prisma.js";
import { detectFromDrizzle } from "./drizzle.js";
import { detectFromKnex } from "./knex.js";
import { detectFromTypeorm } from "./typeorm.js";
import { detectFromSequelize } from "./sequelize.js";
import { detectFromSupabase } from "./supabase.js";
import { detectFromDocker } from "./docker.js";
import { detectFromDependencies } from "./deps.js";
import { detectProviders } from "./providers.js";

const CONFIDENCE_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Deduplicate connections by connectionString, keeping the highest-confidence entry.
 */
function dedup(connections: DetectedConnection[]): DetectedConnection[] {
  const map = new Map<string, DetectedConnection>();

  for (const conn of connections) {
    const existing = map.get(conn.connectionString);
    if (
      !existing ||
      CONFIDENCE_ORDER[conn.confidence] < CONFIDENCE_ORDER[existing.confidence]
    ) {
      map.set(conn.connectionString, conn);
    }
  }

  return Array.from(map.values());
}

/**
 * Scan the project directory for PostgreSQL connection strings.
 * Checks environment variables, .env files, ORM configs (Prisma, Drizzle, Knex,
 * TypeORM, Sequelize), Supabase local, Docker Compose, and package.json dependencies.
 */
export function detectConnection(projectRoot: string): DetectionResult {
  const allConnections: DetectedConnection[] = [];
  const warnings: string[] = [];

  // 1. Environment variables (process.env)
  allConnections.push(...detectFromEnv());

  // 2. .env files — also returns the merged envMap for ORM resolution
  const dotenvResult = detectFromDotenv(projectRoot);
  allConnections.push(...dotenvResult.connections);
  const envMap = dotenvResult.envMap;

  // 3. Prisma schema
  const prismaResult = detectFromPrisma(projectRoot, envMap);
  allConnections.push(...prismaResult.connections);
  warnings.push(...prismaResult.warnings);

  // 4. Drizzle config
  allConnections.push(...detectFromDrizzle(projectRoot, envMap));

  // 5. Knex config
  allConnections.push(...detectFromKnex(projectRoot, envMap));

  // 6. TypeORM config
  allConnections.push(...detectFromTypeorm(projectRoot, envMap));

  // 7. Sequelize config
  allConnections.push(...detectFromSequelize(projectRoot, envMap));

  // 8. Supabase local dev
  allConnections.push(...detectFromSupabase(projectRoot));

  // 9. Docker Compose
  allConnections.push(...detectFromDocker(projectRoot, envMap));

  // 10. Provider detection (Supabase, Neon, etc. from API keys/env vars)
  const providers = detectProviders(envMap);

  // Collect detected source names + provider names to inform dep hints
  const detectedSources = new Set([
    ...allConnections.map((c) => c.source),
    ...providers.map((p) => p.name),
  ]);

  // 11. package.json dependency hints (no connection strings)
  const hints = detectFromDependencies(projectRoot, detectedSources);

  // Deduplicate and sort by confidence
  const connections = dedup(allConnections).sort(
    (a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence],
  );

  return { connections, providers, hints, warnings };
}
