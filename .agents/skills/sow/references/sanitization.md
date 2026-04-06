# PII Sanitization

## Overview

sow detects and replaces personally identifiable information (PII) in sampled data. Detection uses a two-pass approach: column name matching and value pattern matching. Replacement uses Faker.js with deterministic seeding so the same input always produces the same output.

## Detected PII Types

### email

**Column name patterns**: `/email/i`, `/e_mail/i`, `/email_address/i`
**Value patterns**: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
**Replacement**: `faker.internet.email()`

### phone

**Column name patterns**: `/phone/i`, `/mobile/i`, `/cell/i`, `/tel(?:ephone)?/i`, `/fax/i`
**Value patterns**: `/^[\+]?[\d\s\-\(\)]{7,20}$/`
**Replacement**: `faker.phone.number()`

### name

**Column name patterns**: `/^first_?name$/i`, `/^last_?name$/i`, `/^full_?name$/i`, `/^display_?name$/i`, `/^name$/i`
**Value patterns**: none (column name only)
**Replacement**: `faker.person.firstName()` / `faker.person.lastName()` / `faker.person.fullName()`

### address

**Column name patterns**: `/^address/i`, `/^street/i`, `/^city$/i`, `/^state$/i`, `/^zip/i`, `/^postal/i`
**Value patterns**: none (column name only)
**Replacement**: `faker.location.streetAddress()` / `faker.location.city()` / etc.

### ssn

**Column name patterns**: `/ssn/i`, `/social_security/i`, `/tax_id/i`, `/^tin$/i`
**Value patterns**: `/^\d{3}-\d{2}-\d{4}$/`, `/^\d{2}-\d{7}$/`
**Replacement**: `faker.string.numeric()` in matching format

### credit_card

**Column name patterns**: `/credit.?card/i`, `/card.?number/i`, `/cc.?num/i`, `/^pan$/i`
**Value patterns**: `/^\d{13,19}$/`, `/^\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}$/`
**Replacement**: `faker.finance.creditCardNumber()`

### ip

**Column name patterns**: `/ip.?addr/i`, `/^ip$/i`, `/ip_address/i`, `/remote_addr/i`
**Value patterns**: `/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/` (IPv4), `/^[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){2,7}$/` (IPv6)
**Replacement**: `faker.internet.ipv4()`

### url

**Column name patterns**: `/^url$/i`, `/website/i`, `/homepage/i`, `/^link$/i`
**Value patterns**: `/^https?:\/\/.+/i`
**Replacement**: `faker.internet.url()`

### password

**Column name patterns**: `/password/i`, `/passwd/i`, `/pass.?hash/i`, `/hashed_password/i`, `/^pwd$/i`, `/secret/i`
**Value patterns**: none (column name only)
**Replacement**: `faker.internet.password()`

### date_of_birth

**Column name patterns**: `/dob/i`, `/birth.?date/i`, `/date_of_birth/i`, `/birthday/i`
**Value patterns**: none (column name only)
**Replacement**: `faker.date.birthdate()`

## Detection Logic

1. **Column name check** (high confidence): If the column name matches any pattern for a PII type, it's flagged immediately.
2. **Value pattern check** (medium confidence): If column name didn't match, sample values are checked against value patterns. A threshold of matches triggers detection.

Both checks run for every column. Column name matching takes priority.

## Deterministic Replacement

sow uses a deterministic seeding strategy:

1. A global seed (default: 42, configurable via `--seed`)
2. For each value, a combined seed is computed from: `global_seed + table_name + column_name + original_value`
3. This means: **same input value in the same column always produces the same fake output**

This is important for:
- **Referential integrity**: If `user@example.com` appears in both `users.email` and `orders.customer_email`, both get the same replacement
- **Reproducibility**: Running sow twice with the same seed produces identical output
- **Testing stability**: Test assertions can rely on stable fake data

## Custom Rules in .sow.yml

Override or extend detection with explicit rules:

```yaml
sanitization:
  enabled: true
  rules:
    - table: users
      column: nickname
      type: name
    - table: logs
      column: request_body
      type: free_text
  skipColumns:
    - users.avatar_url
    - products.sku
```

### Rule fields

| Field | Description |
|-------|-------------|
| `table` | Table name |
| `column` | Column name |
| `type` | PII type (email, phone, name, address, ssn, credit_card, ip, url, password, date_of_birth, free_text, custom) |

### Skipping columns

Add columns to `skipColumns` to prevent sanitization. Use `table.column` format.

## Free-Text Fields

Columns typed as `free_text` (e.g., bio, description, notes) receive full-text replacement. The entire value is replaced with `faker.lorem.paragraph()` of similar length.

Embedded PII in free-text fields (e.g., "Contact me at john@example.com") is handled by replacing the entire field content, not by selectively replacing the email within the text.

## Disabling Sanitization

- **Per-run**: `--no-sanitize` flag
- **Per-project**: Set `sanitization.enabled: false` in `.sow.yml`
- **Per-column**: Add to `sanitization.skipColumns` in `.sow.yml`
