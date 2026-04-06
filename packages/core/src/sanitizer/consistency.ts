/**
 * Deterministic hashing: same input always produces the same seed number.
 * This ensures cross-table consistency — if the same email appears in
 * `users.email` and `orders.created_by`, both get the same fake replacement.
 */
export function deterministicSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}
