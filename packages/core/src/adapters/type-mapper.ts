import type { TypeMapper } from "../types.js";

const PG_TO_SQLITE: Record<string, string> = {
  int2: "INTEGER",
  int4: "INTEGER",
  int8: "INTEGER",
  float4: "REAL",
  float8: "REAL",
  numeric: "REAL",
  bool: "INTEGER",
  text: "TEXT",
  varchar: "TEXT",
  bpchar: "TEXT",
  uuid: "TEXT",
  json: "TEXT",
  jsonb: "TEXT",
  date: "TEXT",
  timestamp: "TEXT",
  timestamptz: "TEXT",
  time: "TEXT",
  timetz: "TEXT",
  interval: "TEXT",
  bytea: "BLOB",
  inet: "TEXT",
  cidr: "TEXT",
  macaddr: "TEXT",
  xml: "TEXT",
  money: "TEXT",
  point: "TEXT",
  line: "TEXT",
  circle: "TEXT",
  polygon: "TEXT",
  box: "TEXT",
  path: "TEXT",
};

const QUOTED_TYPES = new Set([
  "text",
  "varchar",
  "bpchar",
  "uuid",
  "json",
  "jsonb",
  "date",
  "timestamp",
  "timestamptz",
  "time",
  "timetz",
  "interval",
  "inet",
  "cidr",
  "macaddr",
  "xml",
  "money",
  "point",
  "line",
  "circle",
  "polygon",
  "box",
  "path",
  "bytea",
]);

export class PostgresTypeMapper implements TypeMapper {
  toSQLite(sourceType: string): string {
    const base = sourceType.replace(/\[\]$/, "").toLowerCase();
    return PG_TO_SQLITE[base] || "TEXT";
  }

  toJSON(_sourceType: string): string {
    return "string";
  }

  toInsertLiteral(value: unknown, sourceType: string): string {
    if (value === null || value === undefined) return "NULL";

    if (typeof value === "boolean") return value ? "true" : "false";

    if (typeof value === "number") return String(value);

    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }

    if (typeof value === "object") {
      return `'${escapeString(JSON.stringify(value))}'`;
    }

    const str = String(value);
    if (this.needsQuoting(sourceType)) {
      return `'${escapeString(str)}'`;
    }

    return str;
  }

  needsQuoting(sourceType: string): boolean {
    const base = sourceType.replace(/\[\]$/, "").toLowerCase();
    return QUOTED_TYPES.has(base) || sourceType.endsWith("[]");
  }
}

function escapeString(str: string): string {
  return str.replace(/'/g, "''");
}
