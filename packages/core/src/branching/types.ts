import type { AnalysisResult, SamplingConfig, SanitizationConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Branch — an isolated database managed by a provider (Docker, Supabase, etc.)
// ---------------------------------------------------------------------------

export interface Branch {
  name: string;
  connector: string;
  /** Which provider manages this branch (e.g. "docker", "supabase"). */
  provider: string;
  /** Provider-specific metadata (container IDs, Supabase URLs, etc.). */
  providerMeta: Record<string, unknown>;
  port: number;
  status: BranchStatus;
  createdAt: string;
  connectionString: string;
  /** Test account emails created in auth.users (useful for any auth provider). */
  testEmails?: string[];
}

export type BranchStatus = "running" | "stopped" | "creating" | "error";

export interface BranchOptions {
  port?: number;
  pgVersion?: string;
}

// ---------------------------------------------------------------------------
// Connector — a saved snapshot from a production DB
// ---------------------------------------------------------------------------

export interface AuthUserMapping {
  id: string;
  email: string;
  sanitizedEmail: string;
}

export interface ConnectorMetadata {
  name: string;
  connectionString: string;
  createdAt: string;
  updatedAt: string;
  tables: number;
  rows: number;
  sizeBytes: number;
  piiColumnsDetected: number;
  samplingConfig: SamplingConfig;
  sanitizationConfig: SanitizationConfig;
  analysis: AnalysisResult;
  /** Auth user mappings for Supabase projects (original UUID -> sanitized email). */
  authUsers?: AuthUserMapping[];
}

export interface ConnectorInfo {
  name: string;
  tables: number;
  rows: number;
  sizeBytes: number;
  createdAt: string;
}

export interface ConnectorCreateOptions {
  name?: string;
  maxRowsPerTable?: number;
  excludeTables?: string[];
  noSanitize?: boolean;
  seed?: number;
  /** Copy all rows instead of sampling. Overrides maxRowsPerTable. */
  full?: boolean;
}

export interface ConnectorCreateResult {
  name: string;
  tables: number;
  rows: number;
  piiColumnsDetected: number;
  sizeBytes: number;
  snapshotPath: string;
}

// ---------------------------------------------------------------------------
// Diff — changes in a branch since creation
// ---------------------------------------------------------------------------

export interface DiffResult {
  tables: TableDiff[];
  schemaChanges: SchemaChange[];
  hasChanges: boolean;
}

export interface TableDiff {
  name: string;
  rowsAdded: number;
  rowsDeleted: number;
  rowsModified: number;
  originalCount: number;
  currentCount: number;
}

export interface SchemaChange {
  type: "table_added" | "table_removed" | "column_added" | "column_removed" | "column_modified";
  table: string;
  column?: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Checkpoints — point-in-time snapshots within a branch
// ---------------------------------------------------------------------------

export interface CheckpointInfo {
  name: string;
  createdAt: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// branches.json schema
// ---------------------------------------------------------------------------

export interface BranchesFile {
  branches: Branch[];
}
