import type {
  ExportConfig,
  ExportResult,
  SanitizedTable,
  SchemaInfo,
} from "../types.js";
import { exportSQL } from "./sql.js";
import { exportDocker } from "./docker.js";
import { exportSQLite } from "./sqlite.js";
import { exportJSON } from "./json.js";

export interface ExporterOptions {
  config: ExportConfig;
  dependencyOrder: string[];
}

export function createExporter(options: ExporterOptions) {
  const { config, dependencyOrder } = options;

  function exportData(tables: SanitizedTable[]): ExportResult {
    switch (config.format) {
      case "sql":
        return exportSQL(config.schema, tables, dependencyOrder, config.outputPath);
      case "docker":
        return exportDocker(config.schema, tables, dependencyOrder, config.outputPath);
      case "sqlite":
        return exportSQLite(config.schema, tables, dependencyOrder, config.outputPath);
      case "json":
        return exportJSON(tables, config.outputPath);
      default:
        throw new Error(`Unsupported export format: ${config.format}`);
    }
  }

  return { export: exportData };
}
