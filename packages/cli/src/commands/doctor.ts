import {
  listConnectors,
  listBranches,
  getSowDir,
  getConnectorMetadata,
  type ConnectorInfo,
  type Branch,
  type IntegrityWarning,
} from "@sowdb/core";
import { execSync } from "node:child_process";
import { existsSync, accessSync, constants, statSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { formatBytes, timeAgo } from "../utils.js";

export interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
  hint?: string;
}

function getVersion(): string {
  return "0.1.0";
}

function checkDocker(): CheckResult {
  try {
    const raw = execSync("docker info --format '{{.ServerVersion}}'", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { name: "Docker running", status: "pass", detail: `v${raw}` };
  } catch {
    try {
      const ver = execSync("docker --version", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return {
        name: "Docker installed but not running",
        status: "fail",
        detail: ver,
        hint: "Start Docker Desktop or the Docker daemon",
      };
    } catch {
      return {
        name: "Docker",
        status: "fail",
        detail: "Not found",
        hint: "Install Docker: https://docs.docker.com/get-docker/",
      };
    }
  }
}

function checkDockerImage(): CheckResult {
  try {
    execSync("docker image inspect postgres:16-alpine", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      name: "Docker can pull postgres:16-alpine",
      status: "pass",
      detail: "Image available locally",
    };
  } catch {
    return {
      name: "Docker can pull postgres:16-alpine",
      status: "warn",
      detail: "Image not cached locally (will be pulled on first use)",
    };
  }
}

function checkPortAvailability(): CheckResult {
  let free = 0;
  for (let port = 54320; port <= 54399; port++) {
    try {
      const srv = createServer();
      srv.listen(port, "127.0.0.1");
      srv.close();
      free++;
    } catch {
      // port in use
    }
  }
  return {
    name: `Ports 54320-54399 available`,
    status: free > 0 ? "pass" : "fail",
    detail: `${free} free`,
    hint: free === 0 ? "All sow ports are in use" : undefined,
  };
}

function checkSowDir(): CheckResult {
  const dir = getSowDir();
  if (!existsSync(dir)) {
    return {
      name: ".sow/ directory",
      status: "warn",
      detail: "Does not exist yet (will be created on first use)",
    };
  }
  try {
    accessSync(dir, constants.R_OK | constants.W_OK);
    return { name: ".sow/ directory", status: "pass", detail: `${dir}` };
  } catch {
    return {
      name: ".sow/ directory",
      status: "fail",
      detail: "Exists but not writable",
      hint: `Fix permissions: chmod 755 ${dir}`,
    };
  }
}

function checkConnectors(connectors: ConnectorInfo[]): CheckResult[] {
  if (connectors.length === 0) return [];

  const snapshotsDir = join(getSowDir(), "snapshots");

  return connectors.map((c) => {
    const initSql = join(snapshotsDir, c.name, "init.sql");
    if (!existsSync(initSql)) {
      return {
        name: `Connector "${c.name}"`,
        status: "fail" as const,
        detail: "Snapshot file missing",
        hint: `Run: sow connector refresh ${c.name}`,
      };
    }
    const size = statSync(initSql).size;

    // If the connector has integrity warnings from sampling, surface that
    // so users know to run `sow doctor <name>` for the full list rather
    // than discovering it the hard way via a dangling FK in the sandbox.
    const meta = getConnectorMetadata(c.name);
    const warningCount = meta?.integrityWarnings?.length ?? 0;
    if (warningCount > 0) {
      return {
        name: `Connector "${c.name}" has ${warningCount} integrity warning(s)`,
        status: "warn" as const,
        detail: `snapshot: ${formatBytes(size)}, created ${c.createdAt ? timeAgo(c.createdAt) : "unknown"}`,
        hint: `Run: sow doctor ${c.name}`,
      };
    }

    return {
      name: `Connector "${c.name}" healthy`,
      status: "pass" as const,
      detail: `snapshot: ${formatBytes(size)}, created ${c.createdAt ? timeAgo(c.createdAt) : "unknown"}`,
    };
  });
}

function checkBranches(branches: Branch[]): CheckResult[] {
  return branches.map((b) => {
    if (b.status === "running") {
      try {
        const containerName = (b.providerMeta as any)?.containerName;
        if (!containerName) {
          return {
            name: `Branch "${b.name}"`,
            status: "warn" as const,
            detail: "No container name found in provider metadata",
          };
        }
        execSync(`docker inspect ${containerName} --format '{{.State.Status}}'`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return {
          name: `Branch "${b.name}"`,
          status: "pass" as const,
          detail: `:${b.port}  running  ${timeAgo(b.createdAt)}`,
        };
      } catch {
        return {
          name: `Branch "${b.name}"`,
          status: "warn" as const,
          detail: "Listed as running but container not found",
        };
      }
    }
    return {
      name: `Branch "${b.name}"`,
      status: "pass" as const,
      detail: `:${b.port}  ${b.status}  ${timeAgo(b.createdAt)}`,
    };
  });
}

function checkMcpConfig(): CheckResult {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  const locations = [
    join(home, ".claude", "settings.json"),
    join(process.cwd(), ".cursor", "mcp.json"),
    join(home, ".windsurf", "settings.json"),
  ];

  const found: string[] = [];
  for (const loc of locations) {
    if (existsSync(loc)) {
      try {
        const content = readFileSync(loc, "utf-8");
        if (content.includes("sow")) {
          const agent = loc.includes(".claude")
            ? "Claude Code"
            : loc.includes(".cursor")
              ? "Cursor"
              : "Windsurf";
          found.push(agent);
        }
      } catch {
        // skip unreadable
      }
    }
  }

  if (found.length > 0) {
    return {
      name: "MCP server configured",
      status: "pass",
      detail: found.join(", "),
    };
  }

  return {
    name: "No MCP server configured for any agent",
    status: "warn",
    detail: "",
    hint: "Run: sow mcp --agent <agent-name>",
  };
}

function getDiskUsage(): CheckResult {
  const dir = getSowDir();
  if (!existsSync(dir)) {
    return { name: "Disk usage", status: "pass", detail: "0 B" };
  }

  let total = 0;
  function walk(d: string) {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else total += statSync(p).size;
      }
    } catch {
      // skip unreadable dirs
    }
  }
  walk(dir);

  return { name: "Disk usage", status: "pass", detail: formatBytes(total) };
}

export interface ConnectorWarningsReport {
  found: boolean;
  name: string;
  tables: number;
  rows: number;
  snapshotSize: string;
  warnings: IntegrityWarning[];
}

/**
 * Fetch a per-connector report of referential-integrity warnings.
 * Used by `sow doctor <connector-name>` to drill into the warnings
 * that `sow connect` summarized as a count on the result line.
 */
export function describeConnectorWarnings(
  connectorName: string,
): ConnectorWarningsReport {
  const meta = getConnectorMetadata(connectorName);
  if (!meta) {
    return {
      found: false,
      name: connectorName,
      tables: 0,
      rows: 0,
      snapshotSize: "0 B",
      warnings: [],
    };
  }
  return {
    found: true,
    name: meta.name,
    tables: meta.tables,
    rows: meta.rows,
    snapshotSize: formatBytes(meta.sizeBytes),
    warnings: meta.integrityWarnings ?? [],
  };
}

export async function runDoctorChecks(): Promise<CheckResult[]> {
  const connectors = listConnectors();
  const branches = await listBranches();

  const checks: CheckResult[] = [
    { name: `sow v${getVersion()}`, status: "pass", detail: "" },
    checkDocker(),
    checkDockerImage(),
    checkPortAvailability(),
    checkSowDir(),
    ...checkConnectors(connectors),
    checkMcpConfig(),
  ];

  if (branches.length > 0) {
    checks.push(...checkBranches(branches));
  }

  checks.push(getDiskUsage());

  return checks;
}
