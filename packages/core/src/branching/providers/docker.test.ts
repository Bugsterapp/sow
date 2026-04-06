import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the low-level docker helpers BEFORE importing the provider.
vi.mock("../docker.js", async () => {
  return {
    POSTGRES_USER: "sow",
    POSTGRES_PASSWORD: "sow",
    POSTGRES_DB: "sow",
    POSTGRES_BOOTSTRAP_DB: "postgres",
    ensureDocker: vi.fn().mockResolvedValue(undefined),
    createConnectorContainer: vi.fn().mockResolvedValue("container-id-abc"),
    waitForConnectorReady: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    startContainer: vi.fn().mockResolvedValue(undefined),
    getContainerStatus: vi.fn().mockResolvedValue("running"),
    execSqlInDb: vi.fn().mockResolvedValue(""),
    loadInitSqlIntoDb: vi.fn().mockResolvedValue(undefined),
    dumpDatabase: vi.fn().mockResolvedValue("-- dump"),
    restoreDumpToDatabase: vi.fn().mockResolvedValue(undefined),
    listDatabases: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../ports.js", () => ({
  findFreePort: vi.fn().mockResolvedValue(54321),
}));

// In-memory connector container store.
const containerStore = new Map<string, any>();
vi.mock("../storage.js", () => ({
  readConnectorContainer: vi.fn((name: string) => containerStore.get(name) ?? null),
  writeConnectorContainer: vi.fn((name: string, info: any) => {
    containerStore.set(name, info);
  }),
  deleteConnectorContainer: vi.fn((name: string) => {
    containerStore.delete(name);
  }),
}));

import {
  DockerBranchProvider,
  PROVIDER_META_VERSION,
  type DockerProviderMeta,
} from "./docker.js";
import * as docker from "../docker.js";
import * as storage from "../storage.js";

const provider = new DockerBranchProvider();

function makeBranch(overrides: Partial<DockerProviderMeta> = {}): any {
  const meta: DockerProviderMeta = {
    providerMetaVersion: PROVIDER_META_VERSION,
    containerId: "container-id-abc",
    containerName: "sow-myconn",
    pgVersion: "16",
    connector: "myconn",
    databaseName: "sow_feature_a",
    ...overrides,
  };
  return {
    name: "feature-a",
    connector: "myconn",
    provider: "docker",
    providerMeta: meta,
    port: 54321,
    status: "running",
    createdAt: "2024-01-01T00:00:00Z",
    connectionString: "postgresql://sow:sow@localhost:54321/sow_feature_a",
  };
}

beforeEach(() => {
  containerStore.clear();
  vi.clearAllMocks();
  // Re-prime defaults the way the top-of-file vi.mock does.
  (docker.createConnectorContainer as any).mockResolvedValue("container-id-abc");
  (docker.execSqlInDb as any).mockResolvedValue("");
  (docker.getContainerStatus as any).mockResolvedValue("running");
  (docker.listDatabases as any).mockResolvedValue([]);
});

describe("DockerBranchProvider.createBranch", () => {
  it("creates the connector container, seed db, and branch db on first branch", async () => {
    const result = await provider.createBranch({
      name: "feature-a",
      connector: "myconn",
      initSqlPath: "/tmp/init.sql",
      detection: { meta: {} },
    });

    expect(docker.createConnectorContainer).toHaveBeenCalledTimes(1);
    expect(docker.waitForConnectorReady).toHaveBeenCalledWith("sow-myconn");
    expect(docker.loadInitSqlIntoDb).toHaveBeenCalledWith(
      "sow-myconn",
      "sow_seed_myconn",
      "/tmp/init.sql",
    );

    const sqlCalls = (docker.execSqlInDb as any).mock.calls.map((c: any[]) => c[2]);
    expect(sqlCalls.some((s: string) => s.includes("CREATE DATABASE") && s.includes("sow_seed_myconn"))).toBe(true);
    expect(sqlCalls.some((s: string) => s.includes("IS_TEMPLATE true"))).toBe(true);
    expect(sqlCalls.some((s: string) => s.includes("ALLOW_CONNECTIONS false"))).toBe(true);
    expect(sqlCalls.some((s: string) => s.includes("CREATE DATABASE") && s.includes("sow_feature_a") && s.includes("TEMPLATE"))).toBe(true);

    expect(result.connectionString).toBe(
      "postgresql://sow:sow@localhost:54321/sow_feature_a",
    );
    const meta = result.providerMeta as DockerProviderMeta;
    expect(meta.providerMetaVersion).toBe(PROVIDER_META_VERSION);
    expect(meta.databaseName).toBe("sow_feature_a");
    expect(meta.containerName).toBe("sow-myconn");
    expect(storage.writeConnectorContainer).toHaveBeenCalledTimes(1);
  });

  it("reuses the existing container on the second branch", async () => {
    await provider.createBranch({
      name: "feature-a",
      connector: "myconn",
      initSqlPath: "/tmp/init.sql",
      detection: { meta: {} },
    });
    (docker.createConnectorContainer as any).mockClear();
    (docker.loadInitSqlIntoDb as any).mockClear();

    const result = await provider.createBranch({
      name: "feature-b",
      connector: "myconn",
      initSqlPath: "/tmp/init.sql",
      detection: { meta: {} },
    });

    expect(docker.createConnectorContainer).not.toHaveBeenCalled();
    expect(docker.loadInitSqlIntoDb).not.toHaveBeenCalled();
    expect((result.providerMeta as DockerProviderMeta).databaseName).toBe(
      "sow_feature_b",
    );
    // The branch db should have been cloned from the seed.
    const sqlCalls = (docker.execSqlInDb as any).mock.calls.map((c: any[]) => c[2]);
    expect(
      sqlCalls.some((s: string) =>
        s.includes("CREATE DATABASE") && s.includes("sow_feature_b") && s.includes("TEMPLATE"),
      ),
    ).toBe(true);
  });

  it("rejects unsafe connector names", async () => {
    await expect(
      provider.createBranch({
        name: "ok",
        connector: "evil; DROP",
        initSqlPath: "/tmp/init.sql",
        detection: { meta: {} },
      }),
    ).rejects.toThrow(/Invalid connector/);
  });
});

describe("DockerBranchProvider.resetBranch", () => {
  it("issues DROP + CREATE FROM TEMPLATE", async () => {
    const branch = makeBranch();
    await provider.resetBranch(branch, "/tmp/init.sql");

    const sqlCalls = (docker.execSqlInDb as any).mock.calls.map((c: any[]) => c[2]);
    expect(sqlCalls).toHaveLength(2);
    expect(sqlCalls[0]).toMatch(/DROP DATABASE.*sow_feature_a.*FORCE/);
    expect(sqlCalls[1]).toMatch(/CREATE DATABASE.*sow_feature_a.*TEMPLATE.*sow_seed_myconn/);
  });
});

describe("DockerBranchProvider.deleteBranch", () => {
  it("drops the branch db but leaves the container when other branches remain", async () => {
    (docker.listDatabases as any).mockResolvedValue([
      "sow_seed_myconn",
      "sow_feature_a",
      "sow_feature_b",
    ]);
    const branch = makeBranch();
    await provider.deleteBranch(branch);
    expect(docker.execSqlInDb).toHaveBeenCalled();
    expect(docker.removeContainer).not.toHaveBeenCalled();
  });

  it("removes the container when the last non-seed branch is deleted", async () => {
    (docker.listDatabases as any).mockResolvedValue(["sow_seed_myconn"]);
    const branch = makeBranch();
    await provider.deleteBranch(branch);
    expect(docker.removeContainer).toHaveBeenCalledWith("sow-myconn");
    expect(storage.deleteConnectorContainer).toHaveBeenCalledWith("myconn");
  });
});

describe("DockerBranchProvider migration / version handling", () => {
  it("rejects branches with old-shape providerMeta", async () => {
    const oldBranch: any = {
      name: "legacy",
      connector: "myconn",
      provider: "docker",
      providerMeta: { containerId: "x", containerName: "sow-myconn-legacy", pgVersion: "16" },
      port: 54321,
      status: "running",
      createdAt: "2024-01-01T00:00:00Z",
      connectionString: "",
    };
    await expect(provider.resetBranch(oldBranch, "/tmp/init.sql")).rejects.toThrow(
      /older sow version/,
    );
  });
});
