import type { Relationship, TableInfo } from "../types.js";

/**
 * Build a dependency graph from FK relationships and return tables
 * in topological order (parents before children) using Kahn's algorithm.
 */
export function topologicalSort(
  tables: TableInfo[],
  relationships: Relationship[],
): string[] {
  const tableNames = new Set(tables.map((t) => t.name));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const name of tableNames) {
    inDegree.set(name, 0);
    adjacency.set(name, new Set());
  }

  for (const rel of relationships) {
    if (!tableNames.has(rel.sourceTable) || !tableNames.has(rel.targetTable))
      continue;
    // targetTable is the parent, sourceTable is the child
    if (rel.targetTable === rel.sourceTable) continue; // self-ref
    adjacency.get(rel.targetTable)!.add(rel.sourceTable);
    inDegree.set(
      rel.sourceTable,
      (inDegree.get(rel.sourceTable) || 0) + 1,
    );
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const child of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(child) || 1) - 1;
      inDegree.set(child, newDegree);
      if (newDegree === 0) queue.push(child);
    }
  }

  // If there's a cycle, add remaining tables at the end
  for (const name of tableNames) {
    if (!sorted.includes(name)) {
      sorted.push(name);
    }
  }

  return sorted;
}
