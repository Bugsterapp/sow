import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  getSnapshotDir,
  getInitSqlPath,
  deleteConnectorSnapshot,
  readConnectorMetadata,
} from "../branching/storage.js";
import type { ConnectorMetadata } from "../branching/types.js";

export const SAAS_DB_URL = "postgresql://postgres:postgres@localhost:5555/saasdb";
export const BUGSTER_DB_URL = "postgresql://postgres:postgres@localhost:5556/bugsterdb";

/**
 * Read the generated init.sql snapshot for a connector and return its full text.
 */
export function readSnapshotSQL(connectorName: string): string {
  const sqlPath = getInitSqlPath(connectorName);
  if (!existsSync(sqlPath)) {
    throw new Error(`Snapshot SQL not found at ${sqlPath}`);
  }
  return readFileSync(sqlPath, "utf-8");
}

/**
 * Parse INSERT statements from a snapshot SQL file for a given table.
 * Returns the raw value tuples as strings for flexible assertion.
 */
export function parseSnapshotInserts(
  sql: string,
  tableName: string,
): string[][] {
  const pattern = new RegExp(
    `INSERT INTO "${tableName}"\\s*\\(([^)]+)\\)\\s*VALUES\\s*`,
    "g",
  );

  const allRows: string[][] = [];

  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const startIdx = match.index + match[0].length;
    const tuples = extractValueTuples(sql, startIdx);
    for (const tuple of tuples) {
      allRows.push(splitSQLValues(tuple));
    }
  }

  return allRows;
}

/**
 * Starting from a position right after VALUES, extract each (...) tuple,
 * respecting quoted strings that may contain parens/commas/semicolons.
 */
function extractValueTuples(sql: string, startIdx: number): string[] {
  const tuples: string[] = [];
  let i = startIdx;

  while (i < sql.length) {
    // Skip whitespace and commas between tuples
    while (i < sql.length && /[\s,]/.test(sql[i])) i++;

    if (i >= sql.length || sql[i] === ";") break;
    if (sql[i] !== "(") break;

    // Found opening paren -- extract until matching close
    i++; // skip '('
    let depth = 1;
    let inQuote = false;
    const start = i;

    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (inQuote) {
        if (ch === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (ch === "'") {
          inQuote = false;
        }
      } else {
        if (ch === "'") {
          inQuote = true;
        } else if (ch === "(") {
          depth++;
        } else if (ch === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      i++;
    }

    tuples.push(sql.slice(start, i));
    i++; // skip closing ')'
  }

  return tuples;
}

/**
 * Get column names from INSERT statements for a given table.
 */
export function parseSnapshotColumns(
  sql: string,
  tableName: string,
): string[] {
  const pattern = new RegExp(
    `INSERT INTO "${tableName}"\\s*\\(([^)]+)\\)\\s*VALUES`,
  );
  const match = pattern.exec(sql);
  if (!match) return [];
  return match[1].split(",").map((c) => c.trim().replace(/"/g, ""));
}

/**
 * Extract structured rows from snapshot SQL for a given table.
 * Returns an array of objects with column names as keys.
 */
export function parseSnapshotRows(
  sql: string,
  tableName: string,
): Record<string, string>[] {
  const columns = parseSnapshotColumns(sql, tableName);
  if (columns.length === 0) return [];

  const rawRows = parseSnapshotInserts(sql, tableName);
  return rawRows.map((vals) => {
    const row: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = vals[i]?.trim() ?? "NULL";
    }
    return row;
  });
}

/**
 * Count how many rows exist in the snapshot for a given table.
 */
export function countSnapshotRows(sql: string, tableName: string): number {
  return parseSnapshotInserts(sql, tableName).length;
}

/**
 * Check if a CREATE TABLE statement exists in the SQL for the given table name.
 */
export function hasTable(sql: string, tableName: string): boolean {
  return sql.includes(`CREATE TABLE IF NOT EXISTS "${tableName}"`);
}

/**
 * Split a SQL VALUES tuple into individual value strings,
 * respecting quoted strings and nested parentheses.
 */
function splitSQLValues(raw: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuote = false;
  let depth = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inQuote) {
      current += ch;
      if (ch === "'" && raw[i + 1] === "'") {
        current += "'";
        i++;
      } else if (ch === "'") {
        inQuote = false;
      }
      continue;
    }

    if (ch === "'") {
      inQuote = true;
      current += ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ")") {
      depth--;
      current += ch;
      continue;
    }

    if (ch === "," && depth === 0) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    values.push(current.trim());
  }

  return values;
}

/**
 * Strip SQL quoting from a value string.
 */
export function unquote(val: string): string {
  if (val === "NULL") return val;
  if (val.startsWith("'") && val.endsWith("'")) {
    return val.slice(1, -1).replace(/''/g, "'");
  }
  return val;
}

/**
 * Clean up a connector snapshot directory. Safe to call even if it doesn't exist.
 */
export function cleanupConnector(name: string): void {
  try {
    deleteConnectorSnapshot(name);
  } catch {
    // ignore
  }
}

/**
 * Load connector metadata or throw.
 */
export function loadMetadata(name: string): ConnectorMetadata {
  const meta = readConnectorMetadata(name);
  if (!meta) {
    throw new Error(`Metadata not found for connector "${name}"`);
  }
  return meta;
}
