import { PostgresAdapter } from "../adapters/postgres.js";
import { readConnectorMetadata } from "./storage.js";
import type { Branch, DiffResult, TableDiff, SchemaChange } from "./types.js";

export async function diffBranch(branch: Branch): Promise<DiffResult> {
  const metadata = readConnectorMetadata(branch.connector);
  if (!metadata) {
    throw new Error(`Connector '${branch.connector}' metadata not found`);
  }

  const adapter = new PostgresAdapter();
  try {
    await adapter.connect(branch.connectionString);

    const currentSchema = await adapter.getSchema();

    const originalTables = new Map(
      metadata.analysis.schema.tables.map((t) => [t.name, t]),
    );

    const originalRowCounts = new Map(
      metadata.analysis.stats.tables.map((t) => [t.table, t.rowCount]),
    );

    const currentTables = new Map(
      currentSchema.tables.map((t) => [t.name, t]),
    );

    const tableDiffs: TableDiff[] = [];
    const schemaChanges: SchemaChange[] = [];

    // Check tables in original that may have changed
    for (const [tableName, origTable] of originalTables) {
      const currTable = currentTables.get(tableName);
      if (!currTable) {
        schemaChanges.push({
          type: "table_removed",
          table: tableName,
          detail: `Table '${tableName}' was dropped`,
        });
        continue;
      }

      const origCount = originalRowCounts.get(tableName) ?? 0;
      const currCount = await adapter.getRowCount(tableName);

      const origCols = new Map(origTable.columns.map((c) => [c.name, c]));
      const currCols = new Map(currTable.columns.map((c) => [c.name, c]));

      for (const [colName, col] of currCols) {
        if (!origCols.has(colName)) {
          schemaChanges.push({
            type: "column_added",
            table: tableName,
            column: colName,
            detail: `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${col.type}`,
          });
        }
      }

      for (const [colName] of origCols) {
        if (!currCols.has(colName)) {
          schemaChanges.push({
            type: "column_removed",
            table: tableName,
            column: colName,
            detail: `Column '${colName}' was dropped from '${tableName}'`,
          });
        }
      }

      for (const [colName, currCol] of currCols) {
        const origCol = origCols.get(colName);
        if (origCol && origCol.type !== currCol.type) {
          schemaChanges.push({
            type: "column_modified",
            table: tableName,
            column: colName,
            detail: `Column '${colName}' type changed from ${origCol.type} to ${currCol.type}`,
          });
        }
      }

      const added = Math.max(0, currCount - origCount);
      const deleted = Math.max(0, origCount - currCount);

      if (added > 0 || deleted > 0 || schemaChanges.some((s) => s.table === tableName)) {
        tableDiffs.push({
          name: tableName,
          rowsAdded: added,
          rowsDeleted: deleted,
          rowsModified: 0,
          originalCount: origCount,
          currentCount: currCount,
        });
      }
    }

    // Check for new tables
    for (const [tableName, currTable] of currentTables) {
      if (!originalTables.has(tableName)) {
        const count = await adapter.getRowCount(tableName);
        schemaChanges.push({
          type: "table_added",
          table: tableName,
          detail: `Table '${tableName}' was created`,
        });
        tableDiffs.push({
          name: tableName,
          rowsAdded: count,
          rowsDeleted: 0,
          rowsModified: 0,
          originalCount: 0,
          currentCount: count,
        });
      }
    }

    const hasChanges = tableDiffs.length > 0 || schemaChanges.length > 0;

    return { tables: tableDiffs, schemaChanges, hasChanges };
  } finally {
    await adapter.disconnect();
  }
}
