import type {
  DatabaseAdapter,
  AnalysisResult,
  ProgressCallback,
} from "../types.js";
import { extractSchema } from "./schema.js";
import { collectStats } from "./stats.js";
import { topologicalSort } from "./relationships.js";
import { detectPatterns } from "./patterns.js";

export interface AnalyzeOptions {
  tables?: string[];
  onProgress?: ProgressCallback;
}

export async function analyze(
  adapter: DatabaseAdapter,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const { tables: filterTables, onProgress } = options;

  onProgress?.({
    type: "analyzing_schema",
    message: "Extracting database schema...",
  });

  const schema = await extractSchema(adapter);

  let filteredTables = schema.tables;
  if (filterTables && filterTables.length > 0) {
    const set = new Set(filterTables);
    filteredTables = schema.tables.filter((t) => set.has(t.name));
  }

  onProgress?.({
    type: "analyzing_schema",
    message: `Found ${filteredTables.length} tables`,
    detail: { tableCount: filteredTables.length },
  });

  onProgress?.({
    type: "analyzing_stats",
    message: "Collecting table statistics...",
  });

  const tableStats = await collectStats(adapter, filteredTables, onProgress);

  const totalRows = tableStats.reduce((sum, t) => sum + t.rowCount, 0);
  const totalSizeBytes = tableStats.reduce(
    (sum, t) => sum + (t.sizeBytes || 0),
    0,
  );

  onProgress?.({
    type: "detecting_pii",
    message: "Detecting data patterns and PII...",
  });

  const { piiColumns, dataTypes } = await detectPatterns(
    adapter,
    filteredTables,
  );

  const dependencyOrder = topologicalSort(filteredTables, schema.relationships);

  return {
    schema,
    stats: {
      tables: tableStats,
      totalSizeBytes,
      totalRows,
    },
    patterns: {
      piiColumns,
      edgeCases: [], // populated by sampler
      dataTypes,
    },
    dependencyOrder,
  };
}
