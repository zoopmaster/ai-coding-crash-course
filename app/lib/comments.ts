// Comment bounds live here rather than in commentService so that client
// components can import them without pulling the database driver into the
// browser bundle.

export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

// A question waiting this many days (Sundays excluded — see ~/lib/days) for a
// staff reply is stale: highlighted on the questions page and flagged on the
// instructor dashboard.
export const STALE_QUESTION_AFTER_DAYS = 3;

/** `waitingDays` from daysExcludingSundays. One rule for every page. */
export function isStaleQuestion(waitingDays: number): boolean {
  return waitingDays >= STALE_QUESTION_AFTER_DAYS;
}
