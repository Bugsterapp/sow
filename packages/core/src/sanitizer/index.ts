import type {
  PIIColumnInfo,
  PIIType,
  SanitizationConfig,
  SanitizationResult,
  SanitizedTable,
  SampledTable,
  TableInfo,
  ProgressCallback,
} from "../types.js";
import { detectTablePII } from "./detector.js";
import { transformRows } from "./transformer.js";

export interface SanitizerOptions {
  config: SanitizationConfig;
  tables: TableInfo[];
  onProgress?: ProgressCallback;
}

export function createSanitizer(options: SanitizerOptions) {
  const { config, tables, onProgress } = options;

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
      };
    }

    const skipSet = new Set(config.skipColumns);

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

    const sanitizedTables: SanitizedTable[] = [];

    for (const st of sampledTables) {
      const tableColumns = new Map<string, PIIType>();
      for (const [key, type] of columnTypeMap) {
        const [table, column] = key.split(".");
        if (table === st.table) {
          tableColumns.set(column, type);
        }
      }

      if (tableColumns.size === 0) {
        sanitizedTables.push({
          table: st.table,
          rows: st.rows,
          sanitizedColumns: [],
        });
      } else {
        const rows = transformRows(st.rows, tableColumns);
        sanitizedTables.push({
          table: st.table,
          rows,
          sanitizedColumns: Array.from(tableColumns.keys()),
        });
      }
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
    };
  }

  return { sanitize };
}
