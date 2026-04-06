export interface DetectedConnection {
  source: string;
  sourceFile: string;
  envVar?: string;
  connectionString: string;
  confidence: "high" | "medium" | "low";
  /** For Docker Compose sources: the docker run command to start the container. */
  dockerStart?: { image: string; env: Record<string, string>; port: string };
}

export interface DetectedProvider {
  name: string;
  projectRef?: string;
  guidance: string[];
}

export interface DetectionResult {
  connections: DetectedConnection[];
  providers: DetectedProvider[];
  hints: string[];
  warnings: string[];
}

export const POSTGRES_ENV_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_CONNECTION_STRING",
  "PG_CONNECTION_STRING",
  "DB_URL",
  "DB_CONNECTION_STRING",
  "SUPABASE_DB_URL",
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_DATABASE_URL",
] as const;

export const DOTENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
] as const;

/** Common subdirectories to also scan for .env files in monorepos. */
export const SUBDIRECTORY_ENV_PATHS = [
  "backend/.env",
  "backend/.env.local",
  "server/.env",
  "server/.env.local",
  "api/.env",
  "api/.env.local",
  "app/.env",
  "app/.env.local",
  "src/.env",
  "src/.env.local",
] as const;
