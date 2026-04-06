import { detectColumnPII, detectTablePII } from "./detector.js";

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
