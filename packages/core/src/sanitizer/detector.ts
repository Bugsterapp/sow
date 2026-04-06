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
