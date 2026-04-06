# @sowdb/core

Core engine for [sow](https://github.com/Bugsterapp/sow) -- analyze, sample, sanitize, and branch Postgres databases.

## Install

```bash
npm install @sowdb/core
```

## Usage

```typescript
import {
  PostgresAdapter,
  analyze,
  createSampler,
  createSanitizer,
  createExporter,
  createBranch,
  detectConnection,
} from "@sowdb/core";

// Analyze a database
const adapter = new PostgresAdapter();
await adapter.connect("postgresql://user:pass@host:5432/mydb");
const analysis = await analyze(adapter);

// Detect connections in a project
const detection = detectConnection("/path/to/project");
console.log(detection.connections);

// Create a branch
const branch = await createBranch("my-feature", "connector-name");
console.log(branch.connectionString);
```

## Provider System

sow uses a provider plugin system for branch management:

```typescript
import type { BranchProvider } from "@sowdb/core";

class MyProvider implements BranchProvider {
  readonly name = "my-provider";
  async detect() { /* ... */ }
  async createBranch(opts) { /* ... */ }
  // ...
}
```

See [CONTRIBUTING.md](https://github.com/Bugsterapp/sow/blob/main/CONTRIBUTING.md) for how to add a new provider.

## License

[MIT](https://github.com/Bugsterapp/sow/blob/main/LICENSE)
