import type { Branch, BranchStatus } from "./types.js";
import type { DatabaseAdapter, SanitizedTable } from "../types.js";
import type { AuthUserMapping } from "./types.js";

/**
 * Context passed to a provider's detect() call.
 * Providers use this to gate on project-local signals (e.g. the presence
 * of a `supabase/` directory) rather than only machine-wide ones.
 */
export interface DetectionContext {
  /** The project root being operated on. Defaults to process.cwd(). */
  cwd: string;
  /**
   * If true, the user explicitly opted into any destructive provider
   * behavior (e.g. DROP SCHEMA on a shared local Supabase). Providers
   * that have a destructive path MUST refuse to activate when this is
   * false and the path would be destructive.
   */
  destructiveConsent?: boolean;
}

/**
 * Result of a provider's detect() call.
 * If non-null, the provider is available and can create branches.
 */
export interface ProviderDetection {
  /** Provider-specific connection/config info passed to createBranch. */
  meta: Record<string, unknown>;
}

/** Options passed from the manager to a provider when creating a branch. */
export interface ProviderBranchOpts {
  name: string;
  connector: string;
  initSqlPath: string;
  port?: number;
  pgVersion?: string;
  /** Auth user mappings from the connector snapshot (if available). */
  authMappings?: { id: string; email: string }[];
  /** Detection result from this provider's detect() call. */
  detection: ProviderDetection;
}

/** Result returned by a provider after creating a branch. */
export interface ProviderBranchResult {
  connectionString: string;
  port: number;
  /** Provider-specific metadata stored on the Branch object. */
  providerMeta: Record<string, unknown>;
  /** Test account emails (e.g. Supabase auth users). */
  testEmails?: string[];
}

/**
 * Extra data a provider can extract during `sow connect` (snapshot time).
 * For example, Supabase extracts auth.users mappings.
 */
export interface ProviderSnapshotData {
  authUsers?: AuthUserMapping[];
}

/**
 * A BranchProvider handles the lifecycle of database branches
 * for a specific backend (Docker, Supabase local, Neon, etc.).
 *
 * Providers are registered in the provider registry and auto-detected
 * in priority order. The first provider whose detect() returns non-null
 * is used.
 *
 * To add a new provider, implement this interface and register it in
 * `provider-registry.ts`. See CONTRIBUTING.md for a walkthrough.
 */
export interface BranchProvider {
  /** Unique identifier for this provider (e.g. "docker", "supabase"). */
  readonly name: string;

  /**
   * Check whether this provider is available in the current environment
   * and appropriate for the current project. Returns detection info if
   * available, null otherwise.
   *
   * Providers with destructive-by-default behavior (e.g. Supabase, which
   * drops the `public` schema of the target DB) MUST gate on both:
   *   1. Project-local signals (e.g. `supabase/config.toml` in ctx.cwd)
   *   2. `ctx.destructiveConsent === true`
   *
   * Examples:
   * - Docker provider checks `docker info` (non-destructive; cwd ignored)
   * - Supabase provider checks `supabase status` AND `isSupabaseProject(ctx.cwd)`
   *   AND `ctx.destructiveConsent === true`
   */
  detect(ctx?: DetectionContext): Promise<ProviderDetection | null>;

  /**
   * Create a new branch with the given options.
   * Called after detect() succeeds.
   */
  createBranch(opts: ProviderBranchOpts): Promise<ProviderBranchResult>;

  /**
   * Delete a branch and clean up resources (containers, schemas, etc.).
   */
  deleteBranch(branch: Branch): Promise<void>;

  /**
   * Reset a branch to its original snapshot state.
   */
  resetBranch(branch: Branch, initSqlPath: string): Promise<void>;

  /**
   * Execute arbitrary SQL against a branch.
   * Returns formatted output (table-style text).
   */
  execSQL(branch: Branch, sql: string): Promise<string>;

  /**
   * Query the actual status of a branch's backing resource.
   * Used to sync persisted state with reality.
   */
  getBranchStatus(branch: Branch): Promise<BranchStatus>;

  /**
   * Stop a branch to save resources (optional — not all providers support this).
   * Throws if the provider doesn't support stop/start.
   */
  stopBranch?(branch: Branch): Promise<void>;

  /**
   * Start a previously stopped branch (optional).
   */
  startBranch?(branch: Branch): Promise<void>;

  /**
   * Dump branch state as SQL (for checkpoints). Optional.
   */
  dumpBranch?(branch: Branch): Promise<string>;

  /**
   * Restore branch from a SQL dump (for checkpoint loading). Optional.
   */
  restoreDump?(branch: Branch, sql: string): Promise<void>;

  /**
   * Extract provider-specific data during `sow connect`.
   * Called after sampling/sanitization, before the snapshot is saved.
   * For example, Supabase uses this to fetch auth.users mappings.
   */
  postSnapshot?(
    adapter: DatabaseAdapter,
    tables: SanitizedTable[],
  ): Promise<ProviderSnapshotData>;
}
