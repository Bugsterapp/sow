import { resolve } from "node:path";

function getCommand(isLocal: boolean): string {
  if (isLocal) {
    return resolve(
      process.cwd(),
      "packages",
      "mcp",
      "dist",
      "index.js",
    );
  }
  return "sow-mcp";
}

function getMcpServerEntry(isLocal: boolean): Record<string, unknown> {
  if (isLocal) {
    return {
      command: "node",
      args: [getCommand(true)],
    };
  }
  return {
    command: "sow-mcp",
  };
}

export function getMcpConfig(
  agent: string,
  isLocal: boolean,
): { instructions: string; config: Record<string, unknown> } | null {
  const entry = getMcpServerEntry(isLocal);

  switch (agent) {
    case "claude-code":
      return {
        instructions:
          "Add this to your ~/.claude/settings.json (or claude_desktop_config.json):",
        config: {
          mcpServers: {
            sow: entry,
          },
        },
      };
    case "cursor":
      return {
        instructions:
          "Add this to .cursor/mcp.json in your project root:",
        config: {
          mcpServers: {
            sow: entry,
          },
        },
      };
    case "windsurf":
      return {
        instructions:
          "Add this to your ~/.windsurf/settings.json:",
        config: {
          mcpServers: {
            sow: entry,
          },
        },
      };
    case "codex":
      return {
        instructions:
          "Add this to your .codex/config.json:",
        config: {
          mcpServers: {
            sow: entry,
          },
        },
      };
    default:
      return null;
  }
}
