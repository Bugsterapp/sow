import type { DetectedProvider } from "./types.js";

function getEnv(
  key: string,
  envMap: Record<string, string>,
): string | undefined {
  return process.env[key] || envMap[key] || undefined;
}

function extractSupabaseRef(url: string): string | undefined {
  const match = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  return match?.[1];
}

export function detectProviders(
  envMap: Record<string, string>,
): DetectedProvider[] {
  const providers: DetectedProvider[] = [];

  // Supabase
  const supabaseUrl =
    getEnv("SUPABASE_URL", envMap) ||
    getEnv("NEXT_PUBLIC_SUPABASE_URL", envMap);
  const supabaseKey =
    getEnv("SUPABASE_SERVICE_ROLE_KEY", envMap) ||
    getEnv("SUPABASE_KEY", envMap) ||
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", envMap) ||
    getEnv("SUPABASE_ANON_KEY", envMap) ||
    getEnv("SUPABASE_PUBLISHABLE_KEY", envMap) ||
    getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", envMap);

  if (supabaseUrl || supabaseKey) {
    const ref = supabaseUrl ? extractSupabaseRef(supabaseUrl) : undefined;
    providers.push({
      name: "supabase",
      projectRef: ref,
      guidance: [
        "Go to supabase.com/dashboard → your project → Connect",
        'Copy the URI from "Connection string" section (Session mode, port 5432)',
        "Paste it below",
      ],
    });
  }

  // Neon
  const neonKey =
    getEnv("NEON_API_KEY", envMap) ||
    getEnv("NEXT_PUBLIC_NEON_HOST", envMap);

  if (neonKey) {
    providers.push({
      name: "neon",
      guidance: [
        "Go to neon.tech/console → your project → Connection Details",
        "Copy the connection string (starts with postgresql://)",
        "Paste it below",
      ],
    });
  }

  // Vercel Postgres
  const vercelPg =
    getEnv("POSTGRES_URL_NON_POOLING", envMap) ||
    getEnv("POSTGRES_PRISMA_URL", envMap);

  if (vercelPg) {
    providers.push({
      name: "vercel-postgres",
      guidance: [
        "Go to vercel.com/dashboard → your project → Storage → your database",
        "Copy the POSTGRES_URL_NON_POOLING connection string",
        "Paste it below",
      ],
    });
  }

  // Railway
  const railwayEnv =
    getEnv("RAILWAY_PROJECT_ID", envMap) ||
    getEnv("RAILWAY_ENVIRONMENT_ID", envMap);

  if (railwayEnv) {
    providers.push({
      name: "railway",
      guidance: [
        "Go to railway.com → your project → Postgres service → Connect",
        "Copy the DATABASE_URL connection string",
        "Paste it below",
      ],
    });
  }

  return providers;
}
