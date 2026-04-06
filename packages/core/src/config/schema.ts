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

  /**
   * Per-provider opt-ins. These gate behavior that has blast radius
   * beyond a fresh Docker container — for example, the Supabase
   * provider's DROP of the target DB's `public` schema.
   */
  providers: z
    .object({
      supabase: z
        .object({
          /**
           * Grants the Supabase branch provider permission to DROP and
           * recreate the `public` schema of the project's local Supabase
           * Postgres. Without this opt-in (and without the CLI flag
           * `--yes-destructive-supabase`), sow falls back to the Docker
           * provider even when a local Supabase is reachable and this
           * project has a `supabase/config.toml`.
           *
           * Set this to true ONLY in projects where you intend your local
           * Supabase's public schema to BE the sandbox — i.e. you're
           * actively developing against Supabase locally and want the
           * Auth/RLS/Realtime integration that comes with it.
           *
           * Default: false.
           */
          destructive_consent: z.boolean().default(false),
        })
        .optional(),
    })
    .optional(),
});

export type SowConfigInput = z.input<typeof SowConfigSchema>;
export type SowConfigParsed = z.output<typeof SowConfigSchema>;
