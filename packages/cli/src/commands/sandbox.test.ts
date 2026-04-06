import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sowdb/core", () => ({
  detectConnection: vi.fn(),
  createConnector: vi.fn(),
  createBranch: vi.fn(),
  listConnectors: vi.fn(),
  listBranches: vi.fn(),
  getBranchInfo: vi.fn(),
}));

vi.mock("../env-patch.js", () => ({
  patchEnvFile: vi.fn(),
}));

import {
  detectConnection,
  createConnector,
  createBranch,
  listConnectors,
  listBranches,
  getBranchInfo,
} from "@sowdb/core";
import { patchEnvFile } from "../env-patch.js";
import { runSandbox } from "./sandbox.js";

const mDetect = vi.mocked(detectConnection);
const mCreateConn = vi.mocked(createConnector);
const mCreateBranch = vi.mocked(createBranch);
const mListConn = vi.mocked(listConnectors);
const mListBranches = vi.mocked(listBranches);
const mGetBranch = vi.mocked(getBranchInfo);
const mPatch = vi.mocked(patchEnvFile);

const noopLog = () => {};

const fakeBranch = {
  name: "sandbox",
  port: 54330,
  connectionString: "postgresql://localhost:54330/sandbox",
  connector: "main",
  status: "running",
  provider: "postgres",
  createdAt: new Date().toISOString(),
} as unknown as Awaited<ReturnType<typeof createBranch>>;

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`__exit__${code}`);
  }) as never);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  mListConn.mockReturnValue([]);
  mListBranches.mockResolvedValue([]);
  mCreateConn.mockResolvedValue({
    name: "main",
    tables: 5,
    rows: 100,
    piiColumnsDetected: 0,
    sizeBytes: 1234,
    snapshotPath: "/tmp/snap",
  });
  mCreateBranch.mockResolvedValue(fakeBranch);
  mGetBranch.mockResolvedValue(fakeBranch);
  mPatch.mockResolvedValue({
    patched: true,
    diff: "",
    keysChanged: ["DATABASE_URL", "SOW_BRANCH"],
  });
});

afterEach(() => {
  exitSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe("runSandbox", () => {
  it("single candidate => detect, sample, branch, patch", async () => {
    mDetect.mockReturnValue({
      connections: [
        {
          source: "env",
          sourceFile: ".env",
          connectionString: "postgresql://prod/db",
          confidence: "high",
        },
      ],
      providers: [],
      hints: [],
      warnings: [],
    });

    await runSandbox(undefined, { yes: true }, noopLog);

    expect(mDetect).toHaveBeenCalled();
    expect(mCreateConn).toHaveBeenCalledWith(
      "postgresql://prod/db",
      expect.any(Object),
    );
    expect(mCreateBranch).toHaveBeenCalledWith("sandbox", "main", expect.any(Object));
    expect(mPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        path: ".env.local",
        vars: expect.objectContaining({ DATABASE_URL: fakeBranch.connectionString }),
        backup: true,
      }),
    );
  });

  it("no candidates => clear error and exit 1", async () => {
    mDetect.mockReturnValue({
      connections: [],
      providers: [],
      hints: [],
      warnings: [],
    });

    await expect(runSandbox(undefined, { yes: true }, noopLog)).rejects.toThrow(
      "__exit__1",
    );
    expect(mCreateConn).not.toHaveBeenCalled();
  });

  it("multiple candidates in --json mode => errors out", async () => {
    mDetect.mockReturnValue({
      connections: [
        { source: "a", sourceFile: ".env", connectionString: "postgresql://a", confidence: "high" },
        { source: "b", sourceFile: ".env", connectionString: "postgresql://b", confidence: "high" },
      ],
      providers: [],
      hints: [],
      warnings: [],
    });

    await expect(
      runSandbox(undefined, { json: true }, noopLog),
    ).rejects.toThrow("__exit__1");
    expect(mCreateConn).not.toHaveBeenCalled();
  });

  it("multiple candidates in quiet mode => picks first (non-TTY safe)", async () => {
    mDetect.mockReturnValue({
      connections: [
        { source: "a", sourceFile: ".env", connectionString: "postgresql://a", confidence: "high" },
        { source: "b", sourceFile: ".env", connectionString: "postgresql://b", confidence: "high" },
      ],
      providers: [],
      hints: [],
      warnings: [],
    });
    await runSandbox(undefined, { quiet: true, yes: true }, noopLog);
    expect(mCreateConn).toHaveBeenCalledWith("postgresql://a", expect.any(Object));
  });

  it("existing sandbox branch => does not re-create, prints info", async () => {
    mListBranches.mockResolvedValue([fakeBranch] as unknown as Awaited<ReturnType<typeof listBranches>>);

    await runSandbox("postgresql://prod/db", { yes: true }, noopLog);

    expect(mCreateBranch).not.toHaveBeenCalled();
    expect(mGetBranch).toHaveBeenCalledWith("sandbox");
    expect(mPatch).toHaveBeenCalled();
  });

  it("--no-env-file => skips env patching", async () => {
    await runSandbox("postgresql://prod/db", { yes: true, noEnvFile: true }, noopLog);
    expect(mPatch).not.toHaveBeenCalled();
  });

  it("--yes => sets prompt:false in patchEnvFile", async () => {
    await runSandbox("postgresql://prod/db", { yes: true }, noopLog);
    expect(mPatch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: false, backup: true }),
    );
  });

  it("connector already exists => reuses it (no createConnector)", async () => {
    mListConn.mockReturnValue([
      { name: "existing", tables: 1, rows: 1, sizeBytes: 1, createdAt: "" },
    ]);
    await runSandbox("postgresql://prod/db", { yes: true }, noopLog);
    expect(mCreateConn).not.toHaveBeenCalled();
    expect(mCreateBranch).toHaveBeenCalledWith("sandbox", "existing", expect.any(Object));
  });
});
