import {
  detectColumnPII,
  detectTablePII,
  classifyPgType,
  stripArraySuffix,
  pgTypeToPIIType,
} from "./detector.js";

describe("detectColumnPII", () => {
  describe("email detection", () => {
    it("detects column named 'email'", () => {
      const result = detectColumnPII("email", "text", []);
      expect(result.isPII).toBe(true);
      expect(result.type).toBe("email");
      expect(result.confidence).toBe("high");
      expect(result.matchedBy).toBe("column_name");
    });

    it("detects column named 'email_address'", () => {
      const result = detectColumnPII("email_address", "varchar", []);
      expect(result.isPII).toBe(true);
      expect(result.type).toBe("email");
    });

    it("detects email values by pattern", () => {
      const values = ["alice@example.com", "bob@test.org", "carol@foo.net"];
      const result = detectColumnPII("contact_info", "text", values);
      expect(result.isPII).toBe(true);
      expect(result.type).toBe("email");
      expect(result.matchedBy).toBe("value_pattern");
    });
  });

  describe("phone detection", () => {
    it("detects column named 'phone'", () => {
      const result = detectColumnPII("phone", "text", []);
      expect(result.isPII).toBe(true);
      expect(result.type).toBe("phone");
    });

    it("detects column named 'mobile'", () => {
      const result = detectColumnPII("mobile", "varchar", []);
      expect(result.isPII).toBe(true);
      expect(result.type).toBe("phone");
    });
  });

  describe("name detection", () => {
    it("detects 'first_name'", () => {
      const result = detectColumnPII("first_name", "text", []);
      expect(result.isPII).toBe(true);
      expect(result.type).toBe("name");
    });

    it("detects 'lastname'", () => {
      const result = detectColumnPII("lastname", "varchar", []);
      expect(result.isPII).toBe(true);
      expect(result.type).toBe("name");
    });

    it("detects 'name'", () => {
      const result = detectColumnPII("name", "text", []);
      expect(result.isPII).toBe(true);
      expect(result.type).toBe("name");
    });
  });

  describe("non-PII columns", () => {
    it("does not flag 'id'", () => {
      const result = detectColumnPII("id", "integer", [1, 2, 3]);
      expect(result.isPII).toBe(false);
    });

    it("does not flag 'created_at'", () => {
      const result = detectColumnPII("created_at", "timestamp", []);
      expect(result.isPII).toBe(false);
    });

    it("does not flag 'status'", () => {
      const result = detectColumnPII("status", "text", ["active", "inactive"]);
      expect(result.isPII).toBe(false);
    });

    it("skips value pattern matching for numeric types", () => {
      const result = detectColumnPII("some_col", "integer", [123, 456]);
      expect(result.isPII).toBe(false);
      expect(result.confidence).toBe("high");
    });
  });

  describe("value pattern matching edge cases", () => {
    it("does not flag when less than half of values match", () => {
      const values = ["alice@example.com", "not-an-email", "also-not", "nope"];
      const result = detectColumnPII("misc", "text", values);
      expect(result.isPII).toBe(false);
    });

    it("handles null values gracefully", () => {
      const result = detectColumnPII("misc", "text", [null, undefined, ""]);
      expect(result.isPII).toBe(false);
    });
  });
});

describe("detectTablePII", () => {
  it("detects PII columns in a table", () => {
    const table = {
      name: "users",
      schema: "public",
      columns: [
        { name: "id", type: "integer", nullable: false, defaultValue: null, maxLength: null, isGenerated: false },
        { name: "email", type: "text", nullable: false, defaultValue: null, maxLength: null, isGenerated: false },
        { name: "name", type: "text", nullable: true, defaultValue: null, maxLength: null, isGenerated: false },
      ],
      primaryKey: ["id"],
      constraints: [],
    };
    const rows = [
      { id: 1, email: "a@b.com", name: "Alice" },
      { id: 2, email: "c@d.com", name: "Bob" },
    ];

    const results = detectTablePII(table, rows);
    const types = results.map((r) => r.type);
    expect(types).toContain("email");
    expect(types).toContain("name");
    expect(results.every((r) => r.table === "users")).toBe(true);
  });
});

describe("Postgres type classification", () => {
  it("classifies known numeric/date/bool as safe", () => {
    expect(classifyPgType("int4")).toBe("safe");
    expect(classifyPgType("bigint")).toBe("safe");
    expect(classifyPgType("timestamp")).toBe("safe");
    expect(classifyPgType("boolean")).toBe("safe");
    expect(classifyPgType("uuid")).toBe("safe");
    expect(classifyPgType("money")).toBe("safe");
    expect(classifyPgType("interval")).toBe("safe");
    expect(classifyPgType("int4range")).toBe("safe");
    expect(classifyPgType("bytea")).toBe("safe");
  });

  it("classifies text-like types as handled", () => {
    expect(classifyPgType("text")).toBe("handled");
    expect(classifyPgType("varchar")).toBe("handled");
    expect(classifyPgType("citext")).toBe("handled");
  });

  it("classifies jsonb/inet/macaddr/xml as handled", () => {
    expect(classifyPgType("jsonb")).toBe("handled");
    expect(classifyPgType("json")).toBe("handled");
    expect(classifyPgType("inet")).toBe("handled");
    expect(classifyPgType("cidr")).toBe("handled");
    expect(classifyPgType("macaddr")).toBe("handled");
    expect(classifyPgType("xml")).toBe("handled");
  });

  it("classifies pg_lsn / hstore / tsvector as unknown", () => {
    expect(classifyPgType("pg_lsn")).toBe("unknown");
    expect(classifyPgType("hstore")).toBe("unknown");
    expect(classifyPgType("tsvector")).toBe("unknown");
  });

  it("treats custom enum types as safe when provided in the enum set", () => {
    const enums = new Set(["user_role"]);
    expect(classifyPgType("user_role", enums)).toBe("safe");
    expect(classifyPgType("user_role")).toBe("unknown");
  });

  it("strips array suffix and classifies via base type", () => {
    expect(stripArraySuffix("text[]")).toEqual({ baseType: "text", isArray: true });
    expect(stripArraySuffix("_int4")).toEqual({ baseType: "int4", isArray: true });
    expect(stripArraySuffix("text")).toEqual({ baseType: "text", isArray: false });
    expect(classifyPgType("text[]")).toBe("handled");
    expect(classifyPgType("int4[]")).toBe("safe");
  });

  it("maps jsonb/inet/xml/bytea/macaddr to an intrinsic PIIType", () => {
    expect(pgTypeToPIIType("jsonb")).toBe("jsonb");
    expect(pgTypeToPIIType("inet")).toBe("ip_address");
    expect(pgTypeToPIIType("cidr")).toBe("ip_address");
    expect(pgTypeToPIIType("macaddr")).toBe("mac_address");
    expect(pgTypeToPIIType("xml")).toBe("xml_text");
    expect(pgTypeToPIIType("bytea")).toBe("binary_blob");
    expect(pgTypeToPIIType("text")).toBeNull();
  });

  it("detects a jsonb column as PII by type alone", () => {
    const result = detectColumnPII("metadata", "jsonb", []);
    expect(result.isPII).toBe(true);
    expect(result.type).toBe("jsonb");
  });

  it("detects an inet column as ip_address by type alone", () => {
    const result = detectColumnPII("last_seen_from", "inet", []);
    expect(result.isPII).toBe(true);
    expect(result.type).toBe("ip_address");
  });
});
