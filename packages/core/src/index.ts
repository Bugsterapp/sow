export * from "./types.js";
export { ConnectionError, parseConnectionError } from "./errors.js";
export { PostgresAdapter } from "./adapters/postgres.js";
export { PostgresTypeMapper } from "./adapters/type-mapper.js";
export { analyze } from "./analyzer/index.js";
export type { AnalyzeOptions } from "./analyzer/index.js";
export { createSampler } from "./sampler/index.js";
export type { SamplerOptions } from "./sampler/index.js";
export { createSanitizer, SanitizationAbort } from "./sanitizer/index.js";
export type { SanitizerOptions } from "./sanitizer/index.js";
export { createExporter } from "./exporter/index.js";
export type { ExporterOptions } from "./exporter/index.js";
export { topologicalSort } from "./analyzer/relationships.js";
export { detectColumnPII, detectTablePII } from "./sanitizer/detector.js";
export { deterministicSeed } from "./sanitizer/consistency.js";
export {
  transformValue,
  transformRows,
  transformRowsAsync,
} from "./sanitizer/transformer.js";
export {
  loadProjectConfig,
  loadGlobalConfig,
  saveGlobalConfig,
  loadProjectState,
  saveProjectState,
  generateDefaultConfig,
  mergeConfig,
} from "./config/loader.js";
export type { ProjectState } from "./config/loader.js";
export { SowConfigSchema } from "./config/schema.js";
export type { SowConfigInput, SowConfigParsed } from "./config/schema.js";

// Branching
export {
  createBranch,
  listBranches,
  getBranchInfo,
  deleteBranch,
  stopBranch,
  startBranch,
  resetBranch,
  getDiff,
  saveBranch,
  loadBranch,
  listCheckpoints,
  execBranch,
  getBranchEnv,
  getBranchUsers,
  getBranchTables,
  getBranchSample,
  runWithBranchEnv,
  createConnector,
  listConnectors,
  deleteConnector,
  refreshConnector,
  getConnectorMetadata,
  resolveProvider,
  getProvider,
  listProviderNames,
  ensureDocker,
  findFreePort,
  getSowDir,
  findProjectRoot,
} from "./branching/index.js";

export type {
  Branch,
  BranchStatus,
  BranchOptions,
  ConnectorMetadata,
  ConnectorInfo,
  ConnectorCreateOptions,
  ConnectorCreateResult,
  DiffResult,
  TableDiff,
  SchemaChange,
  CheckpointInfo,
  BranchesFile,
  BranchUsersResult,
  BranchTableInfo,
  BranchProvider,
  ProviderDetection,
  ProviderBranchOpts,
  ProviderBranchResult,
  ProviderSnapshotData,
} from "./branching/index.js";

// Detection
export { detectConnection, isValidPostgresUrl, normalizePostgresUrl } from "./detect/index.js";
export type { DetectedConnection, DetectedProvider, DetectionResult } from "./detect/index.js";
