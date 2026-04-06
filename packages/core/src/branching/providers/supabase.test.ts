import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the low-level Supabase helpers so we never touch a real pg.
vi.mock("../supabase.js", async () => {
  const actual = await vi.importActual<typeof import("../supabase.js")>(
    "../supabase.js",
  );
  return {
    // Keep the real isSupabaseProject: it reads the filesystem we control
    // in the tests below.
    isSupabaseProject: actual.isSupabaseProject,
    // Stub the network/SQL helpers. A test that accidentally triggers
    // these calls would crash — that's the intended shape (we want
    // strict isolation between provider gating and provider execution).
    detectSupabaseLocal: vi.fn(),
    loadIntoSupabase: vi.fn(),
    createTestAuthUsers: vi.fn(),
    cleanSupabaseBranch: vi.fn(),
  };
});

vi.mock("../../sanitizer/transformer.js", () => ({
  transformValue: (v: unknown) => v,
}));

import { SupabaseBranchProvider } from "./supabase.js";
import { detectSupabaseLocal } from "../supabase.js";

const mDetect = vi.mocked(detectSupabaseLocal);

const FAKE_INFO = {
  dbUrl: "postgresql://postgres:postgres@localhost:54322/postgres",
  apiUrl: "http://localhost:54321",
  anonKey: "",
  publishableKey: "",
  dbPort: 54322,
};

function makeTempProject(opts: { withSupabaseConfig: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "sow-supabase-provider-test-"));
  if (opts.withSupabaseConfig) {
    mkdirSync(join(dir, "supabase"), { recursive: true });
    writeFileSync(
      join(dir, "supabase", "config.toml"),
      '[db]\nport = 54322\n',
      "utf-8",
    );
  }
  return dir;
}

describe("SupabaseBranchProvider.detect — three hard gates", () => {
  let provider: SupabaseBranchProvider;

  beforeEach(() => {
    provider = new SupabaseBranchProvider();
    mDetect.mockReset();
  });

  describe("Gate 1: project must be a Supabase-CLI project", () => {
    it("returns null when cwd has no supabase/config.toml, even with consent and reachable Supabase", async () => {
      const dir = makeTempProject({ withSupabaseConfig: false });
      try {
        mDetect.mockResolvedValue(FAKE_INFO);
        const result = await provider.detect({
          cwd: dir,
          destructiveConsent: true,
        });
        expect(result).toBeNull();
        // Gate 1 should short-circuit BEFORE hitting the network.
        // This is the historical bug that destroyed a user's flick
        // database: machine-wide Supabase detection would activate
        // the provider from an unrelated project directory. The
        // detectSupabaseLocal() call MUST NOT happen when cwd lacks
        // a Supabase project.
        expect(mDetect).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns null when cwd has a bare 'supabase/' dir but no config.toml", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sow-bare-supabase-dir-"));
      try {
        mkdirSync(join(dir, "supabase"), { recursive: true });
        // No config.toml — a directory named "supabase" is not enough.
        mDetect.mockResolvedValue(FAKE_INFO);
        const result = await provider.detect({
          cwd: dir,
          destructiveConsent: true,
        });
        expect(result).toBeNull();
        expect(mDetect).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("Gate 2: explicit destructive consent", () => {
    it("returns null when cwd is a Supabase project but destructiveConsent is absent", async () => {
      const dir = makeTempProject({ withSupabaseConfig: true });
      try {
        mDetect.mockResolvedValue(FAKE_INFO);
        const result = await provider.detect({ cwd: dir });
        expect(result).toBeNull();
        expect(mDetect).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns null when destructiveConsent is false", async () => {
      const dir = makeTempProject({ withSupabaseConfig: true });
      try {
        mDetect.mockResolvedValue(FAKE_INFO);
        const result = await provider.detect({
          cwd: dir,
          destructiveConsent: false,
        });
        expect(result).toBeNull();
        expect(mDetect).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("does NOT treat truthy non-true values (e.g. 'yes' string) as consent", async () => {
      const dir = makeTempProject({ withSupabaseConfig: true });
      try {
        mDetect.mockResolvedValue(FAKE_INFO);
        const result = await provider.detect({
          cwd: dir,
          // @ts-expect-error — deliberately testing type escape
          destructiveConsent: "yes",
        });
        expect(result).toBeNull();
        // Strict equality to `true` is the right shape here: it prevents
        // accidental activation from environment variables or JSON
        // parsing shenanigans where a string "true" or a truthy number
        // would silently unlock destructive behavior.
        expect(mDetect).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("Gate 3: infrastructure reachability", () => {
    it("returns null when Supabase is not running, even with project + consent", async () => {
      const dir = makeTempProject({ withSupabaseConfig: true });
      try {
        mDetect.mockResolvedValue(null);
        const result = await provider.detect({
          cwd: dir,
          destructiveConsent: true,
        });
        expect(result).toBeNull();
        // Gate 3 is reached (the network check did run), but returned
        // null because Supabase wasn't up.
        expect(mDetect).toHaveBeenCalledTimes(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("all three gates pass", () => {
    it("returns detection info only when cwd is a Supabase project AND consent is true AND Supabase is up", async () => {
      const dir = makeTempProject({ withSupabaseConfig: true });
      try {
        mDetect.mockResolvedValue(FAKE_INFO);
        const result = await provider.detect({
          cwd: dir,
          destructiveConsent: true,
        });
        expect(result).not.toBeNull();
        expect(result?.meta).toMatchObject({
          dbUrl: FAKE_INFO.dbUrl,
          apiUrl: FAKE_INFO.apiUrl,
          dbPort: FAKE_INFO.dbPort,
        });
        expect(mDetect).toHaveBeenCalledTimes(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("no context passed (legacy callers)", () => {
    it("returns null when detect() is called with no ctx at all", async () => {
      // A caller that doesn't pass a DetectionContext defaults to
      // cwd=process.cwd() and destructiveConsent=undefined. Since
      // the test runner's cwd is almost certainly not a Supabase
      // project, and consent is not true, this should fail-safe.
      mDetect.mockResolvedValue(FAKE_INFO);
      const result = await provider.detect();
      expect(result).toBeNull();
      expect(mDetect).not.toHaveBeenCalled();
    });
  });
});
