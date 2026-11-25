/** Validates a UTC calendar date from the content-date manifest. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through Date: out-of-range components normalize onto another
  // date (2026-02-30 -> 2026-03-02, month 13 -> next January), so a mismatch
  // is an impossible calendar date. setUTCFullYear (not the Date constructor)
  // keeps four-digit years 0000-0099 literal instead of mapping them to 1900s.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
