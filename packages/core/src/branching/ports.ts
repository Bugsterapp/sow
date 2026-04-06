import { createServer } from "node:net";
import { execSync } from "node:child_process";
import { readBranches } from "./storage.js";

const PORT_RANGE_START = 54320;
const PORT_RANGE_END = 54399;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/** Get ports already bound by Docker containers. */
function getDockerPorts(): Set<number> {
  try {
    const output = execSync(
      'docker ps --format "{{.Ports}}"',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const ports = new Set<number>();
    for (const match of output.matchAll(/0\.0\.0\.0:(\d+)->/g)) {
      ports.add(parseInt(match[1], 10));
    }
    return ports;
  } catch {
    return new Set();
  }
}

export async function findFreePort(preferredPort?: number): Promise<number> {
  const dockerPorts = getDockerPorts();

  if (preferredPort !== undefined) {
    if (preferredPort < PORT_RANGE_START || preferredPort > PORT_RANGE_END) {
      throw new Error(
        `Port ${preferredPort} is outside the sow range (${PORT_RANGE_START}-${PORT_RANGE_END})`,
      );
    }
    if (dockerPorts.has(preferredPort)) {
      throw new Error(`Port ${preferredPort} is already in use by a Docker container`);
    }
    const free = await isPortFree(preferredPort);
    if (!free) {
      throw new Error(`Port ${preferredPort} is already in use`);
    }
    return preferredPort;
  }

  const usedPorts = new Set(
    readBranches()
      .filter((b) => b.status !== "error")
      .map((b) => b.port),
  );

  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (usedPorts.has(port)) continue;
    if (dockerPorts.has(port)) continue;
    const free = await isPortFree(port);
    if (free) return port;
  }

  throw new Error(
    `All ports in range ${PORT_RANGE_START}-${PORT_RANGE_END} are in use. ` +
      "Delete some branches with: sow branch delete <name>",
  );
}
