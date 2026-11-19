import { eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import {
  comments,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  quizAttempts,
  quizzes,
  users,
  videoWatchEvents,
} from "~/db/schema";
import { daysExcludingSundays } from "~/lib/days";
import { STALE_QUESTION_AFTER_DAYS } from "~/lib/comments";
import {
  getUnansweredQuestions,
  type QueuedQuestion,
} from "~/services/commentService";

// ─── Instructor Dashboard Service ───
// Everything the instructor dashboard knows about who needs help. Routes only
// check access and render; every rule lives here. `now` is a parameter so the
// time-based rules can be tested against a fixed date.
//
// Day counts use ~/lib/days: calendar days in the server's time zone, Sundays
// excluded.
//
// Uses positional parameters (project convention).

/** Failed attempts on one quiz, with no pass, before a student is flagged. */
export const QUIZ_RETRY_THRESHOLD = 2;

/** Days without activity before a student is "quiet". */
export const QUIET_AFTER_DAYS = 3;

export type AttentionFlag =
  | {
      kind: "quizRetry";
      quizId: number;
      quizTitle: string;
      failedAttempts: number;
    }
  | { kind: "quiet"; days: number; lastActiveAt: string }
  | {
      kind: "waiting";
      /** How long the oldest unanswered question has waited. */
      days: number;
      questionCount: number;
      /** First line of the oldest unanswered question. */
      excerpt: string;
    };

export type NeedsAttentionRow = {
  student: { id: number; name: string; avatarUrl: string | null };
  course: { id: number; title: string; slug: string };
  flags: AttentionFlag[];
};

export type InstructorDashboard = {
  needsAttention: NeedsAttentionRow[];
};

/**
 * Pass null for instructorId to span every course (admins); pass an id to
 * scope to the courses that instructor owns.
 */
export function getInstructorDashboard(
  instructorId: number | null,
  now: Date
): InstructorDashboard {
  const scopedCourses = db
    .select({ id: courses.id, title: courses.title, slug: courses.slug })
    .from(courses)
    .where(
      instructorId === null ? undefined : eq(courses.instructorId, instructorId)
    )
    .all();

  if (scopedCourses.length === 0) return { needsAttention: [] };

  const facts = loadCourseFacts(
    scopedCourses.map((c) => c.id),
    instructorId
  );
  const courseById = new Map(scopedCourses.map((c) => [c.id, c]));
  const needsAttention: NeedsAttentionRow[] = [];

  for (const student of facts.enrolled) {
    if (hasFinished(facts, student.userId, student.courseId)) continue;

    const flags = [
      ...quizRetryFlags(facts, student.userId, student.courseId),
      ...quietFlag(facts, student, now),
      ...waitingFlag(facts, student.userId, student.courseId, now),
    ];
    if (flags.length === 0) continue;

    needsAttention.push({
      student: {
        id: student.userId,
        name: student.name,
        avatarUrl: student.avatarUrl,
      },
      course: courseById.get(student.courseId)!,
      flags,
    });
  }

  needsAttention.sort(
    (a, b) =>
      b.flags.length - a.flags.length ||
      longestStuck(b) - longestStuck(a) ||
      a.student.name.localeCompare(b.student.name)
  );

  return { needsAttention };
}

// ─── Flag rules ───

/** Every lesson completed. Finished students are never flagged. */
function hasFinished(facts: CourseFacts, userId: number, courseId: number) {
  const lessonCount = facts.lessonCountByCourse.get(courseId) ?? 0;
  const completed = facts.completedCount.get(key(userId, courseId)) ?? 0;
  return lessonCount > 0 && completed >= lessonCount;
}

function quizRetryFlags(
  facts: CourseFacts,
  userId: number,
  courseId: number
): AttentionFlag[] {
  const byQuiz = new Map<
    number,
    { title: string; failed: number; passed: boolean }
  >();

  for (const attempt of facts.attempts) {
    if (attempt.userId !== userId || attempt.courseId !== courseId) continue;
    const entry = byQuiz.get(attempt.quizId) ?? {
      title: attempt.quizTitle,
      failed: 0,
      passed: false,
    };
    if (attempt.passed) entry.passed = true;
    else entry.failed++;
    byQuiz.set(attempt.quizId, entry);
  }

  return [...byQuiz]
    .filter(([, e]) => !e.passed && e.failed >= QUIZ_RETRY_THRESHOLD)
    .map(([quizId, e]) => ({
      kind: "quizRetry",
      quizId,
      quizTitle: e.title,
      failedAttempts: e.failed,
    }));
}

function quietFlag(
  facts: CourseFacts,
  student: Enrolled,
  now: Date
): AttentionFlag[] {
  // A student who never started is measured from the day they enrolled.
  const lastActiveAt =
    facts.lastActivity.get(key(student.userId, student.courseId)) ??
    student.enrolledAt;
  const days = daysExcludingSundays(lastActiveAt, now);
  return days >= QUIET_AFTER_DAYS
    ? [{ kind: "quiet", days, lastActiveAt }]
    : [];
}

function waitingFlag(
  facts: CourseFacts,
  userId: number,
  courseId: number,
  now: Date
): AttentionFlag[] {
  const waiting = facts.unansweredOldestFirst.filter(
    (q) =>
      q.authorId === userId && facts.lessonCourse.get(q.lessonId) === courseId
  );
  if (waiting.length === 0) return [];

  const oldest = waiting[0];
  const days = daysExcludingSundays(oldest.createdAt, now);
  return days >= STALE_QUESTION_AFTER_DAYS
    ? [
        {
          kind: "waiting",
          days,
          questionCount: waiting.length,
          excerpt: firstLine(oldest.body),
        },
      ]
    : [];
}

/** The largest day count across a row's flags (quiz retries carry none). */
function longestStuck(row: NeedsAttentionRow): number {
  return Math.max(
    0,
    ...row.flags.map((flag) => ("days" in flag ? flag.days : 0))
  );
}

function firstLine(body: string): string {
  const line = body.trim().split("\n")[0].trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

// ─── Loading ───
// One pass of queries over the viewer's courses; the rules above work on the
// result in memory.

type Enrolled = {
  userId: number;
  courseId: number;
  enrolledAt: string;
  name: string;
  avatarUrl: string | null;
};

type CourseFacts = ReturnType<typeof loadCourseFacts>;

const key = (userId: number, courseId: number) => `${userId}:${courseId}`;

function loadCourseFacts(courseIds: number[], instructorId: number | null) {
  const enrollmentRows = db
    .select({
      userId: enrollments.userId,
      courseId: enrollments.courseId,
      enrolledAt: enrollments.enrolledAt,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(inArray(enrollments.courseId, courseIds))
    .orderBy(enrollments.enrolledAt)
    .all();

  // Enrollments have no unique constraint; keep the earliest per student/course.
  const enrolled: Enrolled[] = [
    ...new Map(
      enrollmentRows
        .reverse()
        .map((row) => [key(row.userId, row.courseId), row])
    ).values(),
  ];

  const lessonCourse = new Map(
    db
      .select({ lessonId: lessons.id, courseId: modules.courseId })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(inArray(modules.courseId, courseIds))
      .all()
      .map((row) => [row.lessonId, row.courseId])
  );

  const lessonCountByCourse = new Map<number, number>();
  for (const courseId of lessonCourse.values()) {
    lessonCountByCourse.set(courseId, (lessonCountByCourse.get(courseId) ?? 0) + 1);
  }

  const attempts = db
    .select({
      userId: quizAttempts.userId,
      quizId: quizzes.id,
      quizTitle: quizzes.title,
      passed: quizAttempts.passed,
      attemptedAt: quizAttempts.attemptedAt,
      courseId: modules.courseId,
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .innerJoin(lessons, eq(lessons.id, quizzes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(inArray(modules.courseId, courseIds))
    .all();

  const progress = db
    .select({
      userId: lessonProgress.userId,
      status: lessonProgress.status,
      lastViewedAt: lessonProgress.lastViewedAt,
      completedAt: lessonProgress.completedAt,
      courseId: modules.courseId,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(inArray(modules.courseId, courseIds))
    .all();

  const completedCount = new Map<string, number>();
  for (const row of progress) {
    if (row.status !== LessonProgressStatus.Completed) continue;
    const k = key(row.userId, row.courseId);
    completedCount.set(k, (completedCount.get(k) ?? 0) + 1);
  }

  const lastActivity = loadLastActivity(courseIds, attempts, progress);

  // Newest first from the service; reversed so the first match is the oldest.
  const unansweredOldestFirst: QueuedQuestion[] =
    getUnansweredQuestions(instructorId).reverse();

  return {
    enrolled,
    lessonCourse,
    lessonCountByCourse,
    completedCount,
    attempts,
    lastActivity,
    unansweredOldestFirst,
  };
}

/**
 * Last activity per student per course: the most recent lesson view or
 * completion, video event, quiz attempt, or comment.
 */
function loadLastActivity(
  courseIds: number[],
  attempts: { userId: number; courseId: number; attemptedAt: string }[],
  progress: {
    userId: number;
    courseId: number;
    lastViewedAt: string | null;
    completedAt: string | null;
  }[]
): Map<string, string> {
  const videoEvents = db
    .select({
      userId: videoWatchEvents.userId,
      courseId: modules.courseId,
      at: videoWatchEvents.createdAt,
    })
    .from(videoWatchEvents)
    .innerJoin(lessons, eq(lessons.id, videoWatchEvents.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(inArray(modules.courseId, courseIds))
    .all();

  const commentEvents = db
    .select({
      userId: comments.userId,
      courseId: modules.courseId,
      at: comments.createdAt,
    })
    .from(comments)
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(inArray(modules.courseId, courseIds))
    .all();

  const events = [
    ...videoEvents,
    ...commentEvents,
    ...attempts.map((a) => ({ ...a, at: a.attemptedAt })),
    ...progress.flatMap((p) => [
      { ...p, at: p.lastViewedAt },
      { ...p, at: p.completedAt },
    ]),
  ];

  const latest = new Map<string, string>();
  for (const { userId, courseId, at } of events) {
    if (!at) continue;
    const k = key(userId, courseId);
    const current = latest.get(k);
    if (!current || at > current) latest.set(k, at);
  }
  return latest;
}
