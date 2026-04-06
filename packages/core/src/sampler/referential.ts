import type { DatabaseAdapter, Relationship } from "../types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns already handled by formal FKs or that shouldn't be followed
const SKIP_IMPLICIT_COLUMNS = new Set(["id", "user_id", "owner_id", "created_by"]);

/**
 * Infer which table a column like `session_id` or `run_id` references.
 * Tries: session_id -> sessions, session_id -> session, analysis_run_id -> analysis_runs
 */
function inferTargetTable(
  colName: string,
  allTableNames: Set<string>,
): string | null {
  const base = colName.replace(/_id$/, "");
  if (!base) return null;

  // Try plural first (session_id -> sessions)
  const plural = base + "s";
  if (allTableNames.has(plural)) return plural;

  // Try singular (session_id -> session)
  if (allTableNames.has(base)) return base;

  // Try with common prefixes stripped (e.g., original_project_id -> projects)
  const parts = base.split("_");
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    const lastPlural = lastPart + "s";
    if (allTableNames.has(lastPlural)) return lastPlural;
    if (allTableNames.has(lastPart)) return lastPart;
  }

  return null;
}

/**
 * Ensure referential integrity in the sampled data.
 * Handles both formal FK constraints and implicit UUID references.
 */
export async function ensureReferentialIntegrity(
  adapter: DatabaseAdapter,
  sampledTables: Map<string, Record<string, unknown>[]>,
  relationships: Relationship[],
): Promise<Map<string, Record<string, unknown>[]>> {
  const result = new Map(
    Array.from(sampledTables.entries()).map(([k, v]) => [k, [...v]]),
  );

  // Multiple passes to handle transitive dependencies
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;

    for (const rel of relationships) {
      if (rel.sourceTable === rel.targetTable) continue;

      const childRows = result.get(rel.sourceTable) || [];
      const parentRows = result.get(rel.targetTable) || [];

      if (childRows.length === 0 || parentRows.length === 0) continue;

      // Build parent key index
      const parentKeys = new Set(
        parentRows.map((r) =>
          rel.targetColumns.map((c) => String(r[c] ?? "")).join("|"),
        ),
      );

      // Find child rows missing parents
      const missingParentKeys = new Set<string>();
      for (const child of childRows) {
        const fkValue = rel.sourceColumns
          .map((c) => String(child[c] ?? ""))
          .join("|");

        if (fkValue && !fkValue.includes("null") && !parentKeys.has(fkValue)) {
          missingParentKeys.add(fkValue);
        }
      }

      // Fetch missing parent rows
      if (missingParentKeys.size > 0) {
        for (const keyStr of missingParentKeys) {
          const keyParts = keyStr.split("|");
          if (keyParts.length !== rel.targetColumns.length) continue;

          try {
            const conditions = rel.targetColumns
              .map((col, i) => `"${col}" = '${keyParts[i]}'`)
              .join(" AND ");

            const rows = await adapter.query(
              `SELECT * FROM "${rel.targetTable}" WHERE ${conditions} LIMIT 1`,
            );
            if (rows.length > 0) {
              const existing = result.get(rel.targetTable) || [];
              existing.push(rows[0] as Record<string, unknown>);
              result.set(rel.targetTable, existing);
              changed = true;
            }
          } catch {
            // Best effort
          }
        }
      }

      // Ensure at least 1 child per parent (best effort, don't over-fetch)
      if (pass === 0) {
        const childFKValues = new Set(
          childRows.map((r) =>
            rel.sourceColumns.map((c) => String(r[c] ?? "")).join("|"),
          ),
        );

        for (const parent of parentRows) {
          const parentKey = rel.targetColumns
            .map((c) => String(parent[c] ?? ""))
            .join("|");

          if (!childFKValues.has(parentKey)) {
            try {
              const conditions = rel.sourceColumns
                .map(
                  (col, i) =>
                    `"${col}" = '${String(parent[rel.targetColumns[i]] ?? "")}'`,
                )
                .join(" AND ");

              const rows = await adapter.query(
                `SELECT * FROM "${rel.sourceTable}" WHERE ${conditions} LIMIT 1`,
              );
              if (rows.length > 0) {
                const existing = result.get(rel.sourceTable) || [];
                existing.push(rows[0] as Record<string, unknown>);
                result.set(rel.sourceTable, existing);
                changed = true;
              }
            } catch {
              // Best effort
            }
          }
        }
      }
    }

    if (!changed) break;
  }

  // Second pass: follow implicit FK references (UUID columns ending in _id)
  await resolveImplicitReferences(adapter, result);

  return result;
}

/**
 * Detect implicit FK references by finding UUID columns named *_id
 * and fetching any missing referenced rows from inferred target tables.
 */
async function resolveImplicitReferences(
  adapter: DatabaseAdapter,
  result: Map<string, Record<string, unknown>[]>,
): Promise<void> {
  const allTableNames = new Set(result.keys());

  // Collect all formal FK column pairs to avoid duplicating work
  const handledPairs = new Set<string>();

  for (const [tableName, rows] of result.entries()) {
    if (rows.length === 0) continue;

    const sampleRow = rows[0];
    for (const colName of Object.keys(sampleRow)) {
      if (!colName.endsWith("_id") || SKIP_IMPLICIT_COLUMNS.has(colName)) continue;

      const targetTable = inferTargetTable(colName, allTableNames);
      if (!targetTable) continue;

      const pairKey = `${tableName}.${colName}->${targetTable}`;
      if (handledPairs.has(pairKey)) continue;
      handledPairs.add(pairKey);

      const targetRows = result.get(targetTable) || [];
      const targetIds = new Set(
        targetRows.map((r) => String(r.id ?? "")),
      );

      // Find referenced IDs that are missing from the target table
      const missingIds = new Set<string>();
      for (const row of rows) {
        const val = String(row[colName] ?? "");
        if (val && UUID_RE.test(val) && !targetIds.has(val)) {
          missingIds.add(val);
        }
      }

      if (missingIds.size === 0) continue;

      // Batch fetch missing rows (up to 100 at a time)
      const idBatches: string[][] = [];
      const allMissing = Array.from(missingIds);
      for (let i = 0; i < allMissing.length; i += 100) {
        idBatches.push(allMissing.slice(i, i + 100));
      }

      for (const batch of idBatches) {
        try {
          const idList = batch.map((id) => `'${id}'`).join(",");
          const fetched = await adapter.query(
            `SELECT * FROM "${targetTable}" WHERE id IN (${idList})`,
          );
          if (fetched.length > 0) {
            const existing = result.get(targetTable) || [];
            existing.push(...(fetched as Record<string, unknown>[]));
            result.set(targetTable, existing);
          }
        } catch {
          // Best effort — table might not have an id column or query might fail
        }
      }
    }
  }
}
