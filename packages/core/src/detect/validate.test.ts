import { isValidPostgresUrl, normalizePostgresUrl } from "./validate.js";

describe("isValidPostgresUrl", () => {
  it("accepts postgresql:// URLs", () => {
    expect(isValidPostgresUrl("postgresql://user:pass@localhost:5432/db")).toBe(true);
  });

  it("accepts postgres:// URLs", () => {
    expect(isValidPostgresUrl("postgres://user:pass@localhost:5432/db")).toBe(true);
  });

  it("accepts SQLAlchemy dialect URLs", () => {
    expect(isValidPostgresUrl("postgresql+asyncpg://user:pass@host/db")).toBe(true);
    expect(isValidPostgresUrl("postgresql+psycopg2://user:pass@host/db")).toBe(true);
  });

  it("accepts URLs without password", () => {
    expect(isValidPostgresUrl("postgresql://user@localhost:5432/db")).toBe(true);
  });

  it("accepts URLs with query params", () => {
    expect(isValidPostgresUrl("postgresql://user:pass@host/db?sslmode=require")).toBe(true);
  });

  it("accepts URLs with special characters in password", () => {
    expect(isValidPostgresUrl("postgresql://user:p%40ss%23word@host/db")).toBe(true);
  });

  it("rejects mysql:// URLs", () => {
    expect(isValidPostgresUrl("mysql://user:pass@localhost/db")).toBe(false);
  });

  it("rejects http:// URLs", () => {
    expect(isValidPostgresUrl("http://example.com")).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(isValidPostgresUrl("")).toBe(false);
  });

  it("rejects random strings", () => {
    expect(isValidPostgresUrl("not-a-url")).toBe(false);
    expect(isValidPostgresUrl("just some text")).toBe(false);
  });
});

describe("normalizePostgresUrl", () => {
  it("strips +asyncpg dialect suffix", () => {
    expect(normalizePostgresUrl("postgresql+asyncpg://user:pass@host/db"))
      .toBe("postgresql://user:pass@host/db");
  });

  it("strips +psycopg2 dialect suffix", () => {
    expect(normalizePostgresUrl("postgresql+psycopg2://user:pass@host/db"))
      .toBe("postgresql://user:pass@host/db");
  });

  it("strips dialect from short postgres:// form", () => {
    expect(normalizePostgresUrl("postgres+asyncpg://user@host/db"))
      .toBe("postgres://user@host/db");
  });

  it("leaves standard postgresql:// URLs unchanged", () => {
    const url = "postgresql://user:pass@host:5432/db";
    expect(normalizePostgresUrl(url)).toBe(url);
  });

  it("leaves standard postgres:// URLs unchanged", () => {
    const url = "postgres://user:pass@host/db";
    expect(normalizePostgresUrl(url)).toBe(url);
  });

  it("leaves non-postgres URLs unchanged", () => {
    const url = "mysql://user:pass@host/db";
    expect(normalizePostgresUrl(url)).toBe(url);
  });
});
