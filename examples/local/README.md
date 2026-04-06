# Local Postgres Example

This example demonstrates using sow with a local Postgres database.

## Prerequisites

- Local Postgres running on port 5432
- A database with some data

## Steps

```bash
# 1. Set your connection string
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mydb

# 2. Connect and create a snapshot
sow connect $DATABASE_URL

# 3. Create a branch
sow branch create my-feature

# 4. Use the branch connection string
psql postgresql://sow:sow@localhost:54320/sow

# 5. Clean up
sow branch delete my-feature
```
