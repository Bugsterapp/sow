import type { SamplingConfig } from "../types.js";

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Deterministic given the same seed.
 */
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Randomly sample up to `maxRows` from an array of rows,
 * using a deterministic seed.
 */
export function randomSample<T>(
  rows: T[],
  maxRows: number,
  seed: number,
): T[] {
  if (rows.length <= maxRows) return [...rows];

  const rng = createRng(seed);
  const indices = new Set<number>();

  while (indices.size < maxRows) {
    const idx = Math.floor(rng() * rows.length);
    indices.add(idx);
  }

  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((i) => rows[i]);
}

/**
 * Stratified sampling: maintain the ratio of categorical values.
 * Groups rows by the value of a key column, then samples proportionally.
 */
export function stratifiedSample<T extends Record<string, unknown>>(
  rows: T[],
  maxRows: number,
  seed: number,
  groupByColumn?: string,
): T[] {
  if (rows.length <= maxRows) return [...rows];
  if (!groupByColumn) return randomSample(rows, maxRows, seed);

  const groups = new Map<unknown, T[]>();
  for (const row of rows) {
    const key = row[groupByColumn];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const result: T[] = [];
  const rng = createRng(seed);

  for (const [, groupRows] of groups) {
    const proportion = groupRows.length / rows.length;
    const count = Math.max(1, Math.round(proportion * maxRows));
    const sampled = randomSample(groupRows, count, Math.floor(rng() * 1e9));
    result.push(...sampled);
  }

  if (result.length > maxRows) {
    return randomSample(result, maxRows, seed + 1);
  }

  return result;
}
