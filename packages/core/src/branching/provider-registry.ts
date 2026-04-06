import type { BranchProvider, ProviderDetection } from "./provider.js";
import { SupabaseBranchProvider } from "./providers/supabase.js";
import { DockerBranchProvider } from "./providers/docker.js";

/**
 * All registered providers, checked in order.
 * Supabase is checked first: if `supabase start` is running, branches load
 * into local Supabase. Otherwise, Docker is the fallback.
 *
 * To add a provider: instantiate it here and insert at the desired priority.
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
 */
export async function resolveProvider(): Promise<ResolvedProvider> {
  for (const provider of providers) {
    const detection = await provider.detect();
    if (detection) {
      return { provider, detection };
    }
  }
  throw new Error(
    "No provider available. Install Docker (https://docs.docker.com/get-docker/) " +
    "or run `supabase start` for local Supabase.",
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
