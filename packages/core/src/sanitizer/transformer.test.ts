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

describe("jsonb transformation", () => {
  it("replaces an email field inside a simple object", () => {
    const input = JSON.stringify({ email: "alice@example.com", role: "admin" });
    const out = transformValue(input, "jsonb") as string;
    const parsed = JSON.parse(out);
    expect(parsed.role).toBe("admin");
    expect(parsed.email).not.toBe("alice@example.com");
    expect(parsed.email).toContain("@");
  });

  it("recurses into nested objects", () => {
    const input = JSON.stringify({
      user: { contact: { email: "deep@example.com" }, id: 42 },
    });
    const out = transformValue(input, "jsonb") as string;
    const parsed = JSON.parse(out);
    expect(parsed.user.id).toBe(42);
    expect(parsed.user.contact.email).not.toBe("deep@example.com");
    expect(parsed.user.contact.email).toContain("@");
  });

  it("walks arrays of objects", () => {
    const input = JSON.stringify([
      { email: "a@a.com", age: 1 },
      { email: "b@b.com", age: 2 },
    ]);
    const out = transformValue(input, "jsonb") as string;
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].age).toBe(1);
    expect(parsed[1].age).toBe(2);
    expect(parsed[0].email).not.toBe("a@a.com");
    expect(parsed[1].email).not.toBe("b@b.com");
    expect(parsed[0].email).toContain("@");
  });

  it("passes scalar JSONB values through (bare string, number, null)", () => {
    expect(transformValue(JSON.stringify("hello"), "jsonb")).toBe('"hello"');
    expect(transformValue(JSON.stringify(42), "jsonb")).toBe("42");
    // null at the top level bypasses the transformer entirely
    expect(transformValue(null, "jsonb")).toBeNull();
  });

  it("returns invalid JSON unchanged without throwing", () => {
    const bogus = "{ not valid json";
    expect(() => transformValue(bogus, "jsonb")).not.toThrow();
    expect(transformValue(bogus, "jsonb")).toBe(bogus);
  });

  it("preserves non-PII fields and only replaces PII-keyed values", () => {
    const input = JSON.stringify({
      role: "admin",
      created_at: "2024-01-01",
      email: "x@y.com",
    });
    const out = transformValue(input, "jsonb") as string;
    const parsed = JSON.parse(out);
    expect(parsed.role).toBe("admin");
    expect(parsed.created_at).toBe("2024-01-01");
    expect(parsed.email).not.toBe("x@y.com");
  });

  it("accepts already-parsed object (not a string)", () => {
    const out = transformValue(
      { phone: "+1-555-0000", id: 99 },
      "jsonb",
    ) as string;
    const parsed = JSON.parse(out);
    expect(parsed.id).toBe(99);
    expect(parsed.phone).not.toBe("+1-555-0000");
  });
});

describe("new Postgres type transformers", () => {
  it("mac_address returns a mac-like string", () => {
    const out = transformValue("aa:bb:cc:dd:ee:ff", "mac_address") as string;
    expect(typeof out).toBe("string");
    expect(out).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i);
    expect(out).not.toBe("aa:bb:cc:dd:ee:ff");
  });

  it("ip_address preserves CIDR suffix when present", () => {
    const out = transformValue("10.0.0.1/24", "ip_address") as string;
    expect(out).toMatch(/\/24$/);
  });

  it("ip_address produces an IPv4 for a v4 input", () => {
    const out = transformValue("10.0.0.1", "ip_address") as string;
    expect(out).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it("xml_text returns a root-wrapped lorem paragraph", () => {
    const out = transformValue("<secret>hi</secret>", "xml_text") as string;
    expect(out.startsWith("<root>")).toBe(true);
    expect(out.endsWith("</root>")).toBe(true);
    expect(out).not.toContain("secret");
  });

  it("binary_blob passes through unchanged", () => {
    const buf = Buffer.from([1, 2, 3, 4]);
    expect(transformValue(buf, "binary_blob")).toBe(buf);
  });

  it("passthrough type returns value unchanged", () => {
    expect(transformValue("USD 100.00", "passthrough")).toBe("USD 100.00");
    expect(transformValue("[1,5)", "passthrough")).toBe("[1,5)");
  });

  it("mac_address is deterministic for the same input", () => {
    const a = transformValue("aa:bb:cc:dd:ee:ff", "mac_address");
    const b = transformValue("aa:bb:cc:dd:ee:ff", "mac_address");
    expect(a).toBe(b);
  });
});
