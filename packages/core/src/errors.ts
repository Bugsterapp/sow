interface ConnectionContext {
  host: string;
  port: number;
  user: string;
  database: string;
}

export class ConnectionError extends Error {
  readonly hint: string;
  readonly code: string;
  readonly context: ConnectionContext;

  constructor(message: string, hint: string, code: string, context: ConnectionContext) {
    super(message);
    this.name = "ConnectionError";
    this.hint = hint;
    this.code = code;
    this.context = context;
  }
}

function parseContext(connectionString: string): ConnectionContext {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname || "localhost",
      port: parseInt(url.port || "5432", 10),
      user: url.username || "(none)",
      database: url.pathname.slice(1) || "postgres",
    };
  } catch {
    return { host: "unknown", port: 5432, user: "unknown", database: "unknown" };
  }
}

export function parseConnectionError(err: unknown, connectionString: string): ConnectionError {
  const ctx = parseContext(connectionString);
  const raw = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code ?? "";
  const addr = `${ctx.host}:${ctx.port}`;

  const roleMatch = raw.match(/role "([^"]+)" does not exist/);
  if (roleMatch) {
    return new ConnectionError(
      `Authentication failed: role "${roleMatch[1]}" does not exist on ${addr}`,
      `Check the username in your connection string. If using Docker, the default user is "postgres".\n    If another Postgres is running on this port, try a different one: lsof -i :${ctx.port}`,
      code || "ROLE_NOT_FOUND",
      ctx,
    );
  }

  if (raw.includes("password authentication failed")) {
    return new ConnectionError(
      `Wrong password for user "${ctx.user}" on ${addr}`,
      `Check the password in your connection string. For Docker containers, ensure it matches: -e POSTGRES_PASSWORD=<password>`,
      code || "AUTH_FAILED",
      ctx,
    );
  }

  const dbMatch = raw.match(/database "([^"]+)" does not exist/);
  if (dbMatch) {
    return new ConnectionError(
      `Database "${dbMatch[1]}" not found on ${addr}`,
      `List available databases: psql -h ${ctx.host} -p ${ctx.port} -U ${ctx.user} -l`,
      code || "DB_NOT_FOUND",
      ctx,
    );
  }

  if (code === "ECONNREFUSED" || raw.includes("ECONNREFUSED") || raw.includes("Connection refused")) {
    return new ConnectionError(
      `Connection refused at ${addr}`,
      `No Postgres is listening on this port. Start one with:\n    docker run -d -p ${ctx.port}:5432 postgres:16`,
      "ECONNREFUSED",
      ctx,
    );
  }

  if (code === "ENOTFOUND" || raw.includes("ENOTFOUND") || raw.includes("getaddrinfo")) {
    return new ConnectionError(
      `Host "${ctx.host}" not found`,
      `Check the hostname in your connection string`,
      "ENOTFOUND",
      ctx,
    );
  }

  if (raw.includes("timeout") || raw.includes("connect_timeout") || code === "CONNECT_TIMEOUT") {
    return new ConnectionError(
      `Connection timed out to ${addr}`,
      `The host is not responding. Check firewall rules or VPN settings`,
      code || "TIMEOUT",
      ctx,
    );
  }

  if (raw.toLowerCase().includes("ssl") || raw.includes("self-signed certificate") || raw.includes("self signed certificate")) {
    return new ConnectionError(
      `SSL connection failed to ${addr}`,
      `Try adding ?sslmode=disable to your connection string for local databases`,
      code || "SSL_ERROR",
      ctx,
    );
  }

  if (raw.includes("too many clients") || raw.includes("remaining connection slots")) {
    return new ConnectionError(
      `Too many connections to ${addr}`,
      `The database has reached its connection limit. Close unused connections or increase max_connections`,
      code || "TOO_MANY_CLIENTS",
      ctx,
    );
  }

  return new ConnectionError(
    `Connection failed to ${addr}: ${raw}`,
    `Run "sow doctor" to diagnose common issues`,
    code || "UNKNOWN",
    ctx,
  );
}
