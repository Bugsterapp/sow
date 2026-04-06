# Sanitization

sow's job is to give your coding agent a database that *looks like prod* but contains *zero real PII*. This document explains exactly what sow scrubs, what it doesn't, and how to add custom rules.

## What gets sanitized automatically

sow runs every column through two detectors before sampling:

1. **Type-based detection.** Some Postgres types are inherently sensitive: `inet`, `cidr`, `macaddr`, `macaddr8`. sow has built-in transformers for each.
2. **Name-based detection.** Column names are matched against patterns for these PII categories:

| Category | Example column names | Transformer |
|---|---|---|
| Email | `email`, `email_address`, `user_email` | Faker `internet.email()` |
| Phone | `phone`, `phone_number`, `mobile`, `cell` | Faker `phone.number()` |
| Name | `first_name`, `last_name`, `full_name`, `name` | Faker `person.firstName/lastName` |
| Address | `address`, `street`, `street_address` | Faker `location.streetAddress()` |
| SSN | `ssn`, `social_security_number` | Faker formatted SSN |
| Credit card | `credit_card`, `card_number`, `cc_number` | Faker `finance.creditCardNumber()` |
| IP address | `ip`, `ip_address` | Faker IPv4 or IPv6 |
| MAC address | `mac`, `mac_address` | Faker `internet.mac()` |
| URL | `url`, `website` | Faker `internet.url()` |
| UUID | `id`, `*_id` (when type is `uuid`) | Faker `string.uuid()` |
| Date of birth | `dob`, `date_of_birth`, `birthday` | Faker `date.birthdate()` ±30 days |
| Password hash | `password`, `password_hash`, `encrypted_password` | bcrypt hash of `password123` |
| Free text | `bio`, `description`, `notes` (when no other rule applies) | Faker `lorem.paragraph()` |

Every transformer is **deterministic**: the same input value always produces the same fake output. This means foreign keys stay consistent across tables — if `users.email = "alice@corp.com"` is referenced by `audit_log.actor_email`, both get the same Faker replacement.

## JSONB columns

JSONB is the most common PII leak vector in modern Postgres schemas. A `profiles.metadata::jsonb` column might contain:

```json
{
  "email": "alice@corp.com",
  "phone": "+1-555-0100",
  "preferences": { "theme": "dark", "newsletter": true },
  "contact": { "billing_email": "alice@corp.com" }
}
```

sow walks the JSONB structure recursively and replaces values whose **key** matches a PII pattern. The example above becomes:

```json
{
  "email": "<faker email>",
  "phone": "<faker phone>",
  "preferences": { "theme": "dark", "newsletter": true },
  "contact": { "billing_email": "<faker email>" }
}
```

Scalar JSONB (a bare string, number, or null) is passed through. Arrays of objects are walked element-by-element. Invalid JSON passes through unchanged with a warning.

## The fail-closed gate

sow refuses to sanitize a column whose Postgres type it doesn't have an explicit handler for. If your schema has:

- A `tsvector` column (full-text search)
- A custom enum type
- An `hstore` column
- A `pg_lsn` or other system type

...sow will abort `sow connect` with a clear error:

```
Sanitization aborted — 2 columns have types sow cannot verify:
  - audit.tags (tsvector) — no tsvector handler configured
  - users.role (user_role)  — custom enum type

These columns would be copied to the sandbox AS-IS, potentially leaking
PII that exists in them. Pass --allow-unsafe to skip sanitization of
these columns (they will be NULLed out in the branch).

To add explicit handling, edit .sow.yml:
  sanitize:
    rules:
      - table: audit
        column: tags
        type: free_text
```

This is the **fail-closed default** — anxiety reduction is the whole pitch, and silently passing unknown types through would break it.

## The `--allow-unsafe` escape hatch

When you know what you're doing and want to proceed anyway:

```bash
sow connect --allow-unsafe postgres://...
sow sandbox --allow-unsafe
```

With this flag, columns of unknown types are **NULLed out** in the sandbox (not passed through!). The user is saying "I know there may be gaps; strip those columns to NULL rather than leaking them." A warning summary is printed and surfaces in `sow doctor <connector>`.

## Custom rules

You can override or extend the built-in detection with a `.sow.yml` file in your project root:

```yaml
sanitize:
  enabled: true
  rules:
    # Sanitize a column the auto-detector missed
    - table: audit
      column: actor_email
      type: email

    # Use a custom transformer for a custom enum
    - table: users
      column: role
      type: passthrough  # don't touch — this is fine to copy as-is

    # Treat a tsvector column as free-text
    - table: posts
      column: search_index
      type: free_text

  # Skip these columns entirely (they will appear in the sandbox unchanged)
  skip_columns:
    - users.created_at
    - users.id
```

## Inspecting what was sanitized

After `sow connect`, sow records every PII column it detected and every rule it applied in `~/.sow/snapshots/<connector>/metadata.json`. To see them:

```bash
sow doctor <connector>
```

Output includes:
- Column count, row count, snapshot size
- PII columns detected (with the type sow assigned to each)
- Any sanitization warnings (e.g. JSONB columns that failed to parse)
- Any referential integrity warnings from the sampler (FK relationships that couldn't be fully resolved)

## What sow does NOT do

These are out-of-scope by design:

- **Free-text PII detection.** sow does NOT scan a free-text field for embedded emails, phone numbers, or names. The whole field is replaced with Lorem Ipsum if it matches the `free_text` pattern. This is a known limitation — see the design doc TODO.
- **Schema-level auditing.** sow doesn't tell you "your schema is leaking PII" or grade your data classification. It scrubs what it sees.
- **Encryption.** Sanitization is replacement, not encryption. The sandbox is plaintext by design (your local agent needs to read it).
- **Cloud relay.** sow runs 100% locally. PII never leaves your laptop. There is no "send to sow Cloud for processing" path.

## Read-only on the source

sow's source database access is **strictly read-only in intent and effect**:

- All SQL is parameterized via `$1, $2, ...` placeholders. No string interpolation.
- All identifiers (table and column names) are quoted via the SQL standard escape (`quoteIdent`).
- The connector code path was security-audited by both Claude and Codex adversarial review (see the v0.1.14 security fix in the changelog).
- sow never issues `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, or any DDL against the source database.

If you point sow at a database with read-only credentials, it will still work. We recommend it.
</content>
