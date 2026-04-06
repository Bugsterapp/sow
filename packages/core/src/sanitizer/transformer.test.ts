import { transformValue, getTransformer, transformRows } from "./transformer.js";

describe("transformValue", () => {
  it("returns null for null input", () => {
    expect(transformValue(null, "email")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(transformValue(undefined, "email")).toBeNull();
  });

  describe("email transformation", () => {
    it("produces a string containing @", () => {
      const result = transformValue("alice@example.com", "email") as string;
      expect(result).toContain("@");
    });

    it("is deterministic", () => {
      const a = transformValue("alice@example.com", "email");
      const b = transformValue("alice@example.com", "email");
      expect(a).toBe(b);
    });

    it("produces different output for different inputs", () => {
      const a = transformValue("alice@example.com", "email");
      const b = transformValue("bob@example.com", "email");
      expect(a).not.toBe(b);
    });
  });

  describe("phone transformation", () => {
    it("produces a string", () => {
      const result = transformValue("+1-555-1234", "phone");
      expect(typeof result).toBe("string");
    });

    it("is deterministic", () => {
      const a = transformValue("+1-555-1234", "phone");
      const b = transformValue("+1-555-1234", "phone");
      expect(a).toBe(b);
    });
  });

  describe("name transformation", () => {
    it("produces a string with a space (first + last)", () => {
      const result = transformValue("John Doe", "name") as string;
      expect(typeof result).toBe("string");
      expect(result).toContain(" ");
    });

    it("is deterministic", () => {
      const a = transformValue("John Doe", "name");
      const b = transformValue("John Doe", "name");
      expect(a).toBe(b);
    });

    it("produces different output for different inputs", () => {
      const a = transformValue("John Doe", "name");
      const b = transformValue("Jane Smith", "name");
      expect(a).not.toBe(b);
    });
  });

  describe("password transformation", () => {
    it("returns a bcrypt-like hash", () => {
      const result = transformValue("secret123", "password") as string;
      expect(result).toMatch(/^\$2b\$/);
    });
  });

  describe("custom type", () => {
    it("returns the original value", () => {
      expect(transformValue("anything", "custom")).toBe("anything");
    });
  });
});

describe("getTransformer", () => {
  it("returns a function for known types", () => {
    expect(typeof getTransformer("email")).toBe("function");
    expect(typeof getTransformer("phone")).toBe("function");
    expect(typeof getTransformer("name")).toBe("function");
  });
});

describe("transformRows", () => {
  it("transforms specified columns and leaves others untouched", () => {
    const rows = [
      { id: 1, email: "alice@example.com", status: "active" },
      { id: 2, email: "bob@example.com", status: "inactive" },
    ];
    const columnTypes = new Map([["email", "email" as const]]);

    const result = transformRows(rows, columnTypes);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[0].status).toBe("active");
    expect(result[0].email).not.toBe("alice@example.com");
    expect((result[0].email as string)).toContain("@");
  });

  it("does not mutate original rows", () => {
    const rows = [{ email: "test@test.com" }];
    const columnTypes = new Map([["email", "email" as const]]);

    transformRows(rows, columnTypes);

    expect(rows[0].email).toBe("test@test.com");
  });
});
