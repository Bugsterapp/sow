import type {
  DatabaseAdapter,
  IntegrityWarning,
  Relationship,
} from "../types.js";
import { quoteIdent } from "../sql/identifiers.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function truncateReason(err: unknown, limit = 140): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > limit ? msg.slice(0, limit - 1) + "…" : msg;
}

/**
 * Result of a referential integrity pass.
 *
 * Includes both the fixed-up sampled tables and a list of any problems
 * encountered. Problems are intentionally non-fatal: the sandbox still
 * loads, but the connector metadata records what we couldn't resolve
 * so `sow doctor` can surface it to the user.
 */
export interface ReferentialIntegrityResult {
  tables: Map<string, Record<string, unknown>[]>;
  warnings: IntegrityWarning[];
}

/**
 * Ensure referential integrity in the sampled data.
 * Handles both formal FK constraints and implicit UUID references.
 *
 * Returns the fixed-up table map plus a list of warnings for any FK
 * relationships we couldn't fully resolve. The caller decides whether
 * to surface them (via `sow doctor`) or fail hard.
 */
export async function ensureReferentialIntegrity(
  adapter: DatabaseAdapter,
  sampledTables: Map<string, Record<string, unknown>[]>,
  relationships: Relationship[],
): Promise<ReferentialIntegrityResult> {
  const result = new Map(
    Array.from(sampledTables.entries()).map(([k, v]) => [k, [...v]]),
  );
  const warnings: IntegrityWarning[] = [];
  // Dedupe warnings by relationship+target so we emit one line per
  // (source, target) pair even if many child rows have orphaned FKs.
  const warnedRelationships = new Set<string>();

  // Build the set of (table, column) pairs already handled by the formal-FK
  // pass. The implicit-reference pass below must not revisit these, otherwise
  // it would issue redundant queries and potentially mask failures. This
  // replaces a hardcoded English-biased skip list (`id`, `user_id`, ...).
  const formallyHandled = new Set<string>();
  for (const rel of relationships) {
    if (rel.sourceTable === rel.targetTable) continue;
    for (const col of rel.sourceColumns) {
      formallyHandled.add(`${rel.sourceTable}.${col}`);
    }
  }

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
            // Identifiers are quoted (not parameterizable in Postgres);
            // values go through $1,$2,... bind parameters. Safe against a
            // text PK like "O'Brien" and against crafted payloads.
            const conditions = rel.targetColumns
              .map((col, i) => `${quoteIdent(col)} = $${i + 1}`)
              .join(" AND ");

            const rows = await adapter.query(
              `SELECT * FROM ${quoteIdent(rel.targetTable)} WHERE ${conditions} LIMIT 1`,
              keyParts,
            );
            if (rows.length > 0) {
              const existing = result.get(rel.targetTable) || [];
              existing.push(rows[0] as Record<string, unknown>);
              result.set(rel.targetTable, existing);
              changed = true;
            } else {
              // Genuine miss: the source data references a parent that
              // does not exist in the source DB. Dedupe by relationship
              // name so we don't flood when many child rows reference
              // the same orphaned parent.
              const fingerprint = `parent_not_found:${rel.sourceTable}.${rel.sourceColumns.join(",")}->${rel.targetTable}`;
              if (!warnedRelationships.has(fingerprint)) {
                warnedRelationships.add(fingerprint);
                warnings.push({
                  kind: "parent_not_found",
                  sourceTable: rel.sourceTable,
                  sourceColumns: rel.sourceColumns,
                  targetTable: rel.targetTable,
                  targetColumns: rel.targetColumns,
                  reason: `No parent row found for FK value (${rel.targetColumns.length} column(s))`,
                });
              }
            }
          } catch (err) {
            warnings.push({
              kind: "parent_fetch_failed",
              sourceTable: rel.sourceTable,
              sourceColumns: rel.sourceColumns,
              targetTable: rel.targetTable,
              targetColumns: rel.targetColumns,
              reason: truncateReason(err),
            });
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
              const values = rel.sourceColumns.map((_, i) =>
                String(parent[rel.targetColumns[i]] ?? ""),
              );
              const conditions = rel.sourceColumns
                .map((col, i) => `${quoteIdent(col)} = $${i + 1}`)
                .join(" AND ");

              const rows = await adapter.query(
                `SELECT * FROM ${quoteIdent(rel.sourceTable)} WHERE ${conditions} LIMIT 1`,
                values,
              );
              if (rows.length > 0) {
                const existing = result.get(rel.sourceTable) || [];
                existing.push(rows[0] as Record<string, unknown>);
                result.set(rel.sourceTable, existing);
                changed = true;
              }
            } catch (err) {
              warnings.push({
                kind: "child_fetch_failed",
                sourceTable: rel.sourceTable,
                sourceColumns: rel.sourceColumns,
                targetTable: rel.targetTable,
                targetColumns: rel.targetColumns,
                reason: truncateReason(err),
              });
            }
          }
        }
      }
    }

    if (!changed) break;
  }

  // Second pass: follow implicit FK references (UUID columns ending in _id)
  await resolveImplicitReferences(
    adapter,
    result,
    formallyHandled,
    warnings,
  );

  return { tables: result, warnings };
}

/**
 * Detect implicit FK references by finding UUID columns named *_id
 * and fetching any missing referenced rows from inferred target tables.
 *
 * Batches queries by target table: for a 50-table schema with many
 * `_id` columns, the pre-batch version would fire one query per
 * (source_table, source_column) pair even when multiple sources
 * reference the same parent. The batched version collects all missing
 * ids per target table across ALL source tables, then issues one
 * `IN ($1, $2, ...)` query per target. This cuts `sow connect` time
 * from ~30-60s (remote VPN) to a single round-trip per target.
 */
async function resolveImplicitReferences(
  adapter: DatabaseAdapter,
  result: Map<string, Record<string, unknown>[]>,
  formallyHandled: Set<string>,
  warnings: IntegrityWarning[],
): Promise<void> {
  const allTableNames = new Set(result.keys());

  // Collect all missing ids grouped by target table. A single target
  // table may be referenced by many source tables; we want one query
  // per target, not one query per source-target pair.
  const missingByTarget = new Map<string, Set<string>>();

  for (const [tableName, rows] of result.entries()) {
    if (rows.length === 0) continue;

    const sampleRow = rows[0];
    for (const colName of Object.keys(sampleRow)) {
      if (!colName.endsWith("_id")) continue;

      // Skip columns already handled by a formal FK. This replaces the
      // old hardcoded English-biased list (["id","user_id","owner_id",
      // "created_by"]) with a dynamic check computed from the actual
      // schema relationships, so non-English column names and unusual
      // FK layouts work correctly.
      if (formallyHandled.has(`${tableName}.${colName}`)) continue;

      const targetTable = inferTargetTable(colName, allTableNames);
      if (!targetTable) continue;

      const targetRows = result.get(targetTable) || [];
      const targetIds = new Set(targetRows.map((r) => String(r.id ?? "")));

      for (const row of rows) {
        const val = String(row[colName] ?? "");
        if (val && UUID_RE.test(val) && !targetIds.has(val)) {
          if (!missingByTarget.has(targetTable)) {
            missingByTarget.set(targetTable, new Set());
          }
          missingByTarget.get(targetTable)!.add(val);
        }
      }
    }
  }

  // One batched query per target table.
  for (const [targetTable, missingSet] of missingByTarget.entries()) {
    const allMissing = Array.from(missingSet);
    if (allMissing.length === 0) continue;

    // Chunk into batches of 100 to keep prepared-statement sizes sane
    // and well under Postgres's 65,535 bind-parameter limit.
    for (let i = 0; i < allMissing.length; i += 100) {
      const batch = allMissing.slice(i, i + 100);
      try {
        const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(",");
        const fetched = await adapter.query(
          `SELECT * FROM ${quoteIdent(targetTable)} WHERE id IN (${placeholders})`,
          batch,
        );
        if (fetched.length > 0) {
          const existing = result.get(targetTable) || [];
          existing.push(...(fetched as Record<string, unknown>[]));
          result.set(targetTable, existing);
        }
      } catch (err) {
        warnings.push({
          kind: "implicit_ref_fetch_failed",
          targetTable,
          reason: truncateReason(err),
        });
      }
    }
  }
}
