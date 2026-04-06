import { writeFileSync, existsSync } from "node:fs";
import { formatBytes, maskConnectionString, confirm, selectFromList, promptInput, appendToEnvFile } from "../utils.js";
import {
  ConnectionError,
  type ProgressEvent,
  type DetectedConnection,
  type DetectedProvider,
  isValidPostgresUrl,
  createConnector,
  saveProjectState,
  generateDefaultConfig,
  type mergeConfig,
  type detectConnection,
} from "@sowdb/core";
import { logError } from "./runner.js";

async function promptForConnectionString(): Promise<string> {
  while (true) {
    const input = await promptInput("Connection string:");
    if (!input) continue;

    if (isValidPostgresUrl(input)) {
      return input;
    }

    console.error("  ✗ Invalid connection string. Must start with postgresql:// or postgres://\n");
  }
}

export async function promptWithProviderGuidance(
  detection: { providers: DetectedProvider[]; hints: string[] },
): Promise<string> {
  if (detection.providers.length > 0) {
    const provider = detection.providers[0];
    const ref = provider.projectRef ? ` (${provider.projectRef})` : "";
    console.error(`  ✓ Detected ${provider.name} project${ref}\n`);
    console.error("  To connect, you need your database connection string:");
    for (let i = 0; i < provider.guidance.length; i++) {
      console.error(`    ${i + 1}. ${provider.guidance[i]}`);
    }
    console.error();
  } else if (detection.hints.length > 0) {
    for (const hint of detection.hints) {
      console.error(`  ℹ ${hint}`);
    }
    console.error();
  }

  const connStr = await promptForConnectionString();

  const shouldSave = await confirm("Save to .env as DATABASE_URL for next time?");
  if (shouldSave) {
    try {
      appendToEnvFile(process.cwd(), "DATABASE_URL", connStr);
      console.error("  ✓ Saved to .env\n");
    } catch {
      console.error("  ⚠ Could not save to .env\n");
    }
  }

  return connStr;
}

export async function resolveConnectionViaDetectionResult(
  detection: ReturnType<typeof detectConnection>,
  flags: Record<string, unknown>,
  log: (event: ProgressEvent) => void,
): Promise<string> {
  const isJSON = !!flags.json;
  const isQuiet = !!flags.quiet;

  if (!isJSON && !isQuiet) {
    for (const warning of detection.warnings) {
      console.error(`  ⚠ ${warning}`);
    }
  }

  if (detection.connections.length === 0) {
    if (isJSON) {
      console.log(JSON.stringify({
        type: "detection",
        connections: [],
        providers: detection.providers,
        hints: detection.hints,
        warnings: detection.warnings,
      }));
      process.exit(0);
    }

    if (isQuiet || !process.stdin.isTTY) {
      log({ type: "error", message: "No database connection found. Pass a connection string:\n  sow connect postgresql://user:pass@host:5432/dbname" });
      process.exit(1);
    }

    return await promptWithProviderGuidance(detection);
  }

  if (detection.connections.length === 1) {
    const conn = detection.connections[0];

    if (isJSON) {
      console.log(JSON.stringify({
        type: "detection",
        connections: detection.connections.map(formatDetectionJSON),
        providers: detection.providers,
        hints: detection.hints,
        warnings: detection.warnings,
      }));
      process.exit(0);
    }

    if (isQuiet) {
      return conn.connectionString;
    }

    console.error(`  ✓ Detected ${conn.source} (${conn.sourceFile})`);
    console.error(`  ✓ Connection: ${maskConnectionString(conn.connectionString)}`);
    console.error();

    const confirmed = await confirm("Connect to this database?");
    if (confirmed) return conn.connectionString;

    // User declined -- fall through to provider guidance / manual prompt
    console.error();
    return await promptWithProviderGuidance(detection);
  }

  // Multiple connections found
  if (isJSON) {
    console.log(JSON.stringify({
      type: "detection",
      connections: detection.connections.map(formatDetectionJSON),
      providers: detection.providers,
      hints: detection.hints,
      warnings: detection.warnings,
    }));
    process.exit(0);
  }

  if (isQuiet) {
    // In quiet mode, use the first (highest confidence) connection
    return detection.connections[0].connectionString;
  }

  console.error(`  Found ${detection.connections.length} possible connections:\n`);

  const selected = await selectFromList(
    detection.connections,
    (conn: DetectedConnection, isSelected: boolean) => {
      const prefix = isSelected ? "> " : "  ";
      const label = conn.envVar
        ? `${conn.envVar} (${conn.sourceFile})`
        : `${conn.source} (${conn.sourceFile})`;
      return `${prefix}${label}`;
    },
  );

  return selected.connectionString;
}

function formatDetectionJSON(conn: DetectedConnection) {
  return {
    source: conn.source,
    sourceFile: conn.sourceFile,
    envVar: conn.envVar,
    connectionString: conn.connectionString,
    confidence: conn.confidence,
  };
}

export async function tryConnect(
  connectionString: string,
  flags: Record<string, unknown>,
  merged: ReturnType<typeof mergeConfig>,
  log: (event: ProgressEvent) => void,
): Promise<boolean> {
  try {
    await runConnect(connectionString, flags, merged, log);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("connection refused") || msg.toLowerCase().includes("connection refused")) {
      return false;
    }
    throw err;
  }
}

export async function offerDockerStart(
  dockerInfo: { image: string; env: Record<string, string>; port: string },
): Promise<boolean> {
  console.error();
  console.error("  The database doesn't seem to be running.");
  const shouldStart = await confirm("Start a Docker container for it?");
  if (!shouldStart) return false;

  const { execSync } = await import("node:child_process");
  const envFlags = Object.entries(dockerInfo.env)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(" ");
  const cmd = `docker run -d --name sow-autostart-pg ${envFlags} -p ${dockerInfo.port}:5432 ${dockerInfo.image}`;

  try {
    console.error(`  Starting container...\n`);
    execSync(cmd, { stdio: "pipe" });
    // Wait for postgres to be ready
    await new Promise((r) => setTimeout(r, 4000));
    console.error("  ✓ Container started\n");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already in use") || msg.includes("already exists")) {
      console.error("  ⚠ A container with that name already exists. Trying to start it...\n");
      try {
        execSync("docker start sow-autostart-pg", { stdio: "pipe" });
        await new Promise((r) => setTimeout(r, 3000));
        console.error("  ✓ Container started\n");
        return true;
      } catch {
        console.error("  ✗ Could not start the container\n");
        return false;
      }
    }
    console.error(`  ✗ Failed to start container: ${msg}\n`);
    return false;
  }
}

export async function runConnect(
  connectionString: string,
  flags: Record<string, unknown>,
  merged: ReturnType<typeof mergeConfig>,
  log: (event: ProgressEvent) => void,
): Promise<void> {
  const isFullCopy = !!flags.full;
  const startTime = Date.now();

  try {
    const result = await createConnector(connectionString, {
      name: flags.name as string | undefined,
      full: isFullCopy,
      maxRowsPerTable: merged.samplingConfig.maxRowsPerTable,
      excludeTables: merged.samplingConfig.excludeTables.length > 0
        ? merged.samplingConfig.excludeTables
        : undefined,
      noSanitize: !merged.sanitizationConfig.enabled,
      allowUnsafe: !!flags.allowUnsafe,
      seed: merged.samplingConfig.seed,
    }, log);

    saveProjectState({ defaultConnector: result.name });

    if (!existsSync(".sow.yml")) {
      writeFileSync(".sow.yml", generateDefaultConfig({
        maxRowsPerTable: merged.samplingConfig.maxRowsPerTable,
        seed: merged.samplingConfig.seed,
        excludeTables: merged.samplingConfig.excludeTables,
        sanitize: merged.sanitizationConfig.enabled,
      }), "utf-8");
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const modeLabel = isFullCopy ? "full copy" : "sampled";
    const timeStr = elapsed > 0 ? ` in ${elapsed}s` : "";

    if (flags.json) {
      console.log(JSON.stringify({ type: "result", data: { ...result, mode: modeLabel, elapsedSeconds: elapsed } }));
    } else if (flags.quiet) {
      console.log(result.name);
    } else {
      console.log();
      if (result.tables === 0) {
        console.log(`  ⚠ Connected successfully but found 0 tables.`);
        console.log();
        console.log("  This usually means:");
        console.log("    - The database was just created and has no schema yet");
        console.log("    - You connected to the wrong database");
        console.log("    - The tables are in a different schema (sow reads the public schema)");
        console.log();
        console.log("  Try connecting to a database with existing tables, or run your migrations first.");
      } else {
        console.log(`  ✓ Snapshot saved as "${result.name}" (${result.tables} tables, ${result.rows.toLocaleString()} rows, ${formatBytes(result.sizeBytes)})${timeStr} [${modeLabel}]`);
        if (result.piiColumnsDetected > 0) {
          if (merged.sanitizationConfig.enabled) {
            console.log(`  ℹ ${result.piiColumnsDetected} PII columns detected and sanitized`);
          } else {
            console.log(`  ℹ ${result.piiColumnsDetected} PII columns detected (sanitization disabled)`);
          }
        }
        console.log();
        console.log("  Next step — create an isolated branch to work with:");
        console.log(`    $ sow branch create dev`);
      }
    }
  } catch (err) {
    logError(err, log);
    throw err;
  }
}
