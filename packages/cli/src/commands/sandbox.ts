import { createInterface } from "node:readline";
import {
  detectConnection,
  createConnector,
  createBranch,
  listConnectors,
  listBranches,
  getBranchInfo,
  type DetectedConnection,
  type ProgressEvent,
} from "@sowdb/core";
import { patchEnvFile } from "../env-patch.js";
import { printError } from "./runner.js";

interface SandboxFlags {
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
  noEnvFile?: boolean;
  envFile?: string;
  name?: string;
  maxRows?: number;
  seed?: number;
  noSanitize?: boolean;
  full?: boolean;
}

async function pickIndex(max: number): Promise<number> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`Select [1-${max}]: `, (answer) => {
      rl.close();
      const n = parseInt(answer.trim(), 10);
      if (Number.isFinite(n) && n >= 1 && n <= max) resolve(n - 1);
      else resolve(-1);
    });
  });
}

function fmtConn(c: DetectedConnection): string {
  const where = c.envVar ? `${c.envVar} (${c.sourceFile})` : `${c.source} (${c.sourceFile})`;
  return `${where} — ${c.connectionString}`;
}

export async function runSandbox(
  positionalUrl: string | undefined,
  flags: SandboxFlags,
  _log: (event: ProgressEvent) => void,
): Promise<void> {
  const isJSON = !!flags.json;
  const isQuiet = !!flags.quiet;
  const branchName = flags.name || "sandbox";

  try {
    // 1. Resolve source URL
    let sourceUrl = positionalUrl;
    if (!sourceUrl) {
      const detection = detectConnection(process.cwd());
      if (detection.connections.length === 0) {
        const msg =
          "no Postgres connection detected. Pass a URL explicitly: `sow sandbox <postgres-url>`";
        if (isJSON) console.log(JSON.stringify({ type: "error", message: msg }));
        else printError(msg);
        process.exit(1);
      } else if (detection.connections.length === 1) {
        sourceUrl = detection.connections[0].connectionString;
      } else {
        if (isJSON) {
          console.log(
            JSON.stringify({
              type: "error",
              message:
                "multiple candidates detected, run `sow detect` to list them and pass the chosen URL explicitly.",
            }),
          );
          process.exit(1);
        }
        if (isQuiet || !process.stdin.isTTY) {
          sourceUrl = detection.connections[0].connectionString;
        } else {
          console.error(`  Found ${detection.connections.length} possible sources:\n`);
          detection.connections.forEach((c, i) => {
            console.error(`    ${i + 1}. ${fmtConn(c)}`);
          });
          console.error();
          const idx = await pickIndex(detection.connections.length);
          if (idx < 0) {
            printError("invalid selection");
            process.exit(1);
          }
          sourceUrl = detection.connections[idx].connectionString;
        }
      }
    }

    // 2. Connector — reuse if one already exists, else create
    const existingConnectors = listConnectors();
    let connectorName: string;
    if (existingConnectors.length > 0) {
      connectorName = existingConnectors[0].name;
      if (!isJSON && !isQuiet) {
        console.error(`  ✓ Reusing connector "${connectorName}"`);
      }
    } else {
      if (!isJSON && !isQuiet) {
        console.error("  Sampling source database...");
      }
      const result = await createConnector(sourceUrl!, {
        maxRowsPerTable: flags.maxRows,
        seed: flags.seed,
        noSanitize: flags.noSanitize,
        full: flags.full,
      });
      connectorName = result.name;
    }

    // 3. Branch — reuse if one with the same name already exists
    const branches = await listBranches();
    const existing = branches.find((b) => b.name === branchName);
    let branch;
    if (existing) {
      branch = await getBranchInfo(branchName);
      if (!isJSON && !isQuiet) {
        console.error(`  ✓ Sandbox already running at :${branch.port}`);
      }
    } else {
      if (!isJSON && !isQuiet) {
        console.error("  Spinning up local branch...");
      }
      branch = await createBranch(branchName, connectorName, {});
    }

    // 4. Patch env file unless disabled
    let envPatched = false;
    let envPath: string | undefined;
    if (!flags.noEnvFile) {
      envPath = flags.envFile || ".env.local";
      const result = await patchEnvFile({
        path: envPath,
        vars: {
          DATABASE_URL: branch.connectionString,
          SOW_BRANCH: branch.name,
        },
        prompt: !flags.yes && !isJSON && !isQuiet,
        backup: true,
      });
      envPatched = result.patched;
    }

    // 5. Output
    if (isJSON) {
      console.log(
        JSON.stringify({
          type: "result",
          branch,
          envPatched,
          envPath,
        }),
      );
    } else if (isQuiet) {
      console.log(branch.connectionString);
    } else {
      console.log();
      console.log(`  ✓ Sandbox ready at :${branch.port}.`);
      console.log(`  DATABASE_URL=${branch.connectionString}`);
      if (envPatched && envPath) {
        console.log(`  ✓ Patched ${envPath}`);
      }
      console.log();
      console.log(`  Run your app with \`npm run dev\` or any command that reads DATABASE_URL.`);
    }
  } catch (err) {
    if (!isJSON && !isQuiet) {
      printError(err instanceof Error ? err.message : String(err));
    } else if (isJSON) {
      console.log(
        JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    process.exit(1);
  }
}
