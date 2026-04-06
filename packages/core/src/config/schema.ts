import { z } from "zod";

const PIITypeEnum = z.enum([
  "email",
  "phone",
  "name",
  "address",
  "ssn",
  "credit_card",
  "ip",
  "url",
  "uuid",
  "date_of_birth",
  "password",
  "free_text",
  "custom",
]);

const ExportFormatEnum = z.enum(["sql", "docker", "sqlite", "json"]);

export const SowConfigSchema = z.object({
  version: z.number().default(1),

  source: z
    .object({
      connection: z.string(),
    })
    .optional(),

  sampling: z
    .object({
      maxRowsPerTable: z.number().min(1).max(10000).default(200),
      seed: z.number().default(42),
      excludeTables: z.array(z.string()).default([]),
      includeTables: z.array(z.string()).default([]),
      includeEdgeCases: z.boolean().default(true),
    })
    .optional(),

  sanitization: z
    .object({
      enabled: z.boolean().default(true),
      rules: z
        .array(
          z.object({
            table: z.string(),
            column: z.string(),
            type: PIITypeEnum,
          }),
        )
        .default([]),
      skipColumns: z.array(z.string()).default([]),
    })
    .optional(),

  export: z
    .object({
      format: ExportFormatEnum.default("sql"),
      outputPath: z.string().default("./sow-output"),
    })
    .optional(),
});

export type SowConfigInput = z.input<typeof SowConfigSchema>;
export type SowConfigParsed = z.output<typeof SowConfigSchema>;
