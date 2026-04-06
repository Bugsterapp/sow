# Contributing to sow

Thank you for your interest in contributing to sow! This guide will help you
get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/Bugsterapp/sow.git
cd sow

# Install dependencies (requires Bun)
bun install

# Set up environment
cp .env.example .env
# Add your DATABASE_URL

# Run CLI in dev mode
bun run --filter @sowdb/cli dev

# Build all packages
bun run build

# Run tests
bun test
```

## Project Structure

```
packages/
  core/     # Shared engine: analyzer, sampler, sanitizer, exporter, branching
  cli/      # CLI application (meow + readline)
  mcp/      # MCP server for agent integration
```

Build order: `core` first, then `cli` and `mcp` in parallel.

### Core Package Layout

```
packages/core/src/
  adapters/         # Database adapters (postgres.ts, type-mapper.ts)
  analyzer/         # Schema analysis, stats, relationships, PII detection
  branching/        # Branch lifecycle, connectors, storage
    providers/      # BranchProvider implementations (docker.ts, supabase.ts)
    provider.ts     # BranchProvider interface
    provider-registry.ts  # Provider detection + resolution
    manager.ts      # Branch orchestrator
    connector.ts    # Snapshot creation
  config/           # .sow.yml loading + merging
  detect/           # Auto-detection of Postgres connections
  exporter/         # SQL, Docker, SQLite, JSON export formats
  sampler/          # Row sampling, edge cases, referential integrity
  sanitizer/        # PII detection + fake data generation
  types.ts          # Core type definitions
```

## How to Add a New Database Adapter

sow is designed with a plugin architecture. The `DatabaseAdapter` interface
in `packages/core/src/types.ts` defines the contract for database support.

### Step 1: Create the adapter package

```bash
mkdir -p packages/adapter-mysql/src
```

### Step 2: Implement the `DatabaseAdapter` interface

```typescript
// packages/adapter-mysql/src/index.ts
import type { DatabaseAdapter, SchemaInfo, TableStats, ColumnStats, ConnectionInfo } from "@sowdb/core";

export class MySQLAdapter implements DatabaseAdapter {
  async connect(connectionString: string): Promise<void> {
    // Connect to MySQL using mysql2 or similar
  }

  async disconnect(): Promise<void> {
    // Close the connection
  }

  getConnectionInfo(): ConnectionInfo {
    // Return masked connection info
  }

  async getSchema(): Promise<SchemaInfo> {
    // Query INFORMATION_SCHEMA for MySQL
    // Map MySQL types to the common SchemaInfo structure
  }

  async getTableStats(table: string): Promise<TableStats> {
    // SELECT COUNT(*), table sizes, etc.
  }

  async getColumnStats(table: string, column: string): Promise<ColumnStats> {
    // Column cardinality, null counts, min/max
  }

  async getSampleRows(table: string, limit: number, offset?: number): Promise<Record<string, unknown>[]> {
    // SELECT * FROM table LIMIT ? OFFSET ?
  }

  async getAllRows(table: string): Promise<Record<string, unknown>[]> {
    // SELECT * FROM table
  }

  async getRandomSample(table: string, limit: number, seed: number): Promise<Record<string, unknown>[]> {
    // Random sampling with seed
  }

  async getRowCount(table: string): Promise<number> {
    // SELECT COUNT(*) FROM table
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    // Execute raw SQL
  }
}
```

### Step 3: Implement the `TypeMapper` interface

```typescript
import type { TypeMapper } from "@sowdb/core";

export class MySQLTypeMapper implements TypeMapper {
  toSQLite(sourceType: string): string {
    // Map MySQL types to SQLite types
  }

  toJSON(sourceType: string): string {
    // Map MySQL types to JSON-safe representations
  }

  toInsertLiteral(value: unknown, sourceType: string): string {
    // Convert a value to a SQL literal string
  }

  needsQuoting(sourceType: string): boolean {
    // Return true for string/date/etc types
  }
}
```

### Key considerations for new adapters

1. **Read-only access**: Never write to the source database
2. **Connection masking**: Always mask passwords in `getConnectionInfo()`
3. **Schema mapping**: Map your database's type system to the common `ColumnInfo.type`
4. **FK detection**: Implement FK relationship detection for your database
5. **Error handling**: Wrap all queries in try-catch with helpful error messages

## How to Add a New Branch Provider

Branch providers control how sow creates and manages isolated databases.
The `BranchProvider` interface in `packages/core/src/branching/provider.ts`
defines the contract.

Built-in providers:
- **Docker** (`providers/docker.ts`) -- Standalone Postgres container
- **Supabase** (`providers/supabase.ts`) -- Local Supabase integration

### Step 1: Create the provider file

```typescript
// packages/core/src/branching/providers/neon.ts
import type {
  BranchProvider,
  ProviderDetection,
  ProviderBranchOpts,
  ProviderBranchResult,
} from "../provider.js";
import type { Branch, BranchStatus } from "../types.js";

export class NeonBranchProvider implements BranchProvider {
  readonly name = "neon";

  async detect(): Promise<ProviderDetection | null> {
    // Check if Neon is available (e.g. NEON_API_KEY env var)
    const apiKey = process.env.NEON_API_KEY;
    if (!apiKey) return null;
    return { meta: { apiKey } };
  }

  async createBranch(opts: ProviderBranchOpts): Promise<ProviderBranchResult> {
    // Use Neon API to create a branch from the project
    // Load init.sql into the branch
    // Return connection string
    return {
      connectionString: "postgresql://...",
      port: 5432,
      providerMeta: { branchId: "...", projectId: "..." },
    };
  }

  async deleteBranch(branch: Branch): Promise<void> {
    // Delete the Neon branch via API
  }

  async resetBranch(branch: Branch, initSqlPath: string): Promise<void> {
    // Delete and recreate the branch
  }

  async execSQL(branch: Branch, sql: string): Promise<string> {
    // Connect and execute SQL
  }

  async getBranchStatus(branch: Branch): Promise<BranchStatus> {
    // Check if the Neon branch exists and is accessible
    return "running";
  }
}
```

### Step 2: Register the provider

Add your provider to `packages/core/src/branching/provider-registry.ts`:

```typescript
import { NeonBranchProvider } from "./providers/neon.js";

const providers: BranchProvider[] = [
  new SupabaseBranchProvider(),  // checked first
  new NeonBranchProvider(),      // checked second
  new DockerBranchProvider(),    // fallback
];
```

### Step 3: Optional -- add a `postSnapshot` hook

If your provider needs to extract data during `sow connect` (like Supabase
extracts auth users), implement the optional `postSnapshot` method:

```typescript
async postSnapshot(adapter, tables) {
  // Extract provider-specific data from the source DB
  return { authUsers: [...] };
}
```

### Key concepts

- **`detect()`** -- Return `null` if the provider isn't available. Return
  `{ meta: {...} }` with any info needed by `createBranch`.
- **`providerMeta`** -- Provider-specific data stored on the `Branch` object.
  Access it via `branch.providerMeta` in other methods.
- **Priority** -- Providers are checked in array order. Put more specific
  providers (Supabase, Neon) before the generic Docker fallback.
- **Optional methods** -- `stopBranch`, `startBranch`, `dumpBranch`,
  `restoreDump` are optional. Omit them if your provider doesn't support
  pause/resume or checkpoints.

## Code Style

- TypeScript strict mode
- ESM modules (`.js` extensions in imports)
- No barrel files -- import from specific paths
- Bun-first, Node.js compatible

## Pull Requests

1. Fork the repo and create a feature branch
2. Write tests for new functionality
3. Ensure `bun test` passes
4. Submit a PR with a clear description

## License

By contributing, you agree that your contributions will be licensed under the
MIT License. See [LICENSE](LICENSE) for details.
