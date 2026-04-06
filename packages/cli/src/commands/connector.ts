import { formatBytes, timeAgo } from "../utils.js";
import {
  type ProgressEvent,
  listConnectors,
  deleteConnector,
  refreshConnector,
} from "@sowdb/core";
import { printError } from "./runner.js";

export async function runConnectorCmd(
  subcommand: string,
  name: string | undefined,
  flags: Record<string, unknown>,
  log: (event: ProgressEvent) => void,
): Promise<void> {
  const isJSON = !!flags.json;
  const isQuiet = !!flags.quiet;

  try {
    switch (subcommand) {
      case "list": {
        const connectors = listConnectors();
        if (isJSON) {
          console.log(JSON.stringify(connectors));
        } else if (isQuiet) {
          for (const c of connectors) {
            console.log(`${c.name}\t${c.tables} tables\t${c.rows} rows`);
          }
        } else if (connectors.length === 0) {
          console.log("  No connectors found. Create one:");
          console.log("    $ sow connect <connection-string>");
        } else {
          const nameW = Math.max(6, ...connectors.map((c) => c.name.length)) + 2;
          console.log();
          console.log(`  ${"NAME".padEnd(nameW)}${"TABLES".padStart(8)}${"ROWS".padStart(10)}${"SIZE".padStart(10)}  CREATED`);
          for (const c of connectors) {
            console.log(`  ${c.name.padEnd(nameW)}${String(c.tables).padStart(8)}${String(c.rows).padStart(10)}${formatBytes(c.sizeBytes).padStart(10)}  ${timeAgo(c.createdAt)}`);
          }
        }
        break;
      }
      case "delete": {
        if (!name) {
          log({ type: "error", message: "Usage: sow connector delete <name>" });
          process.exit(1);
        }
        await deleteConnector(name);
        if (isJSON) {
          console.log(JSON.stringify({ deleted: name }));
        } else if (isQuiet) {
          console.log(`deleted: ${name}`);
        } else {
          console.log(`  ✓ Connector "${name}" deleted`);
        }
        break;
      }
      case "refresh": {
        if (!name) {
          log({ type: "error", message: "Usage: sow connector refresh <name>" });
          process.exit(1);
        }
        const result = await refreshConnector(name, log);
        if (isJSON) {
          console.log(JSON.stringify({ type: "result", data: result }));
        } else if (isQuiet) {
          console.log(result.name);
        } else {
          console.log();
          console.log(`  ✓ Connector "${result.name}" refreshed (${result.tables} tables, ${result.rows} rows, ${formatBytes(result.sizeBytes)})`);
        }
        break;
      }
      default:
        log({ type: "error", message: `Unknown connector subcommand: ${subcommand}` });
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
