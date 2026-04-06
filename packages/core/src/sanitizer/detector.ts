import type {
  PIIColumnInfo,
  PIIDetectionResult,
  PIIConfidence,
  TableInfo,
} from "../types.js";
import { BUILTIN_PII_RULES } from "./rules.js";

function matchColumnName(columnName: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(columnName));
}

function matchValues(
  values: unknown[],
  patterns: RegExp[],
): { matched: number; total: number } {
  if (patterns.length === 0) return { matched: 0, total: 0 };

  let matched = 0;
  let total = 0;

  for (const val of values) {
    if (val == null) continue;
    const str = String(val);
    if (!str) continue;
    total++;
    if (patterns.some((p) => p.test(str))) matched++;
  }

  return { matched, total };
}

/**
 * Regex-only PII detection. Fully local, zero network calls.
 * Checks column names and sample value patterns.
 */
const NUMERIC_TYPES = /^(int|float|double|decimal|numeric|real|serial|bigint|smallint|money|int2|int4|int8|float4|float8)/i;

/**
 * Postgres types that are inherently safe: no PII, no transformation needed,
 * can be copied to the sandbox verbatim. Used by the fail-closed gate.
 */
const SAFE_PASSTHROUGH_TYPES = new Set([
  // numeric
  "int", "int2", "int4", "int8", "smallint", "integer", "bigint",
  "serial", "bigserial", "smallserial",
  "real", "float4", "float8", "double precision", "numeric", "decimal",
  "money",
  // boolean
  "bool", "boolean",
  // date/time
  "date", "time", "timetz", "timestamp", "timestamptz",
  "interval",
  // uuid (sanitized separately if name matches)
  "uuid",
  // binary / large
  "bytea",
  // ranges
  "int4range", "int8range", "numrange", "tsrange", "tstzrange", "daterange",
  // geometric / network / other
  "point", "line", "lseg", "box", "path", "polygon", "circle",
  // bit
  "bit", "varbit",
  // oid family
  "oid", "regproc", "regclass", "regtype",
]);

/**
 * Postgres types the sanitizer actively handles via the detector
 * (either through value-pattern matching on text, or a dedicated transformer).
 */
const HANDLED_TEXT_TYPES = new Set([
  "text", "varchar", "char", "character", "character varying", "citext", "name",
]);

const HANDLED_SPECIAL_TYPES = new Set([
  "jsonb", "json",
  "inet", "cidr",
  "macaddr", "macaddr8",
  "xml",
]);

/** Strip the `[]` suffix (or leading `_`) from a Postgres array type. */
export function stripArraySuffix(pgType: string): { baseType: string; isArray: boolean } {
  const t = pgType.trim();
  if (t.endsWith("[]")) return { baseType: t.slice(0, -2), isArray: true };
  if (t.startsWith("_")) return { baseType: t.slice(1), isArray: true };
  return { baseType: t, isArray: false };
}

/**
 * Classify a Postgres type for the fail-closed sanitization gate.
 *
 * - "safe":     known non-PII, passthrough OK
 * - "handled":  the sanitizer has a detector or transformer for this type
 * - "unknown":  not in any known set — must be reported to the gate
 */
export function classifyPgType(
  pgType: string,
  knownEnumTypes: Set<string> = new Set(),
): "safe" | "handled" | "unknown" {
  const normalized = pgType.trim().toLowerCase();
  const { baseType } = stripArraySuffix(normalized);

  if (SAFE_PASSTHROUGH_TYPES.has(baseType)) return "safe";
  if (HANDLED_TEXT_TYPES.has(baseType)) return "handled";
  if (HANDLED_SPECIAL_TYPES.has(baseType)) return "handled";
  if (NUMERIC_TYPES.test(baseType)) return "safe";
  if (knownEnumTypes.has(baseType)) return "safe";
  // Common qualified enum names like "public.user_role"
  if (knownEnumTypes.has(baseType.replace(/^public\./, ""))) return "safe";
  return "unknown";
}

/** Map a Postgres data_type string to a PIIType when that mapping is intrinsic
 * to the type (ignoring column name). Used both by the gate and the detector.
 */
export function pgTypeToPIIType(pgType: string): import("../types.js").PIIType | null {
  const { baseType } = stripArraySuffix(pgType.trim().toLowerCase());
  switch (baseType) {
    case "jsonb":
    case "json":
      return "jsonb";
    case "inet":
    case "cidr":
      return "ip_address";
    case "macaddr":
    case "macaddr8":
      return "mac_address";
    case "xml":
      return "xml_text";
    case "bytea":
      return "binary_blob";
    default:
      return null;
  }
}

export function detectColumnPII(
  columnName: string,
  columnType: string,
  sampleValues: unknown[],
): PIIDetectionResult {
  for (const rule of BUILTIN_PII_RULES) {
    if (matchColumnName(columnName, rule.columnNamePatterns)) {
      return {
        isPII: true,
        type: rule.type,
        confidence: "high",
        matchedBy: "column_name",
        sampleMatches: 0,
        totalSampled: sampleValues.length,
      };
    }
  }

  // Type-intrinsic PII (jsonb, inet, macaddr, xml, etc.) — no column name needed.
  const intrinsic = pgTypeToPIIType(columnType);
  if (intrinsic) {
    return {
      isPII: true,
      type: intrinsic,
      confidence: "high",
      matchedBy: "column_name",
      sampleMatches: 0,
      totalSampled: sampleValues.length,
    };
  }

  if (NUMERIC_TYPES.test(columnType)) {
    return {
      isPII: false,
      type: null,
      confidence: "high",
      matchedBy: null,
      sampleMatches: 0,
      totalSampled: sampleValues.length,
    };
  }

  for (const rule of BUILTIN_PII_RULES) {
    if (rule.valuePatterns.length === 0) continue;

    const { matched, total } = matchValues(sampleValues, rule.valuePatterns);
    const ratio = total > 0 ? matched / total : 0;

    if (ratio > 0.5) {
      const confidence: PIIConfidence = ratio > 0.8 ? "medium" : "low";
      return {
        isPII: true,
        type: rule.type,
        confidence,
        matchedBy: "value_pattern",
        sampleMatches: matched,
        totalSampled: total,
      };
    }
  }

  return {
    isPII: false,
    type: null,
    confidence: "high",
    matchedBy: null,
    sampleMatches: 0,
    totalSampled: sampleValues.length,
  };
}

export function detectTablePII(
  table: TableInfo,
  sampleRows: Record<string, unknown>[],
): PIIColumnInfo[] {
  const results: PIIColumnInfo[] = [];

  for (const col of table.columns) {
    const values = sampleRows.map((r) => r[col.name]);
    const detection = detectColumnPII(col.name, col.type, values);

    if (detection.isPII && detection.type) {
      results.push({
        table: table.name,
        column: col.name,
        type: detection.type,
        confidence: detection.confidence,
        matchedBy: detection.matchedBy!,
      });
    }
  }

  return results;
}
