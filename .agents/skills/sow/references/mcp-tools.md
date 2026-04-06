# MCP Tools Reference

sow exposes MCP tools through the `sow-mcp` server. All tools are available over stdio transport.

## Detection & Connection Tools

### sow_detect

Scan the current project to find PostgreSQL connection strings automatically. Checks environment variables, .env files, Prisma schema, Drizzle config, Knex config, Docker Compose, and package.json dependencies.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `projectRoot` | string | no | Path to the project root (defaults to cwd) |

**Example output:**
```json
{
  "connections": [
    {
      "source": "Prisma schema",
      "sourceFile": "prisma/schema.prisma",
      "envVar": "DATABASE_URL",
      "connectionString": "postgresql://user:pass@localhost:5432/myapp",
      "confidence": "medium"
    },
    {
      "source": "Docker Compose",
      "sourceFile": "docker-compose.yml",
      "connectionString": "postgresql://postgres:postgres@localhost:5432/myapp",
      "confidence": "low"
    }
  ],
  "hints": [],
  "warnings": []
}
```

**When to use:** Before `sow_connect` to discover the database connection string. Use the highest-confidence connection from the results, then pass it to `sow_connect`.

### sow_connect

Create a sanitized snapshot from a production Postgres database.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `connectionString` | string | yes | Postgres connection URL |
| `name` | string | no | Name for the connector (defaults to DB name) |
| `maxRowsPerTable` | number | no | Max rows to sample (default: 50) |
| `excludeTables` | string[] | no | Tables to skip |
| `noSanitize` | boolean | no | Skip PII sanitization |
| `seed` | number | no | Random seed (default: 42) |

**Example input:**
```json
{
  "connectionString": "postgresql://user:pass@host:5432/mydb",
  "name": "prod",
  "maxRowsPerTable": 100
}
```

**Example output:**
```json
{
  "name": "prod",
  "tables": 14,
  "rows": 847,
  "piiColumnsDetected": 8,
  "sizeBytes": 2200000,
  "snapshotPath": "/home/user/.sow/snapshots/prod"
}
```

**When to use:** First time connecting to a database. Only needs to run once per database. Subsequent operations use the saved snapshot.

### sow_connector_list

List all saved connectors.

**Parameters:** None

**Example output:**
```json
[
  {
    "name": "mydb",
    "tables": 14,
    "rows": 847,
    "sizeBytes": 2200000,
    "createdAt": "2025-01-15T10:30:00.000Z"
  }
]
```

### sow_connector_delete

Delete a connector and its snapshot.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Connector name |

### sow_connector_refresh

Re-create a snapshot with fresh data from the original connection string.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Connector name |

## Branch Lifecycle Tools

### sow_branch_create

Create an isolated database branch. Returns a connection string.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Branch name |
| `connector` | string | no | Connector to branch from |
| `port` | number | no | Specific port (54320-54399) |
| `pgVersion` | string | no | Postgres version (default: "16") |

**Example input:**
```json
{
  "name": "test-migration",
  "connector": "mydb"
}
```

**Example output:**
```json
{
  "name": "test-migration",
  "connector": "mydb",
  "port": 54320,
  "status": "running",
  "connectionString": "postgresql://sow:sow@localhost:54320/sow",
  "createdAt": "2025-01-15T10:35:00.000Z"
}
```

**When to use:** Every time you need an isolated database for testing. Creates in ~5 seconds.

### sow_branch_list

List all branches with their current status.

**Parameters:** None

**Example output:**
```json
[
  {
    "name": "test-migration",
    "connector": "mydb",
    "port": 54320,
    "status": "running",
    "connectionString": "postgresql://sow:sow@localhost:54320/sow"
  }
]
```

### sow_branch_info

Get details about a specific branch.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Branch name |

### sow_branch_delete

Delete a branch and remove its Docker container.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Branch name |

### sow_branch_stop

Stop a branch's container (saves resources, data preserved).

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Branch name |

### sow_branch_start

Start a previously stopped branch.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Branch name |

## Branch State Tools

### sow_branch_diff

Show what changed in a branch since creation.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Branch name |

**Example output:**
```json
{
  "hasChanges": true,
  "tables": [
    {
      "name": "users",
      "rowsAdded": 3,
      "rowsDeleted": 0,
      "rowsModified": 1,
      "originalCount": 50,
      "currentCount": 53
    }
  ],
  "schemaChanges": [
    {
      "type": "column_added",
      "table": "users",
      "column": "preferences",
      "detail": "ALTER TABLE users ADD COLUMN preferences JSONB"
    }
  ]
}
```

**When to use:** After running migrations or making changes to verify what happened.

### sow_branch_reset

Reset a branch to its original snapshot state.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Branch name |

**When to use:** Between test runs to get a clean slate. Takes ~1 second.

### sow_branch_save

Save current branch state as a named checkpoint.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `branch` | string | yes | Branch name |
| `name` | string | yes | Name for the checkpoint |

### sow_branch_load

Load a previously saved checkpoint into a branch.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `branch` | string | yes | Branch name |
| `checkpoint` | string | yes | Checkpoint to load |

### sow_branch_exec

Run SQL against a branch to set up test scenarios.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `branch` | string | yes | Branch name |
| `sql` | string | yes | SQL to execute |

**Example input:**
```json
{
  "branch": "my-feature",
  "sql": "UPDATE users SET plan = 'expired' WHERE id = 1"
}
```

**When to use:** Setting up specific test scenarios without rebuilding the branch.

## Analysis Tools

### sow_analyze

Analyze a Postgres database: schema, statistics, PII detection.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `connectionString` | string | yes | Postgres connection URL |
| `tables` | string[] | no | Specific tables to analyze |

## Typical Agent Workflow

1. Check if a connector exists: `sow_connector_list`
2. If none, detect the connection: `sow_detect`
3. Create a connector: `sow_connect` (pass the detected connection string)
4. Create a branch: `sow_branch_create`
5. Use the connection string from the result
6. After testing: `sow_branch_diff` to see changes
7. Clean up: `sow_branch_delete`
