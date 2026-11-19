import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
} from "drizzle-orm";
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
import { isStaleQuestion } from "~/lib/comments";
import {
  getUnansweredQuestions,
  type QueuedQuestion,
} from "~/services/commentService";

// ─── Instructor Dashboard Service ───
// Everything the instructor dashboard shows: who needs help, how each course is
// doing, unanswered questions and recent discussion. Routes only check access
// and render; every rule lives here. `now` is a parameter so the
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

/** Students who must share a drop-off lesson before a card shows it. */
export const DROP_OFF_MIN_STUDENTS = 3;

/** Unanswered questions listed on the dashboard; the rest are one click away. */
export const UNANSWERED_QUESTIONS_SHOWN = 10;

/** Threads in the recent discussion feed. */
export const RECENT_DISCUSSION_SHOWN = 10;

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

export type CourseCard = {
  course: { id: number; title: string; slug: string };
  enrolledCount: number;
  /** Distinct students with at least one flag in this course. */
  stuckCount: number;
  unansweredCount: number;
  finishedCount: number;
  /** Where unfinished students most often stopped; null below the minimum. */
  dropOffLesson: { id: number; title: string; studentCount: number } | null;
};

export type UnansweredQuestion = {
  id: number;
  student: { id: number; name: string; avatarUrl: string | null };
  course: { id: number; title: string; slug: string };
  lesson: { id: number; title: string };
  /** First line of the question. */
  excerpt: string;
  createdAt: string;
  waitingDays: number;
  isStale: boolean;
};

export type DiscussionEntry = {
  id: number;
  author: { id: number; name: string; avatarUrl: string | null };
  course: { id: number; title: string; slug: string };
  lesson: { id: number; title: string };
  excerpt: string;
  createdAt: string;
  /** Replies that haven't been deleted. */
  replyCount: number;
};

export type InstructorDashboard = {
  needsAttention: NeedsAttentionRow[];
  courseCards: CourseCard[];
  /** Oldest first. */
  unansweredQuestions: UnansweredQuestion[];
  /** Newest first. */
  recentDiscussion: DiscussionEntry[];
};

/** The signed-in user. Admins span every course; instructors their own. */
export type Viewer = { userId: number; isAdmin: boolean };

export function getInstructorDashboard(
  viewer: Viewer,
  now: Date
): InstructorDashboard {
  const instructorId = viewer.isAdmin ? null : viewer.userId;
  const scopedCourses = db
    .select({ id: courses.id, title: courses.title, slug: courses.slug })
    .from(courses)
    .where(
      instructorId === null ? undefined : eq(courses.instructorId, instructorId)
    )
    .all();

  if (scopedCourses.length === 0) {
    return {
      needsAttention: [],
      courseCards: [],
      unansweredQuestions: [],
      recentDiscussion: [],
    };
  }

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

  return {
    needsAttention,
    courseCards: buildCourseCards(scopedCourses, facts, needsAttention),
    unansweredQuestions: facts.unansweredOldestFirst
      .slice(0, UNANSWERED_QUESTIONS_SHOWN)
      .map((q) => {
        const waitingDays = daysExcludingSundays(q.createdAt, now);
        return {
          id: q.id,
          student: { id: q.authorId, name: q.authorName, avatarUrl: q.authorAvatarUrl },
          course: courseById.get(facts.lessonCourse.get(q.lessonId)!)!,
          lesson: { id: q.lessonId, title: q.lessonTitle },
          excerpt: firstLine(q.body),
          createdAt: q.createdAt,
          waitingDays,
          isStale: isStaleQuestion(waitingDays),
        };
      }),
    recentDiscussion: buildRecentDiscussion(viewer, facts, courseById),
  };
}

// ─── Recent discussion ───

/**
 * Newest live top-level comments in the viewer's courses. Unanswered questions
 * have their own section, and the viewer's own comments aren't news to them.
 */
function buildRecentDiscussion(
  viewer: Viewer,
  facts: CourseFacts,
  courseById: Map<number, CourseCard["course"]>
): DiscussionEntry[] {
  const lessonIds = [...facts.lessonCourse.keys()];
  if (lessonIds.length === 0) return [];

  const unansweredIds = facts.unansweredOldestFirst.map((q) => q.id);

  const threads = db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorId: users.id,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .where(
      and(
        inArray(comments.lessonId, lessonIds),
        isNull(comments.parentId),
        isNull(comments.deletedAt),
        ne(comments.userId, viewer.userId),
        unansweredIds.length > 0
          ? notInArray(comments.id, unansweredIds)
          : undefined
      )
    )
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(RECENT_DISCUSSION_SHOWN)
    .all();

  if (threads.length === 0) return [];

  const replyCounts = new Map(
    db
      .select({ parentId: comments.parentId, replies: count() })
      .from(comments)
      .where(
        and(
          inArray(
            comments.parentId,
            threads.map((t) => t.id)
          ),
          isNull(comments.deletedAt)
        )
      )
      .groupBy(comments.parentId)
      .all()
      .map((row) => [row.parentId, row.replies])
  );

  return threads.map((t) => ({
    id: t.id,
    author: { id: t.authorId, name: t.authorName, avatarUrl: t.authorAvatarUrl },
    course: courseById.get(facts.lessonCourse.get(t.lessonId)!)!,
    lesson: { id: t.lessonId, title: t.lessonTitle },
    excerpt: firstLine(t.body),
    createdAt: t.createdAt,
    replyCount: replyCounts.get(t.id) ?? 0,
  }));
}

// ─── Course cards ───

function buildCourseCards(
  scopedCourses: CourseCard["course"][],
  facts: CourseFacts,
  needsAttention: NeedsAttentionRow[]
): CourseCard[] {
  const cards: CourseCard[] = [];

  for (const course of scopedCourses) {
    const students = facts.enrolled.filter((e) => e.courseId === course.id);
    if (students.length === 0) continue;

    cards.push({
      course,
      enrolledCount: students.length,
      // One row per student per course, so rows are already distinct students.
      stuckCount: needsAttention.filter((row) => row.course.id === course.id)
        .length,
      unansweredCount: facts.unansweredOldestFirst.filter(
        (q) => facts.lessonCourse.get(q.lessonId) === course.id
      ).length,
      finishedCount: students.filter((s) =>
        hasFinished(facts, s.userId, course.id)
      ).length,
      dropOffLesson: dropOffLesson(facts, course.id, students),
    });
  }

  return cards.sort(
    (a, b) =>
      b.stuckCount - a.stuckCount ||
      b.unansweredCount - a.unansweredCount ||
      a.course.title.localeCompare(b.course.title)
  );
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
  return isStaleQuestion(days)
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

/**
 * For each unfinished student, the first lesson in course order they haven't
 * completed; the most common one, if enough students share it.
 */
function dropOffLesson(
  facts: CourseFacts,
  courseId: number,
  students: Enrolled[]
): CourseCard["dropOffLesson"] {
  const courseLessons = facts.orderedLessons.filter(
    (l) => l.courseId === courseId
  );
  const stalledAt = new Map<number, number>();

  for (const student of students) {
    const next = courseLessons.find(
      (l) => !facts.completedLessons.has(key(student.userId, l.id))
    );
    if (next) stalledAt.set(next.id, (stalledAt.get(next.id) ?? 0) + 1);
  }

  // Ties go to the earlier lesson: Map keeps insertion order, and students
  // only ever reach later lessons by passing earlier ones.
  let best: CourseCard["dropOffLesson"] = null;
  for (const lesson of courseLessons) {
    const count = stalledAt.get(lesson.id) ?? 0;
    if (count >= DROP_OFF_MIN_STUDENTS && count > (best?.studentCount ?? 0)) {
      best = { id: lesson.id, title: lesson.title, studentCount: count };
    }
  }
  return best;
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

  // Course order: module position, then lesson position.
  const orderedLessons = db
    .select({ id: lessons.id, title: lessons.title, courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(inArray(modules.courseId, courseIds))
    .orderBy(modules.position, lessons.position, lessons.id)
    .all();

  const lessonCourse = new Map(orderedLessons.map((l) => [l.id, l.courseId]));

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
      lessonId: lessonProgress.lessonId,
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

  // Keyed by user and lesson; a Set so duplicate progress rows count once.
  const completedLessons = new Set<string>();
  for (const row of progress) {
    if (row.status === LessonProgressStatus.Completed) {
      completedLessons.add(key(row.userId, row.lessonId));
    }
  }

  const completedCount = new Map<string, number>();
  for (const userLesson of completedLessons) {
    const [userId, lessonId] = userLesson.split(":").map(Number);
    const userCourse = key(userId, lessonCourse.get(lessonId)!);
    completedCount.set(userCourse, (completedCount.get(userCourse) ?? 0) + 1);
  }

  const lastActivity = loadLastActivity(courseIds, attempts, progress);

  // Newest first from the service; reversed so the first match is the oldest.
  const unansweredOldestFirst: QueuedQuestion[] =
    getUnansweredQuestions(instructorId).reverse();

  return {
    enrolled,
    orderedLessons,
    lessonCourse,
    completedLessons,
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
