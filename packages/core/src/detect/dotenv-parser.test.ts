import { parseDotenv } from "./dotenv-parser.js";

describe("parseDotenv", () => {
  it("parses simple KEY=value pairs", () => {
    expect(parseDotenv("FOO=bar\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("parses double-quoted values", () => {
    expect(parseDotenv('KEY="hello world"')).toEqual({ KEY: "hello world" });
  });

  it("parses single-quoted values", () => {
    expect(parseDotenv("KEY='hello world'")).toEqual({ KEY: "hello world" });
  });

  it("skips comment lines", () => {
    const input = "# this is a comment\nKEY=value\n# another comment";
    expect(parseDotenv(input)).toEqual({ KEY: "value" });
  });

  it("skips empty lines", () => {
    const input = "\n\nKEY=value\n\n";
    expect(parseDotenv(input)).toEqual({ KEY: "value" });
  });

  it("handles values containing = signs", () => {
    expect(parseDotenv("URL=postgres://user:p=ss@host/db")).toEqual({
      URL: "postgres://user:p=ss@host/db",
    });
  });

  it("strips inline comments from unquoted values", () => {
    expect(parseDotenv("KEY=value # inline comment")).toEqual({ KEY: "value" });
  });

  it("preserves # inside quoted values", () => {
    expect(parseDotenv('KEY="value # not a comment"')).toEqual({
      KEY: "value # not a comment",
    });
  });

  it("trims whitespace around keys and values", () => {
    expect(parseDotenv("  KEY  =  value  ")).toEqual({ KEY: "value" });
  });

  it("skips lines without = sign", () => {
    expect(parseDotenv("NO_EQUALS\nKEY=value")).toEqual({ KEY: "value" });
  });

  it("returns empty object for empty string", () => {
    expect(parseDotenv("")).toEqual({});
  });

  it("handles export prefix via trimming", () => {
    // export prefix stays in the key since parseDotenv doesn't strip it
    const result = parseDotenv("export KEY=value");
    expect(result["export KEY"]).toBe("value");
  });
});
