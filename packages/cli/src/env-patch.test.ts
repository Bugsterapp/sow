import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchEnvFile, revertEnvFile, __setPromptImpl } from "./env-patch.js";

let dir: string;
let envPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sow-envpatch-"));
  envPath = join(dir, ".env.local");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("patchEnvFile", () => {
  it("creates the file if missing and writes vars (no backup)", async () => {
    const res = await patchEnvFile({
      path: envPath,
      vars: { DATABASE_URL: "postgresql://localhost/db", SOW_BRANCH: "sandbox" },
      prompt: false,
      backup: true,
    });
    expect(res.patched).toBe(true);
    expect(res.backupPath).toBeUndefined();
    expect(res.keysChanged.sort()).toEqual(["DATABASE_URL", "SOW_BRANCH"]);
    const c = readFileSync(envPath, "utf-8");
    expect(c).toContain("DATABASE_URL=postgresql://localhost/db");
    expect(c).toContain("SOW_BRANCH=sandbox");
    expect(existsSync(envPath + ".sow.bak")).toBe(false);
  });

  it("merges into existing file, preserves unrelated vars, writes backup", async () => {
    writeFileSync(envPath, "LEVEL=info\nPORT=3000\n", "utf-8");
    const res = await patchEnvFile({
      path: envPath,
      vars: { DATABASE_URL: "postgresql://x" },
      prompt: false,
      backup: true,
    });
    expect(res.patched).toBe(true);
    expect(res.backupPath).toBe(envPath + ".sow.bak");
    const c = readFileSync(envPath, "utf-8");
    expect(c).toContain("LEVEL=info");
    expect(c).toContain("PORT=3000");
    expect(c).toContain("DATABASE_URL=postgresql://x");
    const bak = readFileSync(envPath + ".sow.bak", "utf-8");
    expect(bak).toBe("LEVEL=info\nPORT=3000\n");
  });

  it("overwrites existing key in place; diff shows the changed line", async () => {
    writeFileSync(
      envPath,
      "LEVEL=info\nDATABASE_URL=postgresql://old\nPORT=3000\n",
      "utf-8",
    );
    const res = await patchEnvFile({
      path: envPath,
      vars: { DATABASE_URL: "postgresql://new" },
      prompt: false,
      backup: false,
    });
    expect(res.patched).toBe(true);
    expect(res.keysChanged).toEqual(["DATABASE_URL"]);
    expect(res.diff).toContain("- DATABASE_URL=postgresql://old");
    expect(res.diff).toContain("+ DATABASE_URL=postgresql://new");
    const c = readFileSync(envPath, "utf-8");
    expect(c).toBe("LEVEL=info\nDATABASE_URL=postgresql://new\nPORT=3000\n");
  });

  it("empty vars => no-op", async () => {
    writeFileSync(envPath, "A=1\n", "utf-8");
    const res = await patchEnvFile({
      path: envPath,
      vars: {},
      prompt: false,
      backup: true,
    });
    expect(res.patched).toBe(false);
    expect(readFileSync(envPath, "utf-8")).toBe("A=1\n");
  });

  it("no-op if all vars already match", async () => {
    writeFileSync(envPath, "DATABASE_URL=postgresql://same\n", "utf-8");
    const res = await patchEnvFile({
      path: envPath,
      vars: { DATABASE_URL: "postgresql://same" },
      prompt: false,
      backup: true,
    });
    expect(res.patched).toBe(false);
    expect(existsSync(envPath + ".sow.bak")).toBe(false);
  });

  it("prompt: true and user declines => no writes, no backup", async () => {
    writeFileSync(envPath, "A=1\n", "utf-8");
    __setPromptImpl(async () => false);

    const res = await patchEnvFile({
      path: envPath,
      vars: { DATABASE_URL: "postgresql://x" },
      prompt: true,
      backup: true,
    });
    expect(res.patched).toBe(false);
    expect(readFileSync(envPath, "utf-8")).toBe("A=1\n");
    expect(existsSync(envPath + ".sow.bak")).toBe(false);
  });

  it("prompt: true and user accepts => writes", async () => {
    writeFileSync(envPath, "A=1\n", "utf-8");
    __setPromptImpl(async () => true);

    const res = await patchEnvFile({
      path: envPath,
      vars: { DATABASE_URL: "postgresql://x" },
      prompt: true,
      backup: true,
    });
    expect(res.patched).toBe(true);
    expect(readFileSync(envPath, "utf-8")).toContain("DATABASE_URL=postgresql://x");
  });

  it("does NOT overwrite an existing .sow.bak; warns and continues", async () => {
    writeFileSync(envPath, "DATABASE_URL=old\n", "utf-8");
    writeFileSync(envPath + ".sow.bak", "ORIGINAL=1\n", "utf-8");
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const res = await patchEnvFile({
      path: envPath,
      vars: { DATABASE_URL: "new" },
      prompt: false,
      backup: true,
    });

    expect(res.patched).toBe(true);
    expect(res.backupPath).toBeUndefined();
    expect(readFileSync(envPath + ".sow.bak", "utf-8")).toBe("ORIGINAL=1\n");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("already exists"))).toBe(true);
  });

  it("quotes values containing spaces", async () => {
    const res = await patchEnvFile({
      path: envPath,
      vars: { GREETING: "hello world" },
      prompt: false,
      backup: false,
    });
    expect(res.patched).toBe(true);
    expect(readFileSync(envPath, "utf-8")).toContain('GREETING="hello world"');
  });

  it("preserves comments and blank lines", async () => {
    writeFileSync(
      envPath,
      "# top comment\n\nA=1\n# inline\nB=2\n",
      "utf-8",
    );
    const res = await patchEnvFile({
      path: envPath,
      vars: { B: "22" },
      prompt: false,
      backup: false,
    });
    expect(res.patched).toBe(true);
    const c = readFileSync(envPath, "utf-8");
    expect(c).toBe("# top comment\n\nA=1\n# inline\nB=22\n");
  });

  it("handles existing quoted value comparison correctly", async () => {
    writeFileSync(envPath, 'A="hello world"\n', "utf-8");
    const res = await patchEnvFile({
      path: envPath,
      vars: { A: "hello world" },
      prompt: false,
      backup: true,
    });
    expect(res.patched).toBe(false);
  });
});

describe("revertEnvFile", () => {
  it("restores from backup and deletes the backup", async () => {
    writeFileSync(envPath, "DATABASE_URL=new\n", "utf-8");
    writeFileSync(envPath + ".sow.bak", "DATABASE_URL=original\n", "utf-8");
    await revertEnvFile(envPath);
    expect(readFileSync(envPath, "utf-8")).toBe("DATABASE_URL=original\n");
    expect(existsSync(envPath + ".sow.bak")).toBe(false);
  });

  it("errors clearly if no backup exists", async () => {
    writeFileSync(envPath, "X=1\n", "utf-8");
    await expect(revertEnvFile(envPath)).rejects.toThrow(/No backup/);
  });
});
