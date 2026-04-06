import { formatBytes, getErrorHint } from "../utils.js";
import {
  PostgresAdapter,
  analyze,
  ConnectionError,
  type ProgressEvent,
  normalizePostgresUrl,
  loadProjectConfig,
  loadGlobalConfig,
  mergeConfig,
  loadProjectState,
  detectConnection,
} from "@sowdb/core";
import { runConnect, tryConnect, offerDockerStart, promptWithProviderGuidance, resolveConnectionViaDetectionResult } from "./connect.js";
import { runBranch } from "./branch.js";
import { runConnectorCmd } from "./connector.js";
import { runSandbox } from "./sandbox.js";
import { runEnv } from "./env.js";

function emitJSON(event: ProgressEvent): void {
  console.log(JSON.stringify(event));
}

export function logError(err: unknown, log: (event: ProgressEvent) => void): void {
  if (err instanceof ConnectionError) {
    log({ type: "error", message: `${err.message}\n  → ${err.hint}` });
  } else {
    log({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

export function printError(message: string): void {
  const hint = getErrorHint(message);
  console.error(`  ✗ ${message}`);
  if (hint) console.error(`  → ${hint}`);
}

function createLog(flags: Record<string, unknown>): (event: ProgressEvent) => void {
  if (flags.json) return emitJSON;

  if (flags.quiet) {
    return (event: ProgressEvent) => {
      if (event.type === "error") console.error(`Error: ${event.message}`);
    };
  }

  return (event: ProgressEvent) => {
    if (event.type === "error") {
      printError(event.message);
    } else if (event.message) {
      console.error(`  ${event.message}`);
    }
  };
}

export async function runCommand(
  command: string,
  connectionString: string | undefined,
  flags: Record<string, unknown>,
  subcommand?: string,
  branchName?: string,
): Promise<void> {
  const log = createLog(flags);

  const projectConfig = loadProjectConfig(
    process.cwd(),
    flags.config as string | undefined,
  );
  const globalConfig = loadGlobalConfig();
  const merged = mergeConfig(
    { ...flags, connectionString },
    projectConfig,
    globalConfig,
  );

  const resolvedConn = connectionString || merged.connectionString;

  if (!connectionString && resolvedConn && !flags.json && !flags.quiet) {
    const ps = loadProjectState();
    if (ps.defaultConnector) {
      console.error(`  Using default connector: ${ps.defaultConnector}`);
    }
  }

  switch (command) {
    case "connect": {
      let connStr = resolvedConn;
      let detectionResult: ReturnType<typeof detectConnection> | undefined;

      if (!connStr) {
        if (!flags.json && !flags.quiet) {
          console.error("\n  Scanning project...\n");
        }
        detectionResult = detectConnection(process.cwd());
        connStr = await resolveConnectionViaDetectionResult(detectionResult, flags, log);
      }

      connStr = normalizePostgresUrl(connStr);

      try {
        const success = await tryConnect(connStr, flags, merged, log);
        if (!success && !flags.json && !flags.quiet && process.stdin.isTTY) {
          const dockerConn = detectionResult?.connections.find(
            (c) => c.connectionString === connStr && c.dockerStart,
          );
          if (dockerConn?.dockerStart) {
            const started = await offerDockerStart(dockerConn.dockerStart);
            if (started) {
              await runConnect(connStr, flags, merged, log);
              break;
            }
          }
          // Docker start declined or not available -- fall through to provider prompt
          if (detectionResult) {
            console.error();
            const altConn = await promptWithProviderGuidance(detectionResult);
            await runConnect(altConn, flags, merged, log);
            break;
          }
          process.exit(1);
        }
        if (!success) process.exit(1);
      } catch {
        process.exit(1);
      }
      break;
    }
    case "branch":
      if (!subcommand) {
        log({ type: "error", message: "Missing subcommand. Usage: sow branch <create|list|info|delete|diff|reset|save|load|exec|stop|start>" });
        process.exit(1);
      }
      await runBranch(subcommand, branchName, flags, log);
      break;
    case "connector":
      if (!subcommand) {
        log({ type: "error", message: "Missing subcommand. Usage: sow connector <list|delete|refresh>" });
        process.exit(1);
      }
      await runConnectorCmd(subcommand, branchName, flags, log);
      break;
    case "analyze":
      if (!resolvedConn) {
        log({ type: "error", message: "Missing connection string. Usage: sow analyze <connection-string>" });
        process.exit(1);
      }
      await runAnalyze(resolvedConn, flags, log, merged);
      break;
    case "doctor":
      await runDoctor(flags, connectionString);
      break;
    case "mcp":
      await runMcp(flags);
      break;
    case "sandbox":
      await runSandbox(connectionString, flags as Parameters<typeof runSandbox>[1], log);
      break;
    case "env":
      await runEnv(subcommand, branchName, flags as Parameters<typeof runEnv>[2]);
      break;
    default:
      log({ type: "error", message: `Unknown command: ${command}. Run sow --help to see available commands.` });
      process.exit(1);
  }
}

async function runAnalyze(
  connectionString: string,
  flags: Record<string, unknown>,
  log: (event: ProgressEvent) => void,
  merged?: ReturnType<typeof mergeConfig>,
): Promise<void> {
  const adapter = new PostgresAdapter();

  try {
    log({ type: "connecting", message: "Connecting to database..." });
    await adapter.connect(connectionString);

    const tables = flags.tables
      ? String(flags.tables).split(",").map((s) => s.trim())
      : undefined;

    const analysis = await analyze(adapter, {
      tables,
      onProgress: log,
    });

    if (flags.json) {
      console.log(JSON.stringify({ type: "result", data: analysis }));
    } else if (flags.quiet) {
      console.log(
        `${analysis.stats.tables.length} tables, ${analysis.stats.totalRows} rows, ${analysis.patterns.piiColumns.length} PII columns`,
      );
    } else {
      console.log();
      console.log(`  ${analysis.stats.tables.length} tables, ${analysis.stats.totalRows.toLocaleString()} rows`);
      console.log();
      const nameW = Math.max(6, ...analysis.stats.tables.map((t) => t.table.length)) + 2;
      console.log(`  ${"TABLE".padEnd(nameW)}${"ROWS".padStart(10)}${"COLS".padStart(8)}${"PII".padStart(6)}`);
      const piiByTable = new Map<string, number>();
      for (const p of analysis.patterns.piiColumns) {
        piiByTable.set(p.table, (piiByTable.get(p.table) || 0) + 1);
      }
      for (const t of analysis.stats.tables) {
        const pii = piiByTable.get(t.table) || 0;
        console.log(`  ${t.table.padEnd(nameW)}${t.rowCount.toLocaleString().padStart(10)}${String(t.columnStats.length).padStart(8)}${String(pii).padStart(6)}`);
      }
      if (analysis.patterns.piiColumns.length > 0) {
        console.log();
        console.log(`  ${analysis.patterns.piiColumns.length} PII columns detected:`);
        for (const p of analysis.patterns.piiColumns) {
          console.log(`    ${p.table}.${p.column} (${p.type})`);
        }
      }
    }
  } catch (err) {
    logError(err, log);
    process.exit(1);
  } finally {
    await adapter.disconnect();
  }
}

async function runDoctor(
  flags: Record<string, unknown>,
  connectorName?: string,
): Promise<void> {
  const { runDoctorChecks, describeConnectorWarnings } = await import("./doctor.js");

  // If a connector name was passed, print a detailed warnings report
  // for that connector instead of the generic system checks.
  if (connectorName) {
    const report = describeConnectorWarnings(connectorName);
    if (flags.json) {
      console.log(JSON.stringify(report));
      return;
    }
    if (!report.found) {
      console.error(`  ✗ Connector "${connectorName}" not found.`);
      process.exit(1);
    }
    console.log();
    console.log(`  Connector "${connectorName}"`);
    console.log(`  ${report.tables} tables, ${report.rows.toLocaleString()} rows, snapshot ${report.snapshotSize}`);
    console.log();
    if (report.warnings.length === 0) {
      console.log("  ✓ No referential integrity warnings — every FK resolved cleanly.");
      return;
    }
    console.log(`  ⚠ ${report.warnings.length} referential integrity warning(s):`);
    console.log();
    for (const w of report.warnings) {
      const src = w.sourceTable
        ? `${w.sourceTable}.${(w.sourceColumns ?? []).join(",")}`
        : "(implicit)";
      const tgt = `${w.targetTable}${w.targetColumns ? "." + w.targetColumns.join(",") : ""}`;
      console.log(`    • [${w.kind}] ${src} → ${tgt}`);
      console.log(`      ${w.reason}`);
    }
    console.log();
    console.log("  These FKs may be dangling in the sandbox. Root causes vary:");
    console.log("    - `parent_not_found`: the source DB itself has orphaned rows");
    console.log("    - `*_fetch_failed`: a transient read error hit the sampler");
    console.log("  Run `sow connector refresh <name>` to retry sampling.");
    return;
  }

  const checks = await runDoctorChecks();

  if (flags.json) {
    console.log(JSON.stringify(checks));
  } else if (flags.quiet) {
    const failures = checks.filter((c: { status: string }) => c.status === "fail");
    for (const f of failures) {
      console.log(`FAIL: ${f.name} — ${f.detail}`);
      if (f.hint) console.log(`  → ${f.hint}`);
    }
    if (failures.length === 0) console.log("ok");
  } else {
    console.log();
    for (const c of checks) {
      const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "⚠";
      const detail = c.detail ? `  ${c.detail}` : "";
      console.log(`  ${icon} ${c.name}${detail}`);
      if (c.hint) {
        console.log(`    → ${c.hint}`);
      }
    }
  }
}

async function runMcp(flags: Record<string, unknown>): Promise<void> {
  const { getMcpConfig } = await import("./mcp.js");
  const agent = flags.agent as string | undefined;
  const isLocal = !!flags.local;

  if (!agent) {
    const message = "Specify --agent (claude-code, cursor, windsurf, codex) or use --setup for interactive configuration.";
    if (flags.json) {
      console.log(JSON.stringify({ type: "info", message }));
    } else {
      console.log(`  ${message}`);
    }
    return;
  }

  const config = getMcpConfig(agent, isLocal);
  if (!config) {
    const message = `Unknown agent: ${agent}. Use claude-code, cursor, windsurf, or codex.`;
    if (flags.json) {
      console.log(JSON.stringify({ type: "error", message }));
    } else {
      console.error(`  ✗ ${message}`);
    }
    process.exit(1);
  }

  if (flags.json) {
    console.log(JSON.stringify(config));
  } else {
    console.log();
    console.log(`  ${config.instructions}`);
    console.log();
    console.log(JSON.stringify(config.config, null, 2));
  }
}
