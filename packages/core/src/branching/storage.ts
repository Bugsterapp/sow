import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { Branch, BranchesFile, ConnectorMetadata } from "./types.js";

/**
 * Walk up from `from` looking for a `.sow/` directory.
 * Falls back to `from` (cwd) so that first-time usage creates
 * `.sow/` in the current directory.
 */
export function findProjectRoot(from: string = process.cwd()): string {
  let dir = from;
  while (true) {
    if (existsSync(join(dir, ".sow"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return from;
}

export function getSowDir(): string {
  return join(findProjectRoot(), ".sow");
}

export function getSnapshotsDir(): string {
  return join(getSowDir(), "snapshots");
}

export function getSnapshotDir(connectorName: string): string {
  return join(getSnapshotsDir(), connectorName);
}

export function getInitSqlPath(connectorName: string): string {
  return join(getSnapshotsDir(), connectorName, "init.sql");
}

export function getMetadataPath(connectorName: string): string {
  return join(getSnapshotsDir(), connectorName, "metadata.json");
}

// ---------------------------------------------------------------------------
// branches.json
// ---------------------------------------------------------------------------

function getBranchesFile(): string {
  return join(getSowDir(), "branches.json");
}

export function readBranches(): Branch[] {
  const file = getBranchesFile();
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, "utf-8");
    const data = JSON.parse(raw) as BranchesFile;
    return data.branches ?? [];
  } catch {
    return [];
  }
}

export function writeBranches(branches: Branch[]): void {
  const dir = getSowDir();
  mkdirSync(dir, { recursive: true });
  const data: BranchesFile = { branches };
  writeFileSync(getBranchesFile(), JSON.stringify(data, null, 2), "utf-8");
}

export function addBranch(branch: Branch): void {
  const branches = readBranches();
  const idx = branches.findIndex((b) => b.name === branch.name);
  if (idx >= 0) {
    branches[idx] = branch;
  } else {
    branches.push(branch);
  }
  writeBranches(branches);
}

export function updateBranch(
  name: string,
  update: Partial<Branch>,
): Branch | null {
  const branches = readBranches();
  const idx = branches.findIndex((b) => b.name === name);
  if (idx < 0) return null;
  branches[idx] = { ...branches[idx], ...update };
  writeBranches(branches);
  return branches[idx];
}

export function removeBranch(name: string): void {
  const branches = readBranches().filter((b) => b.name !== name);
  writeBranches(branches);
}

export function getBranch(name: string): Branch | null {
  return readBranches().find((b) => b.name === name) ?? null;
}

// ---------------------------------------------------------------------------
// Connector metadata (snapshots/<name>/metadata.json)
// ---------------------------------------------------------------------------

export function readConnectorMetadata(
  connectorName: string,
): ConnectorMetadata | null {
  const metaPath = getMetadataPath(connectorName);
  if (!existsSync(metaPath)) return null;
  try {
    const raw = readFileSync(metaPath, "utf-8");
    return JSON.parse(raw) as ConnectorMetadata;
  } catch {
    return null;
  }
}

export function writeConnectorMetadata(
  connectorName: string,
  metadata: ConnectorMetadata,
): void {
  const dir = getSnapshotDir(connectorName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(getMetadataPath(connectorName), JSON.stringify(metadata, null, 2), "utf-8");
}

export function listConnectorNames(): string[] {
  const snapDir = getSnapshotsDir();
  if (!existsSync(snapDir)) return [];
  return readdirSync(snapDir).filter((entry) => {
    const entryPath = join(snapDir, entry);
    return (
      statSync(entryPath).isDirectory() &&
      existsSync(join(entryPath, "metadata.json"))
    );
  });
}

export function deleteConnectorSnapshot(connectorName: string): void {
  const dir = getSnapshotDir(connectorName);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Checkpoints — point-in-time snapshots within a branch
// ---------------------------------------------------------------------------

export function getCheckpointsDir(connectorName: string): string {
  return join(getSnapshotsDir(), connectorName, "checkpoints");
}

export function getCheckpointPath(
  connectorName: string,
  branchName: string,
  checkpointName: string,
): string {
  return join(
    getCheckpointsDir(connectorName),
    `${branchName}-${checkpointName}.sql`,
  );
}

export function listCheckpointFiles(
  connectorName: string,
  branchName: string,
): string[] {
  const dir = getCheckpointsDir(connectorName);
  if (!existsSync(dir)) return [];
  const prefix = `${branchName}-`;
  const suffix = ".sql";
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => f.slice(prefix.length, -suffix.length));
}

export function deleteCheckpoints(
  connectorName: string,
  branchName: string,
): void {
  const dir = getCheckpointsDir(connectorName);
  if (!existsSync(dir)) return;
  const prefix = `${branchName}-`;
  for (const f of readdirSync(dir)) {
    if (f.startsWith(prefix) && f.endsWith(".sql")) {
      rmSync(join(dir, f), { force: true });
    }
  }
}
