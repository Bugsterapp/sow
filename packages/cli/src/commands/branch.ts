import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { patchEnvFile } from "../env-patch.js";
import { formatBytes, timeAgo } from "../utils.js";
import {
  type ProgressEvent,
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
} from "@sowdb/core";
import { printError } from "./runner.js";

async function showSampleTestData(branchName: string): Promise<void> {
  try {
    // Find a table with an email column
    const tablesOutput = await execBranch(branchName,
      "SELECT table_name, column_name FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND column_name = 'email' LIMIT 1",
    );

    const tableMatch = tablesOutput.match(/^\s*(\S+)\s*\|\s*email/m);
    if (!tableMatch) return;

    const tableName = tableMatch[1];
    const sampleOutput = await execBranch(branchName,
      `SELECT email FROM "${tableName}" WHERE email IS NOT NULL LIMIT 3`,
    );

    const emails = sampleOutput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("@"));

    if (emails.length === 0) return;

    console.log();
    console.log(`  Test accounts (password for all: password123):`);
    for (const email of emails) {
      console.log(`    ${email}`);
    }
  } catch {
    // Non-critical — silently skip if query fails
  }
}

export async function runBranch(
  subcommand: string,
  name: string | undefined,
  flags: Record<string, unknown>,
  log: (event: ProgressEvent) => void,
): Promise<void> {
  const isJSON = !!flags.json;
  const isQuiet = !!flags.quiet;

  try {
    switch (subcommand) {
      case "create": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch create <name>" });
          process.exit(1);
        }
        if (!isJSON && !isQuiet) {
          console.error("  Starting database...");
        }
        const branch = await createBranch(
          name,
          flags.connector as string | undefined,
          {
            port: flags.port as number | undefined,
            pgVersion: flags.pgVersion as string | undefined,
            destructiveSupabaseConsent: !!flags.yesDestructiveSupabase,
          },
        );

        if (flags.export) {
          console.log(`export SOW_URL=${branch.connectionString}`);
        } else if (flags.envFile) {
          if (flags.append) {
            console.error(
              "  ⚠ --append is deprecated; --env-file now always merges and preserves unrelated keys.",
            );
          }
          await patchEnvFile({
            path: flags.envFile as string,
            vars: {
              DATABASE_URL: branch.connectionString,
              SOW_BRANCH: branch.name,
            },
            prompt: false,
            backup: true,
          });
          if (isJSON) {
            console.log(JSON.stringify(branch));
          } else if (isQuiet) {
            console.log(branch.connectionString);
          } else {
            console.log(`  ✓ Branch "${branch.name}" created on :${branch.port}`);
            console.log(`  ✓ Wrote to ${flags.envFile}`);
          }
        } else if (isJSON) {
          console.log(JSON.stringify(branch));
        } else if (isQuiet) {
          console.log(branch.connectionString);
        } else {
          console.log();

          if (branch.provider === "supabase") {
            const meta = branch.providerMeta as { supabaseUrl?: string; publishableKey?: string };
            console.log(`  ✓ Branch "${branch.name}" loaded into local Supabase`);
            console.log();
            console.log(`  Run your app with these env vars:\n`);
            if (meta.supabaseUrl) {
              console.log(`  SUPABASE_URL=${meta.supabaseUrl}`);
              console.log(`  NEXT_PUBLIC_SUPABASE_URL=${meta.supabaseUrl}`);
            }
            if (meta.publishableKey) {
              console.log(`  SUPABASE_PUBLISHABLE_KEY=${meta.publishableKey}`);
              console.log(`  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${meta.publishableKey}`);
            }
            console.log(`  DATABASE_URL=${branch.connectionString}`);
            if (branch.testEmails && branch.testEmails.length > 0) {
              console.log();
              console.log(`  Test accounts (password for all: password123):`);
              for (const email of branch.testEmails) {
                console.log(`    ${email}`);
              }
            }
          } else {
            console.log(`  ✓ Branch "${branch.name}" created on :${branch.port}`);
            console.log();
            console.log(`  DATABASE_URL=${branch.connectionString}`);

            await showSampleTestData(branch.name);
          }

          console.log();
          console.log(`  sow branch diff ${branch.name}     # see what changed`);
          console.log(`  sow branch reset ${branch.name}    # reset to clean state`);
          console.log(`  sow branch delete ${branch.name}   # remove branch`);
        }
        break;
      }
      case "list": {
        const branches = await listBranches();
        if (isJSON) {
          console.log(JSON.stringify(branches));
        } else if (isQuiet) {
          for (const b of branches) {
            console.log(`${b.name}\t${b.status}\t${b.connectionString}`);
          }
        } else if (branches.length === 0) {
          console.log("  No branches yet. Create one:");
          console.log("    $ sow branch create <name>");
        } else {
          const nameW = Math.max(6, ...branches.map((b) => b.name.length)) + 2;
          const connW = Math.max(11, ...branches.map((b) => b.connector.length)) + 2;
          console.log();
          console.log(`  ${"NAME".padEnd(nameW)}${"CONNECTOR".padEnd(connW)}${"PORT".padStart(8)}  ${"STATUS".padEnd(10)}CREATED`);
          for (const b of branches) {
            console.log(`  ${b.name.padEnd(nameW)}${b.connector.padEnd(connW)}${(`:${b.port}`).padStart(8)}  ${b.status.padEnd(10)}${timeAgo(b.createdAt)}`);
          }
        }
        break;
      }
      case "info": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch info <name>" });
          process.exit(1);
        }
        const branch = await getBranchInfo(name);
        if (isJSON) {
          console.log(JSON.stringify(branch));
        } else if (isQuiet) {
          console.log(branch.connectionString);
        } else {
          console.log();
          console.log(`  Name:       ${branch.name}`);
          console.log(`  Connector:  ${branch.connector}`);
          console.log(`  Provider:   ${branch.provider}`);
          console.log(`  Status:     ${branch.status}`);
          console.log(`  Port:       ${branch.port}`);
          console.log(`  Created:    ${timeAgo(branch.createdAt)}`);
          console.log(`  URL:        ${branch.connectionString}`);
          if (branch.provider === "docker") {
            const dmeta = branch.providerMeta as { databaseName?: string; containerName?: string };
            if (dmeta.databaseName) {
              console.log(`  Database:   ${dmeta.databaseName}`);
            }
            if (dmeta.containerName) {
              console.log(`  Container:  ${dmeta.containerName}`);
            }
          }
          const checkpoints = listCheckpoints(branch.name);
          if (checkpoints.length > 0) {
            console.log(`  Checkpoints: ${checkpoints.map((cp) => cp.name).join(", ")}`);
          }
        }
        break;
      }
      case "delete": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch delete <name>" });
          process.exit(1);
        }
        await deleteBranch(name);
        if (isJSON) {
          console.log(JSON.stringify({ deleted: name }));
        } else if (isQuiet) {
          console.log(`deleted: ${name}`);
        } else {
          console.log(`  ✓ Branch "${name}" deleted`);
        }
        break;
      }
      case "stop": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch stop <name>" });
          process.exit(1);
        }
        await stopBranch(name);
        if (isJSON) {
          console.log(JSON.stringify({ stopped: name }));
        } else if (isQuiet) {
          console.log(`stopped: ${name}`);
        } else {
          console.log(`  ✓ Branch "${name}" stopped`);
        }
        break;
      }
      case "start": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch start <name>" });
          process.exit(1);
        }
        const started = await startBranch(name);
        if (isJSON) {
          console.log(JSON.stringify(started));
        } else if (isQuiet) {
          console.log(started.connectionString);
        } else {
          console.log(`  ✓ Branch "${name}" started on :${started.port}`);
          console.log(`  ${started.connectionString}`);
        }
        break;
      }
      case "reset": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch reset <name>" });
          process.exit(1);
        }
        const reset = await resetBranch(name);
        if (isJSON) {
          console.log(JSON.stringify(reset));
        } else if (isQuiet) {
          console.log(reset.connectionString);
        } else {
          console.log(`  ✓ Branch "${name}" reset to original snapshot`);
        }
        break;
      }
      case "diff": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch diff <name>" });
          process.exit(1);
        }
        const diff = await getDiff(name);
        if (isJSON) {
          console.log(JSON.stringify(diff));
        } else if (isQuiet) {
          if (!diff.hasChanges) {
            console.log("no changes");
          } else {
            for (const t of diff.tables) {
              console.log(`${t.name}\t+${t.rowsAdded}\t-${t.rowsDeleted}`);
            }
            for (const s of diff.schemaChanges) {
              console.log(s.detail);
            }
          }
        } else {
          if (!diff.hasChanges) {
            console.log(`  No changes detected in branch "${name}"`);
          } else {
            console.log();
            if (diff.schemaChanges.length > 0) {
              console.log(`  Schema changes (${diff.schemaChanges.length}):`);
              for (const s of diff.schemaChanges) {
                console.log(`    + ${s.detail}`);
              }
            }
            const modified = diff.tables.filter(
              (t) => t.rowsAdded > 0 || t.rowsDeleted > 0 || t.rowsModified > 0,
            );
            if (modified.length > 0) {
              console.log(`  Data changes:`);
              for (const t of modified) {
                const parts: string[] = [];
                if (t.rowsAdded > 0) parts.push(`+${t.rowsAdded} rows`);
                if (t.rowsDeleted > 0) parts.push(`-${t.rowsDeleted} rows`);
                if (t.rowsModified > 0) parts.push(`~${t.rowsModified} modified`);
                console.log(`    ${t.name}: ${parts.join(", ")}`);
              }
            }
          }
        }
        break;
      }
      case "save": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch save <name> <checkpoint-name>" });
          process.exit(1);
        }
        const cpName = (flags._extraArg as string) || (flags.name as string);
        if (!cpName) {
          log({ type: "error", message: "Usage: sow branch save <name> <checkpoint-name>" });
          process.exit(1);
        }
        const cp = await saveBranch(name, cpName);
        if (isJSON) {
          console.log(JSON.stringify(cp));
        } else if (isQuiet) {
          console.log(cpName);
        } else {
          console.log(`  ✓ Checkpoint "${cpName}" saved (${formatBytes(cp.sizeBytes)})`);
        }
        break;
      }
      case "load": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch load <name> <checkpoint-name>" });
          process.exit(1);
        }
        const cpName = (flags._extraArg as string) || (flags.name as string);
        if (!cpName) {
          log({ type: "error", message: "Usage: sow branch load <name> <checkpoint-name>" });
          process.exit(1);
        }
        await loadBranch(name, cpName);
        if (isJSON) {
          console.log(JSON.stringify({ restored: cpName, branch: name }));
        } else if (isQuiet) {
          console.log(`restored: ${cpName}`);
        } else {
          console.log(`  ✓ Loaded checkpoint "${cpName}" on branch "${name}"`);
        }
        break;
      }
      case "exec": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch exec <name> --sql '...' | --file <path>" });
          process.exit(1);
        }
        let sql = flags.sql as string | undefined;
        if (!sql && flags.file) {
          const filePath = flags.file as string;
          if (!existsSync(filePath)) {
            log({ type: "error", message: `File not found: ${filePath}` });
            process.exit(1);
          }
          sql = readFileSync(filePath, "utf-8");
        }
        if (!sql) {
          log({ type: "error", message: "Provide --sql or --file with SQL to execute" });
          process.exit(1);
        }
        const output = await execBranch(name, sql);
        if (isJSON) {
          console.log(JSON.stringify({ branch: name, output: output.trim() }));
        } else if (isQuiet) {
          if (output.trim()) console.log(output.trim());
        } else {
          console.log(`  ✓ SQL executed on branch "${name}"`);
          if (output.trim()) {
            console.log();
            console.log(output.trim());
          }
        }
        break;
      }
      case "env": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch env <name>" });
          process.exit(1);
        }
        const envVars = getBranchEnv(name);
        if (isJSON) {
          console.log(JSON.stringify(envVars));
        } else if (isQuiet) {
          for (const [k, v] of Object.entries(envVars)) {
            console.log(`${k}=${v}`);
          }
        } else {
          console.log();
          for (const [k, v] of Object.entries(envVars)) {
            console.log(`  ${k}=${v}`);
          }
        }
        if (flags.envFile) {
          const envContent = Object.entries(envVars)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n") + "\n";
          writeFileSync(flags.envFile as string, envContent, "utf-8");
          if (!isJSON && !isQuiet) {
            console.log(`\n  ✓ Written to ${flags.envFile}`);
          }
        }
        break;
      }
      case "users": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch users <name>" });
          process.exit(1);
        }
        const users = await getBranchUsers(name);
        if (isJSON) {
          console.log(JSON.stringify(users));
        } else if (isQuiet) {
          for (const email of users.accounts) {
            console.log(email);
          }
        } else {
          if (users.accounts.length === 0) {
            console.log("  No test accounts found in this branch.");
          } else {
            console.log();
            console.log(`  Test accounts (password for all: ${users.password}):`);
            for (const email of users.accounts) {
              console.log(`    ${email}`);
            }
          }
        }
        break;
      }
      case "tables": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch tables <name>" });
          process.exit(1);
        }
        const tables = await getBranchTables(name);
        if (isJSON) {
          console.log(JSON.stringify(tables));
        } else if (isQuiet) {
          for (const t of tables) {
            console.log(`${t.table}\t${t.rows}`);
          }
        } else {
          if (tables.length === 0) {
            console.log("  No tables found in the public schema.");
          } else {
            const nameW = Math.max(6, ...tables.map((t) => t.table.length)) + 2;
            console.log();
            console.log(`  ${"TABLE".padEnd(nameW)}${"ROWS".padStart(8)}`);
            for (const t of tables) {
              console.log(`  ${t.table.padEnd(nameW)}${String(t.rows).padStart(8)}`);
            }
          }
        }
        break;
      }
      case "sample": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch sample <name> <table>" });
          process.exit(1);
        }
        const tableName = (flags._extraArg as string);
        if (!tableName) {
          log({ type: "error", message: "Usage: sow branch sample <name> <table>" });
          process.exit(1);
        }
        const limit = (flags.limit as number) || 5;
        const rows = await getBranchSample(name, tableName, limit);
        if (isJSON) {
          console.log(JSON.stringify(rows, null, 2));
        } else if (isQuiet) {
          console.log(JSON.stringify(rows));
        } else {
          if (rows.length === 0) {
            console.log(`  No rows in "${tableName}".`);
          } else {
            const cols = Object.keys(rows[0]);
            console.log();
            console.log(`  ${cols.join(" | ")}`);
            console.log(`  ${cols.map((c) => "-".repeat(c.length)).join("-+-")}`);
            for (const row of rows) {
              console.log(`  ${cols.map((c) => String(row[c] ?? "")).join(" | ")}`);
            }
          }
        }
        break;
      }
      case "run": {
        if (!name) {
          log({ type: "error", message: "Usage: sow branch run <name> -- <command...>" });
          process.exit(1);
        }
        const cmdArgs = flags._runArgs as string[] | undefined;
        if (!cmdArgs || cmdArgs.length === 0) {
          log({ type: "error", message: "Usage: sow branch run <name> -- <command...>\nExample: sow branch run dev -- npm run dev" });
          process.exit(1);
        }
        if (!isJSON && !isQuiet) {
          const env = getBranchEnv(name);
          console.error(`  Running with branch "${name}" env vars:`);
          for (const [k, v] of Object.entries(env)) {
            console.error(`    ${k}=${v}`);
          }
          console.error();
        }
        await runWithBranchEnv(name, cmdArgs);
        break;
      }
      default:
        log({ type: "error", message: `Unknown branch subcommand: ${subcommand}` });
        process.exit(1);
    }
  } catch (err) {
    if (!isJSON && !isQuiet) {
      printError(err instanceof Error ? err.message : String(err));
    } else {
      log({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
    process.exit(1);
  }
}
