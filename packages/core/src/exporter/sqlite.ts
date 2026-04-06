import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type {
  SchemaInfo,
  SanitizedTable,
  ExportResult,
  TableInfo,
  ColumnInfo,
} from "../types.js";
import { PostgresTypeMapper } from "../adapters/type-mapper.js";

const typeMapper = new PostgresTypeMapper();

function sqliteColumnDef(col: ColumnInfo): string {
  const sqliteType = typeMapper.toSQLite(col.type);
  let def = `"${col.name}" ${sqliteType}`;
  if (!col.nullable) def += " NOT NULL";
  return def;
}

function createTableSQLite(table: TableInfo): string {
  const cols = table.columns.map(sqliteColumnDef).join(", ");
  let sql = `CREATE TABLE IF NOT EXISTS "${table.name}" (${cols}`;
  if (table.primaryKey.length > 0) {
    sql += `, PRIMARY KEY (${table.primaryKey.map((k) => `"${k}"`).join(", ")})`;
  }
  sql += ")";
  return sql;
}

function toSQLiteValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

export function exportSQLite(
  schema: SchemaInfo,
  tables: SanitizedTable[],
  dependencyOrder: string[],
  outputPath: string,
): ExportResult {
  mkdirSync(outputPath, { recursive: true });

  const dbPath = join(outputPath, "sow.sqlite");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const tableInfoMap = new Map(schema.tables.map((t) => [t.name, t]));
  const dataMap = new Map(tables.map((t) => [t.table, t]));

  const transaction = db.transaction(() => {
    for (const tableName of dependencyOrder) {
      const tableInfo = tableInfoMap.get(tableName);
      if (!tableInfo) continue;

      db.exec(createTableSQLite(tableInfo));

      const data = dataMap.get(tableName);
      if (!data || data.rows.length === 0) continue;

      const columns = tableInfo.columns.filter((c) => !c.isGenerated);
      const colNames = columns.map((c) => `"${c.name}"`).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      const insertStmt = db.prepare(
        `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`,
      );

      for (const row of data.rows) {
        const values = columns.map((col) => toSQLiteValue(row[col.name]));
        insertStmt.run(...values);
      }
    }
  });

  transaction();
  db.close();

  const { statSync } = require("node:fs") as typeof import("node:fs");
  const stat = statSync(dbPath);

  let totalRows = 0;
  for (const t of tables) totalRows += t.rows.length;

  return {
    format: "sqlite",
    outputPath,
    files: [dbPath],
    totalSize: stat.size,
    tableCount: tables.length,
    rowCount: totalRows,
  };
}
