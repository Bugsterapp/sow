import type { PIIPattern } from "../types.js";

export const BUILTIN_PII_RULES: PIIPattern[] = [
  {
    type: "email",
    columnNamePatterns: [/email/i, /e_mail/i, /email_address/i],
    valuePatterns: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/],
    description: "Email addresses",
  },
  {
    type: "phone",
    columnNamePatterns: [/phone/i, /mobile/i, /cell/i, /tel(?:ephone)?/i, /fax/i],
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
      /^name$/i,
    ],
    valuePatterns: [],
    description: "Person names",
  },
  {
    type: "address",
    columnNamePatterns: [
      /^address/i,
      /^street/i,
      /^city$/i,
      /^state$/i,
      /^zip/i,
      /^postal/i,
    ],
    valuePatterns: [],
    description: "Physical addresses",
  },
  {
    type: "ssn",
    columnNamePatterns: [/ssn/i, /social_security/i, /tax_id/i, /^tin$/i],
    valuePatterns: [/^\d{3}-\d{2}-\d{4}$/, /^\d{2}-\d{7}$/],
    description: "Social Security / Tax ID numbers",
  },
  {
    type: "credit_card",
    columnNamePatterns: [/credit.?card/i, /card.?number/i, /cc.?num/i, /^pan$/i],
    valuePatterns: [
      /^\d{13,19}$/,
      /^\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}$/,
    ],
    description: "Credit card numbers",
  },
  {
    type: "ip",
    columnNamePatterns: [/ip.?addr/i, /^ip$/i, /ip_address/i, /remote_addr/i],
    valuePatterns: [
      /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
      /^[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){2,7}$/,
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
      /pass.?hash/i,
      /hashed_password/i,
      /^pwd$/i,
      /secret/i,
    ],
    valuePatterns: [],
    description: "Password fields",
  },
  {
    type: "date_of_birth",
    columnNamePatterns: [/dob/i, /birth.?date/i, /date_of_birth/i, /birthday/i],
    valuePatterns: [],
    description: "Date of birth",
  },
];
