import postgres from "postgres";
import type {
  DatabaseAdapter,
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  ConstraintInfo,
  Relationship,
  IndexInfo,
  EnumType,
  TableStats,
  ColumnStats,
  ConnectionInfo,
} from "../types.js";
import { parseConnectionError } from "../errors.js";

export class PostgresAdapter implements DatabaseAdapter {
  private sql: postgres.Sql | null = null;
  private connString = "";

  async connect(connectionString: string): Promise<void> {
    this.connString = connectionString;
    this.sql = postgres(connectionString, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    try {
      await this.sql`SELECT 1`;
    } catch (err) {
      await this.sql.end();
      this.sql = null;
      throw parseConnectionError(err, connectionString);
    }
  }

  async disconnect(): Promise<void> {
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
    }
  }

  getConnectionInfo(): ConnectionInfo {
    const url = new URL(this.connString);
    return {
      host: url.hostname,
      port: parseInt(url.port || "5432", 10),
      database: url.pathname.slice(1),
      user: url.username,
      masked: `postgresql://${url.username}:****@${url.hostname}:${url.port || 5432}${url.pathname}`,
    };
  }

  private db(): postgres.Sql {
    if (!this.sql) throw new Error("Not connected. Call connect() first.");
    return this.sql;
  }

  async getSchema(): Promise<SchemaInfo> {
    const [tables, relationships, indexes, enums, extensions] =
      await Promise.all([
        this.getTables(),
        this.getRelationships(),
        this.getIndexes(),
        this.getEnums(),
        this.getExtensions(),
      ]);

    return { tables, relationships, indexes, enums, extensions };
  }

  private async getTables(): Promise<TableInfo[]> {
    const sql = this.db();

    const rawColumns = await sql`
      SELECT
        t.table_schema,
        t.table_name,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.is_generated
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name, c.ordinal_position
    `;

    const rawConstraints = await sql`
      SELECT
        tc.table_schema,
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = 'public'
      ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
    `;

    const tableMap = new Map<string, TableInfo>();

    for (const row of rawColumns) {
      const key = `${row.table_schema}.${row.table_name}`;
      if (!tableMap.has(key)) {
        tableMap.set(key, {
          name: row.table_name as string,
          schema: row.table_schema as string,
          columns: [],
          primaryKey: [],
          constraints: [],
        });
      }
      const table = tableMap.get(key)!;

      const col: ColumnInfo = {
        name: row.column_name as string,
        type: (row.udt_name as string) || (row.data_type as string),
        nullable: row.is_nullable === "YES",
        defaultValue: row.column_default as string | null,
        maxLength: row.character_maximum_length as number | null,
        isGenerated: row.is_generated === "ALWAYS",
      };
      table.columns.push(col);
    }

    const constraintMap = new Map<string, ConstraintInfo>();
    for (const row of rawConstraints) {
      const cKey = `${row.table_schema}.${row.table_name}.${row.constraint_name}`;
      if (!constraintMap.has(cKey)) {
        constraintMap.set(cKey, {
          name: row.constraint_name as string,
          type: row.constraint_type as ConstraintInfo["type"],
          columns: [],
        });
      }
      constraintMap.get(cKey)!.columns.push(row.column_name as string);
    }

    for (const [cKey, constraint] of constraintMap) {
      const [schema, tableName] = cKey.split(".");
      const tKey = `${schema}.${tableName}`;
      const table = tableMap.get(tKey);
      if (!table) continue;

      table.constraints.push(constraint);
      if (constraint.type === "PRIMARY KEY") {
        table.primaryKey = constraint.columns;
      }
    }

    return Array.from(tableMap.values());
  }

  private async getRelationships(): Promise<Relationship[]> {
    const sql = this.db();

    const rows = await sql`
      SELECT
        tc.constraint_name,
        tc.table_name AS source_table,
        kcu.column_name AS source_column,
        ccu.table_name AS target_table,
        ccu.column_name AS target_column,
        rc.delete_rule,
        rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.constraint_name, kcu.ordinal_position
    `;

    const relMap = new Map<string, Relationship>();
    for (const row of rows) {
      const name = row.constraint_name as string;
      if (!relMap.has(name)) {
        relMap.set(name, {
          name,
          sourceTable: row.source_table as string,
          sourceColumns: [],
          targetTable: row.target_table as string,
          targetColumns: [],
          onDelete: row.delete_rule as string,
          onUpdate: row.update_rule as string,
        });
      }
      const rel = relMap.get(name)!;
      rel.sourceColumns.push(row.source_column as string);
      rel.targetColumns.push(row.target_column as string);
    }

    return Array.from(relMap.values());
  }

  private async getIndexes(): Promise<IndexInfo[]> {
    const sql = this.db();

    const rows = await sql`
      SELECT
        i.relname AS index_name,
        t.relname AS table_name,
        a.attname AS column_name,
        ix.indisunique AS is_unique,
        am.amname AS index_type
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_am am ON am.oid = i.relam
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = 'public'
        AND NOT ix.indisprimary
      ORDER BY i.relname, a.attnum
    `;

    const indexMap = new Map<string, IndexInfo>();
    for (const row of rows) {
      const name = row.index_name as string;
      if (!indexMap.has(name)) {
        indexMap.set(name, {
          name,
          table: row.table_name as string,
          columns: [],
          unique: row.is_unique as boolean,
          type: row.index_type as string,
        });
      }
      indexMap.get(name)!.columns.push(row.column_name as string);
    }

    return Array.from(indexMap.values());
  }

  private async getEnums(): Promise<EnumType[]> {
    const sql = this.db();

    const rows = await sql`
      SELECT
        n.nspname AS schema,
        t.typname AS name,
        e.enumlabel AS value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder
    `;

    const enumMap = new Map<string, EnumType>();
    for (const row of rows) {
      const name = row.name as string;
      if (!enumMap.has(name)) {
        enumMap.set(name, {
          name,
          schema: row.schema as string,
          values: [],
        });
      }
      enumMap.get(name)!.values.push(row.value as string);
    }

    return Array.from(enumMap.values());
  }

  private async getExtensions(): Promise<string[]> {
    const sql = this.db();
    const rows = await sql`
      SELECT extname FROM pg_extension WHERE extname != 'plpgsql'
    `;
    return rows.map((r) => r.extname as string);
  }

  async getTableStats(table: string): Promise<TableStats> {
    const sql = this.db();

    const [countResult] = await sql`
      SELECT count(*)::int AS row_count FROM ${sql(table)}
    `;

    const [sizeResult] = await sql`
      SELECT pg_total_relation_size(${table}::regclass)::bigint AS size_bytes
    `;

    const schemaInfo = await this.getSchema();
    const tableInfo = schemaInfo.tables.find((t) => t.name === table);
    const columnStats: ColumnStats[] = [];

    if (tableInfo) {
      for (const col of tableInfo.columns) {
        const stats = await this.getColumnStats(table, col.name);
        columnStats.push(stats);
      }
    }

    return {
      table,
      rowCount: countResult.row_count as number,
      sizeBytes: sizeResult.size_bytes as number,
      columnStats,
    };
  }

  async getColumnStats(table: string, column: string): Promise<ColumnStats> {
    const sql = this.db();

    const [result] = await sql`
      SELECT
        count(DISTINCT ${sql(column)})::int AS distinct_count,
        count(*) FILTER (WHERE ${sql(column)} IS NULL)::int AS null_count,
        count(*)::int AS total_count
      FROM ${sql(table)}
    `;

    let minValue: unknown = null;
    let maxValue: unknown = null;
    let avgLength: number | null = null;

    try {
      const [minMax] = await sql`
        SELECT
          min(${sql(column)}) AS min_val,
          max(${sql(column)}) AS max_val
        FROM ${sql(table)}
      `;
      minValue = minMax.min_val;
      maxValue = minMax.max_val;
    } catch {
      // Some types don't support min/max
    }

    try {
      const [lenResult] = await sql`
        SELECT avg(length(${sql(column)}::text))::float AS avg_len
        FROM ${sql(table)}
        WHERE ${sql(column)} IS NOT NULL
      `;
      avgLength = lenResult.avg_len as number | null;
    } catch {
      // Ignore if length() doesn't apply
    }

    const total = result.total_count as number;
    const nullCount = result.null_count as number;

    return {
      column,
      distinctCount: result.distinct_count as number,
      nullCount,
      nullPercentage: total > 0 ? (nullCount / total) * 100 : 0,
      minValue,
      maxValue,
      avgLength,
    };
  }

  async getSampleRows(
    table: string,
    limit: number,
    offset = 0,
  ): Promise<Record<string, unknown>[]> {
    const sql = this.db();
    const rows = await sql`
      SELECT * FROM ${sql(table)} LIMIT ${limit} OFFSET ${offset}
    `;
    return rows as Record<string, unknown>[];
  }

  async getAllRows(table: string): Promise<Record<string, unknown>[]> {
    const sql = this.db();
    const rows = await sql`SELECT * FROM ${sql(table)}`;
    return rows as Record<string, unknown>[];
  }

  async getRandomSample(
    table: string,
    limit: number,
    seed: number,
  ): Promise<Record<string, unknown>[]> {
    const sql = this.db();
    await sql`SELECT setseed(${(seed % 1000) / 1000})`;
    const rows = await sql`
      SELECT * FROM ${sql(table)} ORDER BY random() LIMIT ${limit}
    `;
    return rows as Record<string, unknown>[];
  }

  async getRowCount(table: string): Promise<number> {
    const sql = this.db();
    const [result] = await sql`
      SELECT count(*)::int AS count FROM ${sql(table)}
    `;
    return result.count as number;
  }

  async query<T = Record<string, unknown>>(
    sqlStr: string,
    params?: unknown[],
  ): Promise<T[]> {
    const sql = this.db();
    // postgres@3 `sql.unsafe(query, parameters)` binds values via real
    // placeholders ($1, $2, ...) when `parameters` is provided. Passing
    // undefined runs the query literally. This is the only safe path for
    // SQL built with dynamic structure (see sampler/referential.ts).
    const rows = params && params.length > 0
      ? await sql.unsafe(sqlStr, params as unknown as Parameters<typeof sql.unsafe>[1])
      : await sql.unsafe(sqlStr);
    return rows as unknown as T[];
  }
}
