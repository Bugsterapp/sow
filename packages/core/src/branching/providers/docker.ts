import type { BranchProvider, ProviderDetection, ProviderBranchOpts, ProviderBranchResult } from "../provider.js";
import type { Branch, BranchStatus } from "../types.js";
import {
  ensureDocker,
  createContainer,
  stopContainer,
  startContainer,
  removeContainer,
  waitForReady,
  getContainerStatus,
  dumpBranch as dockerDump,
  restoreFromDump as dockerRestore,
  execSql,
} from "../docker.js";
import { findFreePort } from "../ports.js";

const POSTGRES_USER = "sow";
const POSTGRES_PASSWORD = "sow";
const POSTGRES_DB = "sow";

function buildConnectionString(port: number): string {
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${port}/${POSTGRES_DB}`;
}

function buildContainerName(connector: string, branchName: string): string {
  return `sow-${connector}-${branchName}`;
}

/** Docker provider metadata stored in Branch.providerMeta. */
export interface DockerProviderMeta {
  containerId: string;
  containerName: string;
  pgVersion: string;
}

export class DockerBranchProvider implements BranchProvider {
  readonly name = "docker";

  async detect(): Promise<ProviderDetection | null> {
    try {
      await ensureDocker();
      return { meta: {} };
    } catch {
      return null;
    }
  }

  async createBranch(opts: ProviderBranchOpts): Promise<ProviderBranchResult> {
    const pgVersion = opts.pgVersion ?? "16";
    const port = await findFreePort(opts.port);
    const containerName = buildContainerName(opts.connector, opts.name);

    const containerId = await createContainer({
      containerName,
      initSqlPath: opts.initSqlPath,
      port,
      pgVersion,
    });

    await waitForReady(containerName);

    return {
      connectionString: buildConnectionString(port),
      port,
      providerMeta: {
        containerId,
        containerName,
        pgVersion,
      } satisfies DockerProviderMeta,
    };
  }

  async deleteBranch(branch: Branch): Promise<void> {
    const meta = branch.providerMeta as DockerProviderMeta;
    await removeContainer(meta.containerName);
  }

  async resetBranch(branch: Branch, _initSqlPath: string): Promise<void> {
    const meta = branch.providerMeta as DockerProviderMeta;
    await removeContainer(meta.containerName);
  }

  async execSQL(branch: Branch, sql: string): Promise<string> {
    const meta = branch.providerMeta as DockerProviderMeta;
    return execSql(meta.containerName, sql);
  }

  async getBranchStatus(branch: Branch): Promise<BranchStatus> {
    const meta = branch.providerMeta as DockerProviderMeta;
    const actual = await getContainerStatus(meta.containerName);
    if (actual === "not_found") return "error";
    return actual === "running" ? "running" : "stopped";
  }

  async stopBranch(branch: Branch): Promise<void> {
    const meta = branch.providerMeta as DockerProviderMeta;
    await stopContainer(meta.containerName);
  }

  async startBranch(branch: Branch): Promise<void> {
    const meta = branch.providerMeta as DockerProviderMeta;
    await ensureDocker();
    await startContainer(meta.containerName);
    await waitForReady(meta.containerName);
  }

  async dumpBranch(branch: Branch): Promise<string> {
    const meta = branch.providerMeta as DockerProviderMeta;
    return dockerDump(meta.containerName);
  }

  async restoreDump(branch: Branch, sql: string): Promise<void> {
    const meta = branch.providerMeta as DockerProviderMeta;
    await dockerRestore(meta.containerName, sql);
  }
}
