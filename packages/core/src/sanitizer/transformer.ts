import { faker } from "@faker-js/faker";
import type { PIIType } from "../types.js";
import { deterministicSeed } from "./consistency.js";

type TransformFn = (value: unknown) => unknown;
type AsyncTransformFn = (value: unknown) => Promise<unknown>;

function withDeterministicSeed(value: unknown, fn: () => unknown): unknown {
  const str = String(value ?? "");
  const seed = deterministicSeed(str);
  faker.seed(seed);
  return fn();
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
      return faker.internet.ip();
    }),

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
