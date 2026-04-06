import type { DatabaseAdapter, TableStats, TableInfo, ProgressCallback } from "../types.js";

export async function collectStats(
  adapter: DatabaseAdapter,
  tables: TableInfo[],
  onProgress?: ProgressCallback,
): Promise<TableStats[]> {
  const results: TableStats[] = [];
  const total = tables.length;

  for (let i = 0; i < tables.length; i++) {
    onProgress?.({
      type: "analyzing_stats",
      message: `Collecting stats... (${i + 1}/${total} tables)`,
    });
    const stats = await adapter.getTableStats(tables[i].name);
    results.push(stats);
  }

  return results;
}
