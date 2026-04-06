import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SanitizedTable, ExportResult } from "../types.js";

export function exportJSON(
  tables: SanitizedTable[],
  outputPath: string,
): ExportResult {
  mkdirSync(outputPath, { recursive: true });

  const files: string[] = [];
  let totalSize = 0;
  let totalRows = 0;

  for (const table of tables) {
    const filePath = join(outputPath, `${table.table}.json`);
    const content = JSON.stringify(table.rows, null, 2);

    writeFileSync(filePath, content, "utf-8");
    files.push(filePath);
    totalSize += Buffer.byteLength(content, "utf-8");
    totalRows += table.rows.length;
  }

  // Write an index file
  const indexPath = join(outputPath, "index.json");
  const index = {
    generatedAt: new Date().toISOString(),
    tables: tables.map((t) => ({
      name: t.table,
      file: `${t.table}.json`,
      rowCount: t.rows.length,
      sanitizedColumns: t.sanitizedColumns,
    })),
  };
  const indexContent = JSON.stringify(index, null, 2);
  writeFileSync(indexPath, indexContent, "utf-8");
  files.push(indexPath);
  totalSize += Buffer.byteLength(indexContent, "utf-8");

  return {
    format: "json",
    outputPath,
    files,
    totalSize,
    tableCount: tables.length,
    rowCount: totalRows,
  };
}
