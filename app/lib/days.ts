// ─── Day counting ───
// "N days" across the instructor tools means calendar days in the server's time
// zone, not counting Sundays. One rule everywhere, so a "3 days" threshold means
// the same thing on every page that uses it.

const SUNDAY = 0;

function startOfLocalDay(value: Date | string): Date {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Calendar days after `from`, up to and including `to`, that are not Sundays.
 * Same day → 0. Saturday → Monday → 1. Never negative.
 */
export function daysExcludingSundays(
  from: Date | string,
  to: Date | string
): number {
  const cursor = startOfLocalDay(from);
  const end = startOfLocalDay(to);
  let count = 0;

  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    if (cursor.getDay() !== SUNDAY) count++;
    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
}
