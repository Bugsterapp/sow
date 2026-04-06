export type {
  Branch,
  BranchStatus,
  BranchOptions,
  ConnectorMetadata,
  ConnectorInfo,
  ConnectorCreateOptions,
  ConnectorCreateResult,
  AuthUserMapping,
  DiffResult,
  TableDiff,
  SchemaChange,
  CheckpointInfo,
  BranchesFile,
} from "./types.js";

export type {
  BranchProvider,
  ProviderDetection,
  ProviderBranchOpts,
  ProviderBranchResult,
  ProviderSnapshotData,
} from "./provider.js";

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
} from "./manager.js";

export type { BranchUsersResult, BranchTableInfo } from "./manager.js";

export {
  createConnector,
  listConnectors,
  deleteConnector,
  refreshConnector,
  getConnectorMetadata,
} from "./connector.js";

export { resolveProvider, getProvider, listProviderNames } from "./provider-registry.js";
export { ensureDocker } from "./docker.js";
export { findFreePort } from "./ports.js";
export { getSowDir, findProjectRoot } from "./storage.js";
