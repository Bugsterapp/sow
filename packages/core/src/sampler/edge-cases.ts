import type { ColumnInfo, EdgeCaseInfo, EdgeCaseType } from "../types.js";

const SPECIAL_CHAR_PATTERN = /[^\x00-\x7F]/;
const EMOJI_PATTERN =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

/**
 * Scan rows for edge cases and return the interesting ones.
 */
export function findEdgeCases(
  tableName: string,
  columns: ColumnInfo[],
  rows: Record<string, unknown>[],
): EdgeCaseInfo[] {
  const edgeCases: EdgeCaseInfo[] = [];

  for (const col of columns) {
    const values = rows.map((r, i) => ({ value: r[col.name], index: i }));

    // NULLs
    if (col.nullable) {
      const nullRow = values.find((v) => v.value == null);
      if (nullRow) {
        edgeCases.push({
          table: tableName,
          column: col.name,
          type: "null",
          value: null,
          rowIndex: nullRow.index,
        });
      }
    }

    // Empty strings
    const emptyRow = values.find((v) => v.value === "");
    if (emptyRow) {
      edgeCases.push({
        table: tableName,
        column: col.name,
        type: "empty_string",
        value: "",
        rowIndex: emptyRow.index,
      });
    }

    // Numeric min/max
    const numericValues = values.filter(
      (v) => v.value != null && typeof v.value === "number",
    );
    if (numericValues.length > 0) {
      const sorted = [...numericValues].sort(
        (a, b) => (a.value as number) - (b.value as number),
      );
      edgeCases.push({
        table: tableName,
        column: col.name,
        type: "min_numeric",
        value: sorted[0].value,
        rowIndex: sorted[0].index,
      });
      edgeCases.push({
        table: tableName,
        column: col.name,
        type: "max_numeric",
        value: sorted[sorted.length - 1].value,
        rowIndex: sorted[sorted.length - 1].index,
      });
    }

    // String length extremes
    const stringValues = values.filter(
      (v) => v.value != null && typeof v.value === "string" && v.value.length > 0,
    );
    if (stringValues.length > 1) {
      const sorted = [...stringValues].sort(
        (a, b) =>
          (a.value as string).length - (b.value as string).length,
      );
      edgeCases.push({
        table: tableName,
        column: col.name,
        type: "shortest_string",
        value: sorted[0].value,
        rowIndex: sorted[0].index,
      });
      edgeCases.push({
        table: tableName,
        column: col.name,
        type: "longest_string",
        value: sorted[sorted.length - 1].value,
        rowIndex: sorted[sorted.length - 1].index,
      });
    }

    // Special characters / unicode / emoji
    for (const v of stringValues) {
      const str = v.value as string;
      if (EMOJI_PATTERN.test(str)) {
        edgeCases.push({
          table: tableName,
          column: col.name,
          type: "emoji",
          value: str,
          rowIndex: v.index,
        });
        break;
      } else if (SPECIAL_CHAR_PATTERN.test(str)) {
        edgeCases.push({
          table: tableName,
          column: col.name,
          type: "unicode",
          value: str,
          rowIndex: v.index,
        });
        break;
      }
    }
  }

  return edgeCases;
}

/**
 * Ensure that edge-case rows are included in the sample.
 * Returns the merged set of rows (sample + missing edge case rows).
 */
export function injectEdgeCases(
  currentSample: Record<string, unknown>[],
  allRows: Record<string, unknown>[],
  edgeCases: EdgeCaseInfo[],
  primaryKey: string[],
): Record<string, unknown>[] {
  const result = [...currentSample];
  const existingKeys = new Set(
    result.map((r) => primaryKey.map((k) => String(r[k])).join("|")),
  );

  for (const ec of edgeCases) {
    const row = allRows[ec.rowIndex];
    if (!row) continue;

    const key = primaryKey.map((k) => String(row[k])).join("|");
    if (!existingKeys.has(key)) {
      result.push(row);
      existingKeys.add(key);
    }
  }

  return result;
}
