import type { BranchProvider, ProviderDetection, DetectionContext } from "./provider.js";
import { SupabaseBranchProvider } from "./providers/supabase.js";
import { DockerBranchProvider } from "./providers/docker.js";

/**
 * All registered providers, checked in order.
 *
 * **Supabase is checked FIRST, Docker is the fallback.** This ordering
 * looks dangerous but is safe because of how the two providers gate
 * their `detect()` calls:
 *
 *   - **Supabase** has three independent hard gates (see
 *     `providers/supabase.ts`). ALL three must pass for detect() to
 *     return non-null:
 *       1. The cwd must contain `supabase/config.toml` (i.e. it IS a
 *          Supabase-CLI project, not just any directory next to one).
 *       2. The caller must have passed `destructiveConsent: true`
 *          (explicit opt-in via `--yes-destructive-supabase` or the
 *          `.sow.yml` field `providers.supabase.destructive_consent`).
 *       3. Local Supabase Postgres must actually be reachable.
 *     If ANY gate fails, Supabase detect() returns null and we fall
 *     through to Docker.
 *
 *   - **Docker** has no gating: if the Docker daemon is up, it always
 *     matches. Which means Docker can only win when Supabase has
 *     deliberately declined (any gate failed) — exactly the shape we
 *     want.
 *
 * The historical bug where running `sow sandbox` in an unrelated
 * project destroyed the user's active Supabase project's public
 * schema is closed by Supabase gate 1 alone (the cwd check). Gates
 * 2 and 3 are belt + suspenders. Docker-as-fallback is third-belt.
 *
 * Rationale for Supabase-first despite being the destructive one:
 * the whole point of the Supabase provider is "the user is ACTIVELY
 * and EXPLICITLY opting in to using their local Supabase as the
 * sandbox." If we put Docker first, the opt-in would be unreachable
 * because Docker's detect() is unconditionally true whenever the
 * daemon is running. Putting Supabase first is the only way the
 * opt-in actually works, and the three gates make it safe.
 *
 * To add a provider: instantiate it here and insert at the desired
 * priority. Providers with destructive-by-default behavior must gate
 * activation behind explicit consent in their `detect()` method.
 */
const providers: BranchProvider[] = [
  new SupabaseBranchProvider(),
  new DockerBranchProvider(),
];

export interface ResolvedProvider {
  provider: BranchProvider;
  detection: ProviderDetection;
}

/**
 * Auto-detect the best available provider.
 * Tries each registered provider in order and returns the first match.
 *
 * The `ctx` parameter carries project context (cwd, consent flags) used
 * by providers to decide whether they should activate. When omitted, a
 * safe default context is synthesized (cwd = process.cwd(), no consent).
 */
export async function resolveProvider(
  ctx?: DetectionContext,
): Promise<ResolvedProvider> {
  const effectiveCtx: DetectionContext = {
    cwd: ctx?.cwd ?? process.cwd(),
    destructiveConsent: ctx?.destructiveConsent ?? false,
  };
  for (const provider of providers) {
    const detection = await provider.detect(effectiveCtx);
    if (detection) {
      return { provider, detection };
    }
  }
  throw new Error(
    "No provider available. Install Docker (https://docs.docker.com/get-docker/) " +
    "and make sure the daemon is running.",
  );
}

/**
 * Look up a provider by name (used when loading a branch from storage).
 */
export function getProvider(name: string): BranchProvider {
  const p = providers.find((p) => p.name === name);
  if (!p) {
    throw new Error(
      `Unknown provider '${name}'. Registered providers: ${providers.map((p) => p.name).join(", ")}`,
    );
  }
  return p;
}

/** List all registered provider names. */
export function listProviderNames(): string[] {
  return providers.map((p) => p.name);
}
