import type {
  DatabaseAdapter,
  PIIPattern,
  PIIType,
  DataTypePattern,
  PIIColumnInfo,
  TableInfo,
} from "../types.js";

const BUILTIN_PATTERNS: PIIPattern[] = [
  {
    type: "email",
    columnNamePatterns: [/email/i, /e_mail/i, /email_address/i],
    valuePatterns: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/],
    description: "Email addresses",
  },
  {
    type: "phone",
    columnNamePatterns: [/phone/i, /mobile/i, /cell/i, /tel/i, /fax/i],
    valuePatterns: [/^[\+]?[\d\s\-\(\)]{7,20}$/],
    description: "Phone numbers",
  },
  {
    type: "name",
    columnNamePatterns: [
      /^first_?name$/i,
      /^last_?name$/i,
      /^full_?name$/i,
      /^display_?name$/i,
      /^user_?name$/i,
      /^name$/i,
    ],
    valuePatterns: [],
    description: "Person names",
  },
  {
    type: "address",
    columnNamePatterns: [
      /address/i,
      /street/i,
      /^city$/i,
      /^state$/i,
      /^zip/i,
      /postal/i,
      /country/i,
    ],
    valuePatterns: [],
    description: "Physical addresses",
  },
  {
    type: "ssn",
    columnNamePatterns: [/ssn/i, /social_security/i, /tax_id/i, /tin/i],
    valuePatterns: [/^\d{3}-?\d{2}-?\d{4}$/, /^\d{2}-?\d{7}$/],
    description: "Social Security / Tax ID numbers",
  },
  {
    type: "credit_card",
    columnNamePatterns: [/credit_card/i, /card_number/i, /cc_num/i, /pan/i],
    valuePatterns: [/^\d{13,19}$/, /^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}$/],
    description: "Credit card numbers",
  },
  {
    type: "ip",
    columnNamePatterns: [/ip_?addr/i, /^ip$/i, /ip_address/i, /remote_addr/i],
    valuePatterns: [
      /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
      /^[0-9a-fA-F:]{2,39}$/,
    ],
    description: "IP addresses",
  },
  {
    type: "url",
    columnNamePatterns: [/^url$/i, /website/i, /homepage/i, /^link$/i],
    valuePatterns: [/^https?:\/\/.+/i],
    description: "URLs",
  },
  {
    type: "password",
    columnNamePatterns: [
      /password/i,
      /passwd/i,
      /pass_?hash/i,
      /hashed_password/i,
      /pwd/i,
    ],
    valuePatterns: [],
    description: "Password fields",
  },
  {
    type: "date_of_birth",
    columnNamePatterns: [/dob/i, /birth_?date/i, /date_of_birth/i, /birthday/i],
    valuePatterns: [],
    description: "Date of birth",
  },
];

function matchColumnName(
  columnName: string,
  patterns: RegExp[],
): boolean {
  return patterns.some((p) => p.test(columnName));
}

function matchValues(
  values: unknown[],
  patterns: RegExp[],
): { matched: number; total: number } {
  if (patterns.length === 0) return { matched: 0, total: 0 };

  let matched = 0;
  let total = 0;

  for (const val of values) {
    if (val == null) continue;
    const str = String(val);
    if (!str) continue;
    total++;
    if (patterns.some((p) => p.test(str))) {
      matched++;
    }
  }

  return { matched, total };
}

export async function detectPatterns(
  adapter: DatabaseAdapter,
  tables: TableInfo[],
  sampleSize = 20,
): Promise<{ piiColumns: PIIColumnInfo[]; dataTypes: DataTypePattern[] }> {
  const piiColumns: PIIColumnInfo[] = [];
  const dataTypes: DataTypePattern[] = [];

  for (const table of tables) {
    let sampleRows: Record<string, unknown>[] = [];
    try {
      sampleRows = await adapter.getSampleRows(table.name, sampleSize);
    } catch {
      continue;
    }

    for (const col of table.columns) {
      // Layer 1: column name heuristics
      for (const pattern of BUILTIN_PATTERNS) {
        if (matchColumnName(col.name, pattern.columnNamePatterns)) {
          piiColumns.push({
            table: table.name,
            column: col.name,
            type: pattern.type,
            confidence: "high",
            matchedBy: "column_name",
          });
          dataTypes.push({
            table: table.name,
            column: col.name,
            detectedType: pattern.type,
            confidence: "high",
            sampleSize: sampleRows.length,
          });
          break;
        }
      }

      // Skip if already matched by name
      if (piiColumns.some((p) => p.table === table.name && p.column === col.name))
        continue;

      // Layer 2: value pattern matching
      const values = sampleRows.map((r) => r[col.name]);
      for (const pattern of BUILTIN_PATTERNS) {
        if (pattern.valuePatterns.length === 0) continue;

        const { matched, total } = matchValues(values, pattern.valuePatterns);
        if (total > 0 && matched / total > 0.5) {
          piiColumns.push({
            table: table.name,
            column: col.name,
            type: pattern.type,
            confidence: matched / total > 0.8 ? "medium" : "low",
            matchedBy: "value_pattern",
          });
          dataTypes.push({
            table: table.name,
            column: col.name,
            detectedType: pattern.type,
            confidence: matched / total > 0.8 ? "medium" : "low",
            sampleSize: total,
          });
          break;
        }
      }
    }
  }

  return { piiColumns, dataTypes };
}

export function getBuiltinPatterns(): PIIPattern[] {
  return BUILTIN_PATTERNS;
}
