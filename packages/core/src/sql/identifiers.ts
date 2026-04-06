/**
 * Safely quote a SQL identifier (table, column, schema name).
 *
 * Postgres binds values via $1, $2, ... placeholders but identifiers
 * cannot be parameterized — they are part of the query structure. We
 * wrap in double quotes and escape any embedded double quote by doubling
 * it, per the SQL standard. This prevents an identifier containing
 * quotes (e.g. a hostile catalog row, or a user-supplied table name
 * reaching `sow branch sample`) from breaking out of the quoting and
 * turning into injectable SQL.
 *
 * Values in queries are always bound via the `params` array of
 * `sql.unsafe(query, params)` or `adapter.query(sql, params)`, never
 * interpolated into the query string.
 *
 * @example
 * quoteIdent("users")          // => '"users"'
 * quoteIdent('weird"name')     // => '"weird""name"'
 * quoteIdent('x"; DROP x; --') // => '"x""; DROP x; --"'  (inert)
 */
export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}
