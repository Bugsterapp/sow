import { execFile as execFileCb, spawn as spawnCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const POSTGRES_USER = "sow";
const POSTGRES_PASSWORD = "sow";
const POSTGRES_DB = "sow";

export interface CreateContainerOptions {
  containerName: string;
  initSqlPath: string;
  port: number;
  pgVersion: string;
}

export async function ensureDocker(): Promise<void> {
  try {
    await execFile("docker", ["info"], { timeout: 10_000 });
  } catch {
    throw new Error(
      "Docker is not running. sow needs Docker to create database branches.\n" +
        "Install Docker: https://docs.docker.com/get-docker/",
    );
  }
}

export async function createContainer(
  opts: CreateContainerOptions,
): Promise<string> {
  const { containerName, initSqlPath, port, pgVersion } = opts;

  // Create a shell wrapper that runs init.sql without ON_ERROR_STOP,
  // so one bad row doesn't crash the entire import.
  const { writeFileSync: writeFs, chmodSync } = await import("node:fs");
  const { dirname: dirnameFn, join: joinFn } = await import("node:path");
  const wrapperPath = joinFn(dirnameFn(initSqlPath), "init-wrapper.sh");
  writeFs(
    wrapperPath,
    `#!/bin/bash\npsql -v ON_ERROR_STOP=0 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /data/init.sql\n`,
    "utf-8",
  );
  chmodSync(wrapperPath, 0o755);

  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "-p",
    `${port}:5432`,
    "-e",
    `POSTGRES_DB=${POSTGRES_DB}`,
    "-e",
    `POSTGRES_USER=${POSTGRES_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
    "-v",
    `${initSqlPath}:/data/init.sql:ro`,
    "-v",
    `${wrapperPath}:/docker-entrypoint-initdb.d/init-wrapper.sh:ro`,
    `postgres:${pgVersion}-alpine`,
  ];

  const { stdout } = await execFile("docker", args, { timeout: 30_000 });
  return stdout.trim();
}

export async function stopContainer(containerName: string): Promise<void> {
  await execFile("docker", ["stop", containerName], { timeout: 30_000 });
}

export async function startContainer(containerName: string): Promise<void> {
  await execFile("docker", ["start", containerName], { timeout: 30_000 });
}

export async function removeContainer(containerName: string): Promise<void> {
  try {
    await execFile("docker", ["rm", "-f", containerName], { timeout: 15_000 });
  } catch {
    // Container may already be removed
  }
}

export async function waitForReady(
  containerName: string,
  timeoutMs = 120_000,
): Promise<void> {
  const start = Date.now();
  const pollInterval = 1_000;

  while (Date.now() - start < timeoutMs) {
    try {
      // pg_isready confirms Postgres is accepting connections, but init.sql may
      // still be running. Follow up with a simple query to confirm the database
      // is actually usable.
      const { stdout } = await execFile(
        "docker",
        ["exec", containerName, "pg_isready", "-U", POSTGRES_USER, "-d", POSTGRES_DB],
        { timeout: 5_000 },
      );
      if (stdout.includes("accepting connections")) {
        // Verify init.sql has finished by running a test query
        try {
          await execFile(
            "docker",
            ["exec", containerName, "psql", "-U", POSTGRES_USER, "-d", POSTGRES_DB, "-c", "SELECT 1"],
            { timeout: 5_000 },
          );
          return;
        } catch {
          // Init still running — keep waiting
        }
      }
    } catch {
      // Not ready yet
    }
    await sleep(pollInterval);
  }

  throw new Error(
    `Postgres container '${containerName}' did not become ready within ${timeoutMs / 1000}s`,
  );
}

export async function getContainerStatus(
  containerName: string,
): Promise<"running" | "stopped" | "not_found"> {
  try {
    const { stdout } = await execFile(
      "docker",
      ["inspect", "--format", "{{.State.Running}}", containerName],
      { timeout: 5_000 },
    );
    return stdout.trim() === "true" ? "running" : "stopped";
  } catch {
    return "not_found";
  }
}

export async function dumpBranch(containerName: string): Promise<string> {
  const { stdout } = await execFile(
    "docker",
    [
      "exec",
      containerName,
      "pg_dump",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
      "--no-owner",
      "--no-privileges",
    ],
    { timeout: 30_000, maxBuffer: 50 * 1024 * 1024 },
  );
  return stdout;
}

export async function restoreFromDump(
  containerName: string,
  sqlContent: string,
): Promise<void> {
  await execFile(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
      "-c",
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
    ],
    { timeout: 10_000 },
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawnCb("docker", [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
    ]);

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Restore failed (exit ${code}): ${stderr}`));
      } else {
        resolve();
      }
    });

    child.on("error", reject);

    child.stdin.write(sqlContent);
    child.stdin.end();
  });
}

export async function execSql(
  containerName: string,
  sql: string,
): Promise<string> {
  const { stdout } = await execFile(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_DB,
      "-c",
      sql,
    ],
    { timeout: 30_000 },
  );
  return stdout;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
