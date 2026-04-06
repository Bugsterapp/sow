import { detectProviders } from "./providers.js";

describe("detectProviders", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns empty array when no env vars match", () => {
    expect(detectProviders({})).toEqual([]);
  });

  it("detects Supabase from SUPABASE_URL", () => {
    const providers = detectProviders({
      SUPABASE_URL: "https://abcdef.supabase.co",
    });
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("supabase");
    expect(providers[0].projectRef).toBe("abcdef");
    expect(providers[0].guidance.length).toBeGreaterThan(0);
  });

  it("detects Supabase from NEXT_PUBLIC_SUPABASE_URL", () => {
    const providers = detectProviders({
      NEXT_PUBLIC_SUPABASE_URL: "https://xyz123.supabase.co",
    });
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("supabase");
    expect(providers[0].projectRef).toBe("xyz123");
  });

  it("detects Supabase from key alone (no projectRef)", () => {
    const providers = detectProviders({ SUPABASE_ANON_KEY: "some-key" });
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("supabase");
    expect(providers[0].projectRef).toBeUndefined();
  });

  it("detects Neon from NEON_API_KEY", () => {
    const providers = detectProviders({ NEON_API_KEY: "neon-key-123" });
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("neon");
    expect(providers[0].guidance.length).toBeGreaterThan(0);
  });

  it("detects Vercel Postgres from POSTGRES_URL_NON_POOLING", () => {
    const providers = detectProviders({
      POSTGRES_URL_NON_POOLING: "postgres://user:pass@host/db",
    });
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("vercel-postgres");
  });

  it("detects Vercel Postgres from POSTGRES_PRISMA_URL", () => {
    const providers = detectProviders({
      POSTGRES_PRISMA_URL: "postgres://user:pass@host/db",
    });
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("vercel-postgres");
  });

  it("detects Railway from RAILWAY_PROJECT_ID", () => {
    const providers = detectProviders({ RAILWAY_PROJECT_ID: "proj-123" });
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("railway");
    expect(providers[0].guidance.length).toBeGreaterThan(0);
  });

  it("detects multiple providers simultaneously", () => {
    const providers = detectProviders({
      SUPABASE_URL: "https://abc.supabase.co",
      NEON_API_KEY: "neon-key",
      RAILWAY_PROJECT_ID: "proj-1",
    });
    const names = providers.map((p) => p.name);
    expect(names).toContain("supabase");
    expect(names).toContain("neon");
    expect(names).toContain("railway");
  });

  it("also detects via process.env", () => {
    process.env.RAILWAY_ENVIRONMENT_ID = "env-456";
    const providers = detectProviders({});
    expect(providers.some((p) => p.name === "railway")).toBe(true);
  });
});
