# @sowdb/mcp

MCP (Model Context Protocol) server for [sow](https://github.com/Bugsterapp/sow) -- gives AI agents 15 tools to manage test database branches.

## Install

```bash
npm install -g @sowdb/mcp
```

## Configure for Your Agent

```bash
# Print config for your agent
sow mcp --agent cursor
sow mcp --agent claude-code
sow mcp --agent windsurf
```

Or add manually to your agent's MCP config:

```json
{
  "mcpServers": {
    "sow": {
      "command": "sow-mcp"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `sow_detect` | Scan project for Postgres connections |
| `sow_connect` | Create sanitized snapshot from production |
| `sow_analyze` | Analyze database schema and PII |
| `sow_branch_create` | Create isolated test branch |
| `sow_branch_list` | List all branches |
| `sow_branch_delete` | Delete a branch |
| `sow_branch_diff` | Show changes since creation |
| `sow_branch_reset` | Reset to original snapshot |
| `sow_branch_exec` | Run SQL against a branch |
| `sow_branch_save` | Save checkpoint |
| `sow_branch_load` | Load checkpoint |
| `sow_branch_info` | Get branch details |
| `sow_branch_stop` | Stop a branch |
| `sow_branch_start` | Start a stopped branch |
| `sow_connector_list` | List saved connectors |
| `sow_connector_delete` | Delete a connector |
| `sow_connector_refresh` | Re-sync snapshot |

## License

[MIT](https://github.com/Bugsterapp/sow/blob/main/LICENSE)
