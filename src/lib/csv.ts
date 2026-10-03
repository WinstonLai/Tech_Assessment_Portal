/**
 * Quotes one CSV cell. Text starting with = + - @ (or tab / CR) would be evaluated as a formula when the file
 * is opened in Excel or Sheets, so it is prefixed with an apostrophe, which spreadsheets show as plain text.
 * Real numbers are written as-is.
 */
export function csvCell(value: unknown): string {
  let s = String(value ?? '');
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
