// ---------------------------------------------------------------------------
// Database Adapter — the plugin seam for future MySQL / MongoDB / etc.
// ---------------------------------------------------------------------------

export interface DatabaseAdapter {
  connect(connectionString: string): Promise<void>;
  disconnect(): Promise<void>;

  getSchema(): Promise<SchemaInfo>;
  getTableStats(table: string): Promise<TableStats>;
  getColumnStats(table: string, column: string): Promise<ColumnStats>;
  getSampleRows(
    table: string,
    limit: number,
    offset?: number,
  ): Promise<Record<string, unknown>[]>;
  getAllRows(table: string): Promise<Record<string, unknown>[]>;
  getRandomSample(
    table: string,
    limit: number,
    seed: number,
  ): Promise<Record<string, unknown>[]>;
  getRowCount(table: string): Promise<number>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;

  getConnectionInfo(): ConnectionInfo;
}

export interface ConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  masked: string;
}

// ---------------------------------------------------------------------------
// Type Mapper — translates source DB types to export targets
// ---------------------------------------------------------------------------

export interface TypeMapper {
  toSQLite(sourceType: string): string;
  toJSON(sourceType: string): string;
  toInsertLiteral(value: unknown, sourceType: string): string;
  needsQuoting(sourceType: string): boolean;
}

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export interface SchemaInfo {
  tables: TableInfo[];
  relationships: Relationship[];
  indexes: IndexInfo[];
  enums: EnumType[];
  extensions: string[];
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  constraints: ConstraintInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  maxLength: number | null;
  isGenerated: boolean;
}

export interface ConstraintInfo {
  name: string;
  type: "PRIMARY KEY" | "UNIQUE" | "CHECK" | "FOREIGN KEY" | "EXCLUDE";
  columns: string[];
}

export interface Relationship {
  name: string;
  sourceTable: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface IndexInfo {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  type: string;
}

export interface EnumType {
  name: string;
  schema: string;
  values: string[];
}

// ---------------------------------------------------------------------------
// Statistics types
// ---------------------------------------------------------------------------

export interface TableStats {
  table: string;
  rowCount: number;
  sizeBytes: number | null;
  columnStats: ColumnStats[];
}

export interface ColumnStats {
  column: string;
  distinctCount: number;
  nullCount: number;
  nullPercentage: number;
  minValue: unknown | null;
  maxValue: unknown | null;
  avgLength: number | null;
}

// ---------------------------------------------------------------------------
// PII detection types
// ---------------------------------------------------------------------------

export type PIIType =
  | "email"
  | "phone"
  | "name"
  | "address"
  | "ssn"
  | "credit_card"
  | "ip"
  | "ip_address"
  | "mac_address"
  | "url"
  | "uuid"
  | "date_of_birth"
  | "password"
  | "free_text"
  | "jsonb"
  | "xml_text"
  | "binary_blob"
  | "passthrough"
  | "custom";

export type PIIConfidence = "high" | "medium" | "low" | "uncertain";

export interface PIIPattern {
  type: PIIType;
  columnNamePatterns: RegExp[];
  valuePatterns: RegExp[];
  description: string;
}

export interface PIIDetectionResult {
  isPII: boolean;
  type: PIIType | null;
  confidence: PIIConfidence;
  matchedBy: "column_name" | "value_pattern" | null;
  sampleMatches: number;
  totalSampled: number;
}

export interface PIIColumnInfo {
  table: string;
  column: string;
  type: PIIType;
  confidence: PIIConfidence;
  matchedBy: "column_name" | "value_pattern";
}

// ---------------------------------------------------------------------------
// Edge case types
// ---------------------------------------------------------------------------

export interface EdgeCaseInfo {
  table: string;
  column: string;
  type: EdgeCaseType;
  value: unknown;
  rowIndex: number;
}

export type EdgeCaseType =
  | "null"
  | "empty_string"
  | "min_numeric"
  | "max_numeric"
  | "longest_string"
  | "shortest_string"
  | "special_chars"
  | "unicode"
  | "emoji";

// ---------------------------------------------------------------------------
// Data pattern types
// ---------------------------------------------------------------------------

export interface DataTypePattern {
  table: string;
  column: string;
  detectedType: PIIType;
  confidence: PIIConfidence;
  sampleSize: number;
}

// ---------------------------------------------------------------------------
// Analysis result — the full output of the analyzer
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  schema: SchemaInfo;
  stats: {
    tables: TableStats[];
    totalSizeBytes: number;
    totalRows: number;
  };
  patterns: {
    piiColumns: PIIColumnInfo[];
    edgeCases: EdgeCaseInfo[];
    dataTypes: DataTypePattern[];
  };
  dependencyOrder: string[];
}

// ---------------------------------------------------------------------------
// Sampling config
// ---------------------------------------------------------------------------

export interface SamplingConfig {
  maxRowsPerTable: number;
  includeEdgeCases: boolean;
  seed: number;
  excludeTables: string[];
  includeTables: string[];
}

export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  maxRowsPerTable: 200,
  includeEdgeCases: true,
  seed: 42,
  excludeTables: [],
  includeTables: [],
};

// ---------------------------------------------------------------------------
// Sampling result
// ---------------------------------------------------------------------------

export interface SampledTable {
  table: string;
  rows: Record<string, unknown>[];
  totalRowsInSource: number;
  edgeCasesIncluded: EdgeCaseInfo[];
}

export interface SamplingResult {
  tables: SampledTable[];
  config: SamplingConfig;
  /**
   * Non-fatal problems encountered while ensuring referential integrity.
   * Each entry describes an FK relationship that could not be fully resolved.
   * The sample still completed; these rows may have dangling foreign keys.
   * Surfaced by `sow doctor <connector>` so users know what isn't guaranteed.
   */
  integrityWarnings: IntegrityWarning[];
}

/** A non-fatal referential-integrity problem captured during sampling. */
export interface IntegrityWarning {
  kind:
    | "parent_fetch_failed"
    | "parent_not_found"
    | "child_fetch_failed"
    | "implicit_ref_fetch_failed";
  /** The source (child) table and column(s) involved, if any. */
  sourceTable?: string;
  sourceColumns?: string[];
  /** The target (parent) table and column(s) being resolved. */
  targetTable: string;
  targetColumns?: string[];
  /** Short, human-readable summary (no secrets, no raw values). */
  reason: string;
}

// ---------------------------------------------------------------------------
// Sanitization config & rules
// ---------------------------------------------------------------------------

export interface SanitizationConfig {
  enabled: boolean;
  rules: SanitizationRule[];
  skipColumns: string[];
  /**
   * When true, columns with unknown Postgres types are NULLed out rather
   * than aborting. When false (default), sanitize() throws SanitizationAbort.
   */
  allowUnsafe?: boolean;
}

export interface UnhandledColumn {
  table: string;
  column: string;
  pgType: string;
  reason: string;
}

export interface SanitizationRule {
  table: string;
  column: string;
  type: PIIType;
  transformer?: (originalValue: string, seed: string) => string;
}

export interface SanitizedTable {
  table: string;
  rows: Record<string, unknown>[];
  sanitizedColumns: string[];
}

export interface SanitizationResult {
  tables: SanitizedTable[];
  rulesApplied: SanitizationRule[];
  columnsSkipped: string[];
  /**
   * Columns whose Postgres type the sanitizer could not verify.
   * Populated whenever allowUnsafe is true (these columns are NULLed).
   * Empty when allowUnsafe is false (sanitize() will throw instead).
   */
  unhandledColumns?: UnhandledColumn[];
  /** Human-readable warnings surfaced by the sanitizer (for `sow doctor`). */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Export config
// ---------------------------------------------------------------------------

export type ExportFormat = "sql" | "docker" | "sqlite" | "json";

export interface ExportConfig {
  format: ExportFormat;
  outputPath: string;
  schema: SchemaInfo;
}

export interface ExportResult {
  format: ExportFormat;
  outputPath: string;
  files: string[];
  totalSize: number;
  tableCount: number;
  rowCount: number;
}


// ---------------------------------------------------------------------------
// Progress events (for --json mode and MCP)
// ---------------------------------------------------------------------------

export type ProgressEventType =
  | "connecting"
  | "analyzing_schema"
  | "analyzing_stats"
  | "detecting_pii"
  | "sanitizing"
  | "selecting_samples"
  | "exporting"
  | "done"
  | "error";

export interface ProgressEvent {
  type: ProgressEventType;
  message: string;
  progress?: number;
  total?: number;
  detail?: Record<string, unknown>;
}

export type ProgressCallback = (event: ProgressEvent) => void;
