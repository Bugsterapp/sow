import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSupabaseProject } from "./supabase.js";

describe("isSupabaseProject", () => {
  function makeDir(): string {
    return mkdtempSync(join(tmpdir(), "sow-issupabase-test-"));
  }

  it("returns true when supabase/config.toml exists", () => {
    const dir = makeDir();
    try {
      mkdirSync(join(dir, "supabase"), { recursive: true });
      writeFileSync(join(dir, "supabase", "config.toml"), '[db]\n', "utf-8");
      expect(isSupabaseProject(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when the directory does not exist", () => {
    expect(isSupabaseProject("/nonexistent/path/that/will/never/exist")).toBe(false);
  });

  it("returns false when the directory exists but has no supabase/ subdir", () => {
    const dir = makeDir();
    try {
      expect(isSupabaseProject(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when supabase/ exists but config.toml is missing", () => {
    const dir = makeDir();
    try {
      mkdirSync(join(dir, "supabase"), { recursive: true });
      // No config.toml inside. A bare "supabase" directory is a common
      // false positive (projects may have it for unrelated reasons).
      expect(isSupabaseProject(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when supabase/config.toml is a directory, not a file", () => {
    const dir = makeDir();
    try {
      mkdirSync(join(dir, "supabase", "config.toml"), { recursive: true });
      // Degenerate: config.toml exists but is a directory. Guard
      // against this specifically to avoid a false positive from
      // existsSync alone.
      expect(isSupabaseProject(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
