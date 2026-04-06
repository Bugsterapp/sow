import { execFile as execFileCb, spawn as spawnCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export const POSTGRES_USER = "sow";
export const POSTGRES_PASSWORD = "sow";
export const POSTGRES_DB = "sow";
/** Bootstrap database used to create/drop other databases. */
export const POSTGRES_BOOTSTRAP_DB = "postgres";

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

// ---------------------------------------------------------------------------
// New helpers for the template-database model (Lane B / Issue #1).
// One long-lived container per connector hosts a frozen seed database and
// N branch databases cloned from it via `CREATE DATABASE ... TEMPLATE seed`.
// ---------------------------------------------------------------------------

export interface CreateConnectorContainerOptions {
  containerName: string;
  port: number;
  pgVersion: string;
}

/**
 * Create a long-lived per-connector Postgres container with no init.sql
 * mounted. The default `postgres` database is the bootstrap; the seed
 * and per-branch databases are created later via SQL.
 */
export async function createConnectorContainer(
  opts: CreateConnectorContainerOptions,
): Promise<string> {
  const { containerName, port, pgVersion } = opts;
  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "-p",
    `${port}:5432`,
    "-e",
    `POSTGRES_DB=${POSTGRES_BOOTSTRAP_DB}`,
    "-e",
    `POSTGRES_USER=${POSTGRES_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
    `postgres:${pgVersion}-alpine`,
  ];
  const { stdout } = await execFile("docker", args, { timeout: 30_000 });
  return stdout.trim();
}

/**
 * Wait for the bootstrap `postgres` database inside a connector container
 * to accept connections.
 */
export async function waitForConnectorReady(
  containerName: string,
  timeoutMs = 120_000,
): Promise<void> {
  const start = Date.now();
  const pollInterval = 500;
  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout } = await execFile(
        "docker",
        ["exec", containerName, "pg_isready", "-U", POSTGRES_USER, "-d", POSTGRES_BOOTSTRAP_DB],
        { timeout: 5_000 },
      );
      if (stdout.includes("accepting connections")) {
        try {
          await execFile(
            "docker",
            ["exec", containerName, "psql", "-U", POSTGRES_USER, "-d", POSTGRES_BOOTSTRAP_DB, "-c", "SELECT 1"],
            { timeout: 5_000 },
          );
          return;
        } catch {
          // not ready yet
        }
      }
    } catch {
      // not ready yet
    }
    await sleep(pollInterval);
  }
  throw new Error(
    `Postgres container '${containerName}' did not become ready within ${timeoutMs / 1000}s`,
  );
}

/** Run a single SQL statement against a specific database inside a container. */
export async function execSqlInDb(
  containerName: string,
  databaseName: string,
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
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { timeout: 60_000 },
  );
  return stdout;
}

/** Stream a SQL file from the host into psql for a given database. */
export async function loadInitSqlIntoDb(
  containerName: string,
  databaseName: string,
  initSqlPath: string,
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const sqlContent = await readFile(initSqlPath, "utf-8");
  await pipeSqlToDb(containerName, databaseName, sqlContent, /*onErrorStop*/ false);
}

async function pipeSqlToDb(
  containerName: string,
  databaseName: string,
  sqlContent: string,
  onErrorStop: boolean,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      POSTGRES_USER,
      "-d",
      databaseName,
    ];
    if (onErrorStop) {
      args.push("-v", "ON_ERROR_STOP=1");
    } else {
      args.push("-v", "ON_ERROR_STOP=0");
    }
    const child = spawnCb("docker", args);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`psql failed (exit ${code}): ${stderr}`));
      } else {
        resolve();
      }
    });
    child.on("error", reject);
    child.stdin.write(sqlContent);
    child.stdin.end();
  });
}

/** Dump a specific database inside a container to a SQL string. */
export async function dumpDatabase(
  containerName: string,
  databaseName: string,
): Promise<string> {
  const { stdout } = await execFile(
    "docker",
    [
      "exec",
      containerName,
      "pg_dump",
      "-U",
      POSTGRES_USER,
      "-d",
      databaseName,
      "--no-owner",
      "--no-privileges",
    ],
    { timeout: 60_000, maxBuffer: 100 * 1024 * 1024 },
  );
  return stdout;
}

/**
 * Restore a SQL dump into a branch database. Wipes the public schema first.
 * Targets the per-branch database (NOT the seed).
 */
export async function restoreDumpToDatabase(
  containerName: string,
  databaseName: string,
  sqlContent: string,
): Promise<void> {
  await execSqlInDb(
    containerName,
    databaseName,
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  );
  await pipeSqlToDb(containerName, databaseName, sqlContent, /*onErrorStop*/ false);
}

/**
 * List database names matching a SQL LIKE pattern (used to count branches
 * remaining for a connector before tearing down its container).
 */
export async function listDatabases(
  containerName: string,
  likePattern: string,
): Promise<string[]> {
  const { stdout } = await execFile(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-U",
      POSTGRES_USER,
      "-d",
      POSTGRES_BOOTSTRAP_DB,
      "-tA",
      "-c",
      `SELECT datname FROM pg_database WHERE datname LIKE '${likePattern.replace(/'/g, "''")}'`,
    ],
    { timeout: 10_000 },
  );
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
