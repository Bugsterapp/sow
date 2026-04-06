import type {
  PIIColumnInfo,
  PIIType,
  SanitizationConfig,
  SanitizationResult,
  SanitizedTable,
  SampledTable,
  TableInfo,
  ProgressCallback,
  UnhandledColumn,
  EnumType,
} from "../types.js";
import { detectTablePII, classifyPgType } from "./detector.js";
import { transformRows } from "./transformer.js";

export interface SanitizerOptions {
  config: SanitizationConfig;
  tables: TableInfo[];
  /** Custom enum types captured by the analyzer — treated as safe passthrough. */
  enumTypes?: EnumType[];
  onProgress?: ProgressCallback;
}

/**
 * Thrown when fail-closed sanitization detects columns the sanitizer
 * cannot verify. Includes the list of offending columns so callers can
 * render a clear error or re-run with --allow-unsafe.
 */
export class SanitizationAbort extends Error {
  readonly unhandledColumns: UnhandledColumn[];
  constructor(unhandledColumns: UnhandledColumn[]) {
    super(formatAbortMessage(unhandledColumns));
    this.name = "SanitizationAbort";
    this.unhandledColumns = unhandledColumns;
  }
}

function formatAbortMessage(cols: UnhandledColumn[]): string {
  const lines: string[] = [];
  lines.push(
    `Sanitization aborted — ${cols.length} column${cols.length === 1 ? "" : "s"} ha${cols.length === 1 ? "s" : "ve"} types sow cannot verify:`,
  );
  for (const c of cols) {
    lines.push(`  - ${c.table}.${c.column} (${c.pgType})    — ${c.reason}`);
  }
  lines.push("");
  lines.push("These columns would be copied to the sandbox AS-IS, potentially leaking");
  lines.push("PII that exists in them. Pass --allow-unsafe to sow connect to skip");
  lines.push("sanitization of these columns (they will be NULLed out in the branch).");
  lines.push("");
  lines.push("To add explicit handling, edit .sow.yml:");
  lines.push("  sanitize:");
  lines.push("    rules:");
  if (cols[0]) {
    lines.push(`      - table: ${cols[0].table}`);
    lines.push(`        column: ${cols[0].column}`);
    lines.push(`        type: ${cols[0].pgType}`);
  }
  return lines.join("\n");
}

export function createSanitizer(options: SanitizerOptions) {
  const { config, tables, enumTypes = [], onProgress } = options;
  const knownEnums = new Set(enumTypes.map((e) => e.name));

  function sanitize(
    sampledTables: SampledTable[],
  ): SanitizationResult {
    if (!config.enabled) {
      return {
        tables: sampledTables.map((st) => ({
          table: st.table,
          rows: st.rows,
          sanitizedColumns: [],
        })),
        rulesApplied: [],
        columnsSkipped: config.skipColumns,
        unhandledColumns: [],
        warnings: [],
      };
    }

    const skipSet = new Set(config.skipColumns);
    const ruleKeys = new Set(
      config.rules.map((r) => `${r.table}.${r.column}`),
    );

    // -------------------------------------------------------------
    // Fail-closed gate — walk every column of every sampled table.
    // -------------------------------------------------------------
    const unhandledColumns: UnhandledColumn[] = [];
    for (const st of sampledTables) {
      const tableInfo = tables.find((t) => t.name === st.table);
      if (!tableInfo) continue;
      for (const col of tableInfo.columns) {
        const key = `${st.table}.${col.name}`;
        if (skipSet.has(key)) continue;
        if (ruleKeys.has(key)) continue; // user explicitly handled
        const classification = classifyPgType(col.type, knownEnums);
        if (classification === "unknown") {
          unhandledColumns.push({
            table: st.table,
            column: col.name,
            pgType: col.type,
            reason: `no handler configured for ${col.type}`,
          });
        }
      }
    }

    if (unhandledColumns.length > 0 && !config.allowUnsafe) {
      throw new SanitizationAbort(unhandledColumns);
    }

    // -------------------------------------------------------------
    // Normal PII detection + transformation.
    // -------------------------------------------------------------
    const allPII: PIIColumnInfo[] = [];
    for (const st of sampledTables) {
      const tableInfo = tables.find((t) => t.name === st.table);
      if (!tableInfo) continue;

      const detected = detectTablePII(tableInfo, st.rows);
      allPII.push(...detected);
    }

    const columnTypeMap = new Map<string, PIIType>();
    for (const rule of config.rules) {
      const key = `${rule.table}.${rule.column}`;
      if (!skipSet.has(key)) {
        columnTypeMap.set(key, rule.type);
      }
    }
    for (const pii of allPII) {
      const key = `${pii.table}.${pii.column}`;
      if (!skipSet.has(key) && !columnTypeMap.has(key)) {
        columnTypeMap.set(key, pii.type);
      }
    }

    onProgress?.({
      type: "sanitizing",
      message: `Sanitizing ${columnTypeMap.size} PII columns...`,
      detail: { columnCount: columnTypeMap.size },
    });

    // Build per-table set of columns to NULL out (unhandled + allowUnsafe).
    const nullOutByTable = new Map<string, Set<string>>();
    for (const u of unhandledColumns) {
      let s = nullOutByTable.get(u.table);
      if (!s) {
        s = new Set();
        nullOutByTable.set(u.table, s);
      }
      s.add(u.column);
    }

    const sanitizedTables: SanitizedTable[] = [];

    for (const st of sampledTables) {
      const tableColumns = new Map<string, PIIType>();
      for (const [key, type] of columnTypeMap) {
        const [table, column] = key.split(".");
        if (table === st.table) {
          tableColumns.set(column, type);
        }
      }

      const nullCols = nullOutByTable.get(st.table);
      let rows = st.rows;

      if (tableColumns.size > 0) {
        rows = transformRows(rows, tableColumns);
      }

      if (nullCols && nullCols.size > 0) {
        rows = rows.map((row) => {
          const newRow = { ...row };
          for (const c of nullCols) {
            if (c in newRow) newRow[c] = null;
          }
          return newRow;
        });
      }

      const sanitizedColumns = [
        ...Array.from(tableColumns.keys()),
        ...(nullCols ? Array.from(nullCols) : []),
      ];

      sanitizedTables.push({
        table: st.table,
        rows,
        sanitizedColumns,
      });
    }

    const warnings: string[] = [];
    if (unhandledColumns.length > 0 && config.allowUnsafe) {
      warnings.push(
        `${unhandledColumns.length} column(s) NULLed out due to unknown Postgres types (allowUnsafe=true): ${unhandledColumns
          .map((c) => `${c.table}.${c.column} (${c.pgType})`)
          .join(", ")}`,
      );
    }

    return {
      tables: sanitizedTables,
      rulesApplied: Array.from(columnTypeMap.entries()).map(
        ([key, type]) => {
          const [table, column] = key.split(".");
          return { table, column, type };
        },
      ),
      columnsSkipped: config.skipColumns,
      unhandledColumns,
      warnings,
    };
  }

  return { sanitize };
}
