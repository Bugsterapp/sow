/**
 * Check if a URL is a valid Postgres connection string.
 * Accepts standard protocols (postgresql://, postgres://) and
 * SQLAlchemy dialect variants (postgresql+asyncpg://, postgresql+psycopg2://, etc.)
 */
export function isValidPostgresUrl(url: string): boolean {
  try {
    const normalized = normalizePostgresUrl(url);
    const parsed = new URL(normalized);
    return parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
  } catch {
    return false;
  }
}

/**
 * Strip SQLAlchemy dialect suffixes (e.g. postgresql+asyncpg:// → postgresql://)
 * so the URL can be used with standard Postgres drivers.
 */
export function normalizePostgresUrl(url: string): string {
  return url.replace(/^(postgres(?:ql)?)\+\w+:\/\//, "$1://");
}
