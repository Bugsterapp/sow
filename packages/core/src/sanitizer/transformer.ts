import { faker } from "@faker-js/faker";
import type { PIIType } from "../types.js";
import { deterministicSeed } from "./consistency.js";
import { BUILTIN_PII_RULES } from "./rules.js";

type TransformFn = (value: unknown) => unknown;

function withDeterministicSeed(value: unknown, fn: () => unknown): unknown {
  const str = String(value ?? "");
  const seed = deterministicSeed(str);
  faker.seed(seed);
  return fn();
}

/**
 * Given an object key, return the PIIType (if any) that its name matches
 * against the built-in column-name patterns. Reuses the exact patterns from
 * rules.ts so JSONB detection is consistent with column detection.
 */
function keyToPIIType(key: string): PIIType | null {
  for (const rule of BUILTIN_PII_RULES) {
    for (const p of rule.columnNamePatterns) {
      if (p.test(key)) return rule.type;
    }
  }
  return null;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeJsonValue(v));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const piiType = keyToPIIType(k);
      if (piiType && v !== null && v !== undefined && typeof v !== "object") {
        out[k] = transformValue(v, piiType);
      } else if (v !== null && typeof v === "object") {
        out[k] = sanitizeJsonValue(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return value;
}

const transformers: Record<PIIType, TransformFn> = {
  email: (value) =>
    withDeterministicSeed(value, () => faker.internet.email().toLowerCase()),

  phone: (value) =>
    withDeterministicSeed(value, () => faker.phone.number()),

  name: (value) =>
    withDeterministicSeed(value, () =>
      `${faker.person.firstName()} ${faker.person.lastName()}`,
    ),

  address: (value) =>
    withDeterministicSeed(value, () => faker.location.streetAddress(true)),

  ssn: (value) =>
    withDeterministicSeed(value, () => {
      const digits = faker.string.numeric(9);
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    }),

  credit_card: (value) =>
    withDeterministicSeed(value, () => faker.finance.creditCardNumber()),

  ip: (value) =>
    withDeterministicSeed(value, () => {
      const str = String(value ?? "");
      if (str.includes(":")) return faker.internet.ipv6();
      return faker.internet.ipv4();
    }),

  ip_address: (value) =>
    withDeterministicSeed(value, () => {
      const str = String(value ?? "");
      if (str.includes(":")) return faker.internet.ipv6();
      const cidrMatch = str.match(/\/(\d+)$/);
      const ip = faker.internet.ipv4();
      return cidrMatch ? `${ip}${cidrMatch[0]}` : ip;
    }),

  mac_address: (value) =>
    withDeterministicSeed(value, () => faker.internet.mac()),

  url: (value) =>
    withDeterministicSeed(value, () => faker.internet.url()),

  uuid: (value) =>
    withDeterministicSeed(value, () => faker.string.uuid()),

  date_of_birth: (value) => {
    if (value instanceof Date) {
      const seed = deterministicSeed(value.toISOString());
      faker.seed(seed);
      const offsetDays = faker.number.int({ min: -30, max: 30 });
      const newDate = new Date(value);
      newDate.setDate(newDate.getDate() + offsetDays);
      return newDate;
    }
    return withDeterministicSeed(value, () =>
      faker.date.birthdate({ min: 18, max: 80, mode: "age" }),
    );
  },

  password: (_value) => {
    // bcrypt hash of "password123" — all test accounts share this known password
    return "$2b$10$rQEY0tEMG9BqKmGEmwjKPOJGKmFuWZTjUtg5iCNKzlBQzdMYfHPvS";
  },

  free_text: (value) =>
    withDeterministicSeed(value, () => faker.lorem.paragraph()),

  jsonb: (value) => {
    // Accept already-parsed objects (many pg drivers hand jsonb back parsed)
    // OR a JSON string. If string is invalid, pass through unchanged.
    let parsed: unknown;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        // Invalid JSON — return as-is, caller may warn.
        return value;
      }
    } else {
      parsed = value;
    }
    const sanitized = sanitizeJsonValue(parsed);
    return JSON.stringify(sanitized);
  },

  xml_text: (value) =>
    withDeterministicSeed(value, () => `<root>${faker.lorem.paragraph()}</root>`),

  binary_blob: (value) => value,

  passthrough: (value) => value,

  custom: (value) => value,
};

export function getTransformer(type: PIIType): TransformFn {
  return transformers[type] || ((v) => v);
}

export function transformValue(value: unknown, type: PIIType): unknown {
  if (value == null) return null;
  return getTransformer(type)(value);
}

export function transformRows(
  rows: Record<string, unknown>[],
  columnTypes: Map<string, PIIType>,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const newRow = { ...row };
    for (const [column, type] of columnTypes) {
      if (column in newRow) {
        newRow[column] = transformValue(newRow[column], type);
      }
    }
    return newRow;
  });
}

/**
 * Async variant of transformRows. All transformations are local (Faker.js).
 * Kept async for backward compatibility.
 */
export async function transformRowsAsync(
  rows: Record<string, unknown>[],
  columnTypes: Map<string, PIIType>,
): Promise<Record<string, unknown>[]> {
  return transformRows(rows, columnTypes);
}
