import type { DatabaseAdapter, SchemaInfo } from "../types.js";

export async function extractSchema(
  adapter: DatabaseAdapter,
): Promise<SchemaInfo> {
  return adapter.getSchema();
}
