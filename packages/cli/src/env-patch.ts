import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { createInterface } from "node:readline";

export interface EnvPatchOptions {
  /** Path to the env file. Created if missing. */
  path: string;
  /** Key-value pairs to set or update. Existing keys are overwritten, others preserved. */
  vars: Record<string, string>;
  /** If true, prompt interactively before writing. If false, write unconditionally. */
  prompt: boolean;
  /** If true, write {path}.sow.bak containing the pre-patch contents before writing. */
  backup: boolean;
}

export interface EnvPatchResult {
  /** true if changes were written to disk. */
  patched: boolean;
  /** Path to the backup file, if one was created. */
  backupPath?: string;
  /** The unified diff of the change, rendered as text. */
  diff: string;
  /** The keys that were actually added or modified. */
  keysChanged: string[];
}

interface ParsedLine {
  raw: string;
  key?: string;
  /** unquoted value for comparison */
  value?: string;
}

const KEY_RE = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

function parseLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return { raw: line };
  }
  const m = line.match(KEY_RE);
  if (!m) return { raw: line };
  const key = m[1];
  // Strip surrounding quotes for comparison purposes only
  let value = m[2];
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    const quote = value[0];
    value = value.slice(1, -1);
    if (quote === '"') {
      value = value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  return { raw: line, key, value };
}

function quoteIfNeeded(value: string): string {
  if (/[\s="']/.test(value)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

function formatLine(key: string, value: string): string {
  return `${key}=${quoteIfNeeded(value)}`;
}

function buildDiff(
  oldLines: string[],
  newLines: string[],
  changedKeys: Set<string>,
): string {
  // Hand-rolled "show changed lines with surrounding context" — minimal.
  // We render: matching lines as "  line", removed as "- line", added as "+ line".
  const out: string[] = [];

  // Build a map of old lines by key for lookup
  const oldByKey = new Map<string, string>();
  for (const l of oldLines) {
    const p = parseLine(l);
    if (p.key) oldByKey.set(p.key, l);
  }

  // For each line in the new file, decide how to render
  for (const nl of newLines) {
    const p = parseLine(nl);
    if (p.key && changedKeys.has(p.key)) {
      const oldLine = oldByKey.get(p.key);
      if (oldLine !== undefined) {
        out.push(`- ${oldLine}`);
        out.push(`+ ${nl}`);
      } else {
        out.push(`+ ${nl}`);
      }
    } else {
      out.push(`  ${nl}`);
    }
  }

  // Note: keys that exist only in vars but not in newLines shouldn't happen,
  // because we always append unknown keys. Sanity-only.
  return out.join("\n");
}

let promptImpl: (question: string) => Promise<boolean> = (question) =>
  new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });

/** Test hook: override the interactive prompt. */
export function __setPromptImpl(impl: (question: string) => Promise<boolean>): void {
  promptImpl = impl;
}

async function promptYesNo(question: string): Promise<boolean> {
  return promptImpl(question);
}

export async function patchEnvFile(
  options: EnvPatchOptions,
): Promise<EnvPatchResult> {
  const { path, vars, prompt, backup } = options;

  if (Object.keys(vars).length === 0) {
    return { patched: false, diff: "", keysChanged: [] };
  }

  const fileExists = existsSync(path);
  const original = fileExists ? readFileSync(path, "utf-8") : "";
  // Preserve final newline awareness
  const hadTrailingNewline = original.endsWith("\n");
  const oldLines = original === "" ? [] : original.replace(/\n$/, "").split("\n");

  // Determine which keys actually change
  const keysChanged: string[] = [];
  const newLines: string[] = [];
  const handledKeys = new Set<string>();

  for (const line of oldLines) {
    const parsed = parseLine(line);
    if (parsed.key && parsed.key in vars) {
      const newVal = vars[parsed.key];
      handledKeys.add(parsed.key);
      if (parsed.value !== newVal) {
        keysChanged.push(parsed.key);
        newLines.push(formatLine(parsed.key, newVal));
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  // Append keys not yet present, preserving insertion order from `vars`
  for (const [k, v] of Object.entries(vars)) {
    if (!handledKeys.has(k)) {
      keysChanged.push(k);
      newLines.push(formatLine(k, v));
    }
  }

  if (keysChanged.length === 0) {
    return { patched: false, diff: "", keysChanged: [] };
  }

  const changedSet = new Set(keysChanged);
  const diff = buildDiff(oldLines, newLines, changedSet);

  if (prompt) {
    process.stderr.write(`${diff}\n\n`);
    const ok = await promptYesNo(`Apply these changes to ${path}? [y/N] `);
    if (!ok) {
      return { patched: false, diff, keysChanged };
    }
  }

  // Backup if file exists and at least one key will change
  let backupPath: string | undefined;
  if (backup && fileExists) {
    const candidate = `${path}.sow.bak`;
    if (existsSync(candidate)) {
      process.stderr.write(
        `  ⚠ Backup ${candidate} already exists; not overwriting.\n`,
      );
    } else {
      writeFileSync(candidate, original, "utf-8");
      backupPath = candidate;
    }
  }

  const output = newLines.join("\n") + (hadTrailingNewline || !fileExists ? "\n" : "");
  writeFileSync(path, output, "utf-8");

  return { patched: true, backupPath, diff, keysChanged };
}

export async function revertEnvFile(envPath: string): Promise<void> {
  const backupPath = `${envPath}.sow.bak`;
  if (!existsSync(backupPath)) {
    throw new Error(
      `No backup found at ${backupPath}. Nothing to revert.`,
    );
  }
  const contents = readFileSync(backupPath, "utf-8");
  writeFileSync(envPath, contents, "utf-8");
  unlinkSync(backupPath);
}
