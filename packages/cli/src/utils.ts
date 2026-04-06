import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function timeAgo(dateStr: string): string {
  if (!dateStr) return "unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins > 1 ? "s" : ""} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export function statusColor(status: string): string {
  switch (status) {
    case "running": return "green";
    case "stopped": return "yellow";
    case "creating": return "cyan";
    default: return "red";
  }
}

export function maskConnectionString(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return url.replace(/:([^@/]+)@/, ":***@");
  }
}

export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`  ${message} (Y/n) `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === "" || trimmed === "y" || trimmed === "yes");
    });
  });
}

export function selectFromList<T>(
  items: T[],
  formatItem: (item: T, selected: boolean) => string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (items.length === 0) return reject(new Error("No items to select"));
    if (items.length === 1) return resolve(items[0]);

    let index = 0;
    const totalLines = items.length + 1; // items + hint line
    const cols = process.stderr.columns || 80;

    function truncate(str: string, max: number): string {
      return str.length > max ? str.slice(0, max - 1) + "…" : str;
    }

    function render() {
      if (rendered) {
        process.stderr.write(`\x1b[${totalLines}A`);
      }
      for (let i = 0; i < items.length; i++) {
        const line = formatItem(items[i], i === index);
        process.stderr.write(`\x1b[2K  ${truncate(line, cols - 4)}\n`);
      }
      process.stderr.write(`\x1b[2K  \x1b[2m↑↓ select  ↵ confirm  q cancel\x1b[0m\n`);
      rendered = true;
    }

    let rendered = false;
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    function cleanup() {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    }

    function onData(key: string) {
      if (key === "\x1b[A" || key === "k") {
        index = (index - 1 + items.length) % items.length;
        render();
      } else if (key === "\x1b[B" || key === "j") {
        index = (index + 1) % items.length;
        render();
      } else if (key === "\r" || key === "\n") {
        cleanup();
        resolve(items[index]);
      } else if (key === "q" || key === "\x1b" || key === "\x03") {
        cleanup();
        process.exit(0);
      }
    }

    stdin.on("data", onData);
    render();
  });
}

export function promptInput(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`  ${message} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function appendToEnvFile(
  projectRoot: string,
  key: string,
  value: string,
): void {
  const envPath = join(projectRoot, ".env");

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    const lines = content.split("\n");
    const existingIndex = lines.findIndex((l) =>
      l.startsWith(`${key}=`) || l.startsWith(`${key} =`),
    );

    if (existingIndex !== -1) {
      lines[existingIndex] = `${key}=${value}`;
      writeFileSync(envPath, lines.join("\n"), "utf-8");
      return;
    }

    const separator = content.endsWith("\n") ? "" : "\n";
    writeFileSync(envPath, content + separator + `${key}=${value}\n`, "utf-8");
  } else {
    writeFileSync(envPath, `${key}=${value}\n`, "utf-8");
  }
}

export function getErrorHint(error: string): string | null {
  const lower = error.toLowerCase();

  if (lower.includes("docker") && (lower.includes("not running") || lower.includes("cannot connect") || lower.includes("is the docker daemon running"))) {
    return "Docker is not running. Start Docker Desktop or the Docker daemon and try again.";
  }
  if (lower.includes("econnrefused") || lower.includes("connection refused")) {
    return "Connection refused. Check that the database is running and the connection string is correct.\nExample: postgresql://user:pass@host:5432/dbname";
  }
  if (lower.includes("password authentication failed")) {
    return "Authentication failed. Double-check the username and password in your connection string.";
  }
  if (lower.includes("eaddrinuse") || lower.includes("address already in use") || lower.includes("port")) {
    if (lower.includes("port")) {
      return "Port is already in use. Try specifying a different port with --port.";
    }
  }
  if (lower.includes("no connectors") || lower.includes("connector not found") || lower.includes("no connector")) {
    return "No connectors found. Run `sow connect <url>` to create one first.";
  }
  if (lower.includes("branch") && lower.includes("not found")) {
    return "Branch not found. Run `sow branch list` to see available branches.";
  }
  if (lower.includes("container") && lower.includes("already exists")) {
    return "A container with this name already exists. Use the existing branch or delete it first.";
  }
  return null;
}
