import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  getInstructorDashboard,
  getStudentOverview,
} from "./instructorDashboardService";

// November 2026: Sun 15, Mon 16, Tue 17, Wed 18, Thu 19, Fri 20, Sat 21.
// Local-time constructors keep the Sunday rule independent of the machine's
// time zone.
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour);
const iso = (day: number, hour = 12) => at(day, hour).toISOString();
const NOW = at(19);

function createUser(name: string, role = schema.UserRole.Student) {
  return testDb
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}@example.com`, role })
    .returning()
    .get();
}

function createCourse(title: string, instructorId: number) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      description: title,
      salesCopy: title,
      instructorId,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function createLessons(courseId: number, count: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();

  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get()
  );
}

function enroll(userId: number, courseId: number, enrolledDay = 19) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, enrolledAt: iso(enrolledDay) })
    .run();
}

function createQuiz(lessonId: number, title: string) {
  return testDb
    .insert(schema.quizzes)
    .values({ lessonId, title, passingScore: 0.7 })
    .returning()
    .get();
}

function attemptQuiz(userId: number, quizId: number, passed: boolean, day = 19) {
  testDb
    .insert(schema.quizAttempts)
    .values({
      userId,
      quizId,
      score: passed ? 1 : 0.2,
      passed,
      attemptedAt: iso(day),
    })
    .run();
}

function viewLesson(userId: number, lessonId: number, day: number) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.InProgress,
      lastViewedAt: iso(day),
    })
    .run();
}

function completeLesson(userId: number, lessonId: number, day = 19) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: iso(day),
      lastViewedAt: iso(day),
    })
    .run();
}

function postComment(
  userId: number,
  lessonId: number,
  day: number,
  parentId: number | null = null
) {
  return testDb
    .insert(schema.comments)
    .values({ userId, lessonId, parentId, body: "Help?", createdAt: iso(day) })
    .returning()
    .get();
}

function watchVideo(userId: number, lessonId: number, day: number) {
  testDb
    .insert(schema.videoWatchEvents)
    .values({
      userId,
      lessonId,
      eventType: "play",
      positionSeconds: 0,
      createdAt: iso(day),
    })
    .run();
}

const asInstructor = () => ({ userId: base.instructor.id, isAdmin: false });
const asAdmin = () => ({
  userId: createUser("Ada", schema.UserRole.Admin).id,
  isAdmin: true,
});

function flagsFor(
  dashboard: ReturnType<typeof getInstructorDashboard>,
  studentId: number,
  courseId: number
) {
  return dashboard.needsAttention.find(
    (row) => row.student.id === studentId && row.course.id === courseId
  )?.flags;
}

describe("instructorDashboardService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("quiz retry flag", () => {
    it("flags a student who failed the same quiz twice without passing", () => {
      const [lesson] = createLessons(base.course.id, 2);
      const quiz = createQuiz(lesson.id, "Joins Quiz");
      enroll(base.user.id, base.course.id);
      attemptQuiz(base.user.id, quiz.id, false);
      attemptQuiz(base.user.id, quiz.id, false);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toEqual([
        {
          kind: "quizRetry",
          quizId: quiz.id,
          quizTitle: "Joins Quiz",
          failedAttempts: 2,
        },
      ]);
    });

    it("does not flag a single failed attempt", () => {
      const [lesson] = createLessons(base.course.id, 2);
      const quiz = createQuiz(lesson.id, "Joins Quiz");
      enroll(base.user.id, base.course.id);
      attemptQuiz(base.user.id, quiz.id, false);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toBeUndefined();
    });

    it("clears once the student passes the quiz", () => {
      const [lesson] = createLessons(base.course.id, 2);
      const quiz = createQuiz(lesson.id, "Joins Quiz");
      enroll(base.user.id, base.course.id);
      attemptQuiz(base.user.id, quiz.id, false);
      attemptQuiz(base.user.id, quiz.id, false);
      attemptQuiz(base.user.id, quiz.id, true);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toBeUndefined();
    });
  });

  describe("quiet flag", () => {
    it("flags a student with no activity for 3 days", () => {
      const [lesson] = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 10);
      viewLesson(base.user.id, lesson.id, 16); // Mon → Thu

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toEqual([
        { kind: "quiet", days: 3, lastActiveAt: iso(16) },
      ]);
    });

    it("does not flag a student active 2 days ago", () => {
      const [lesson] = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 10);
      viewLesson(base.user.id, lesson.id, 17); // Tue → Thu

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toBeUndefined();
    });

    it("does not count Sundays", () => {
      const [lesson] = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 10);
      viewLesson(base.user.id, lesson.id, 14); // Sat → Tue: Mon, Tue

      const tuesday = getInstructorDashboard(asInstructor(), at(17));
      const wednesday = getInstructorDashboard(asInstructor(), at(18));

      expect(flagsFor(tuesday, base.user.id, base.course.id)).toBeUndefined();
      expect(flagsFor(wednesday, base.user.id, base.course.id)).toEqual([
        { kind: "quiet", days: 3, lastActiveAt: iso(14) },
      ]);
    });

    it("measures a student who never started from the day they enrolled", () => {
      createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 16);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toEqual([
        { kind: "quiet", days: 3, lastActiveAt: iso(16) },
      ]);
    });

    it.each([
      ["a video event", (lessonId: number) => watchVideo(base.user.id, lessonId, 18)],
      ["a lesson completion", (lessonId: number) => completeLesson(base.user.id, lessonId, 18)],
      ["a comment", (lessonId: number) => postComment(base.user.id, lessonId, 18)],
      [
        "a quiz attempt",
        (lessonId: number) =>
          attemptQuiz(base.user.id, createQuiz(lessonId, "Quiz").id, true, 18),
      ],
    ])("counts %s as activity", (_, act) => {
      const [first, second] = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 10);
      viewLesson(base.user.id, first.id, 11);
      act(second.id);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toBeUndefined();
    });

    it("counts reading a text lesson as activity", () => {
      // No video, quiz, or comment: only the lesson view itself.
      const [lesson] = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 10);
      viewLesson(base.user.id, lesson.id, 18);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toBeUndefined();
    });

    it("ignores activity in the student's other courses", () => {
      const [lesson] = createLessons(base.course.id, 2);
      const otherCourse = createCourse("Other Course", base.instructor.id);
      const [otherLesson] = createLessons(otherCourse.id, 1);
      enroll(base.user.id, base.course.id, 10);
      enroll(base.user.id, otherCourse.id, 10);
      viewLesson(base.user.id, lesson.id, 11);
      viewLesson(base.user.id, otherLesson.id, 19);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toEqual([
        { kind: "quiet", days: 7, lastActiveAt: iso(11) },
      ]);
      expect(flagsFor(dashboard, base.user.id, otherCourse.id)).toBeUndefined();
    });
  });

  describe("waiting flag", () => {
    function activeStudentWithLesson() {
      const [lesson] = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 10);
      viewLesson(base.user.id, lesson.id, 19);
      return lesson;
    }

    it("flags a question that has waited 3 days for a reply", () => {
      const lesson = activeStudentWithLesson();
      postComment(base.user.id, lesson.id, 16);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toEqual([
        { kind: "waiting", days: 3, questionCount: 1, excerpt: "Help?" },
      ]);
    });

    it("does not flag a question asked 2 days ago", () => {
      const lesson = activeStudentWithLesson();
      postComment(base.user.id, lesson.id, 17);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toBeUndefined();
    });

    it("clears once the instructor replies", () => {
      const lesson = activeStudentWithLesson();
      const question = postComment(base.user.id, lesson.id, 11);
      postComment(base.instructor.id, lesson.id, 12, question.id);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toBeUndefined();
    });

    it("reports the oldest of several waiting questions", () => {
      const lesson = activeStudentWithLesson();
      postComment(base.user.id, lesson.id, 11);
      postComment(base.user.id, lesson.id, 16);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toEqual([
        { kind: "waiting", days: 7, questionCount: 2, excerpt: "Help?" },
      ]);
    });
  });

  describe("finished students", () => {
    it("never flags a student who completed every lesson", () => {
      const lessons = createLessons(base.course.id, 2);
      const quiz = createQuiz(lessons[0].id, "Joins Quiz");
      enroll(base.user.id, base.course.id, 1);
      attemptQuiz(base.user.id, quiz.id, false, 2);
      attemptQuiz(base.user.id, quiz.id, false, 2);
      for (const lesson of lessons) completeLesson(base.user.id, lesson.id, 3);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toBeUndefined();
    });

    it("still flags a student with one lesson left", () => {
      const lessons = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 1);
      completeLesson(base.user.id, lessons[0].id, 3);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, base.course.id)).toEqual([
        { kind: "quiet", days: 14, lastActiveAt: iso(3) },
      ]);
    });
  });

  describe("scope", () => {
    function quietStudentInOtherInstructorsCourse() {
      const other = createUser("Other", schema.UserRole.Instructor);
      const course = createCourse("Their Course", other.id);
      createLessons(course.id, 1);
      enroll(base.user.id, course.id, 1);
      return course;
    }

    it("shows an instructor only their own courses", () => {
      const course = quietStudentInOtherInstructorsCourse();

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(flagsFor(dashboard, base.user.id, course.id)).toBeUndefined();
    });

    it("shows an admin every course", () => {
      const course = quietStudentInOtherInstructorsCourse();

      const dashboard = getInstructorDashboard(asAdmin(), NOW);

      expect(flagsFor(dashboard, base.user.id, course.id)).toHaveLength(1);
    });

    it("lists a student enrolled twice in a course only once", () => {
      createLessons(base.course.id, 1);
      enroll(base.user.id, base.course.id, 1);
      enroll(base.user.id, base.course.id, 2);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.needsAttention).toHaveLength(1);
      expect(dashboard.needsAttention[0].flags).toEqual([
        { kind: "quiet", days: 16, lastActiveAt: iso(1) },
      ]);
    });
  });

  describe("ordering", () => {
    it("lists students with more flags first, then the longest stuck", () => {
      const lessons = createLessons(base.course.id, 3);
      const quiz = createQuiz(lessons[0].id, "Joins Quiz");
      const quietLong = createUser("Quinn");
      const quietShort = createUser("Rae");
      const twoFlags = createUser("Sam");

      enroll(quietShort.id, base.course.id, 16); // quiet 3 days
      enroll(quietLong.id, base.course.id, 9); // quiet 8 days
      enroll(twoFlags.id, base.course.id, 1);
      attemptQuiz(twoFlags.id, quiz.id, false, 17);
      attemptQuiz(twoFlags.id, quiz.id, false, 17);
      postComment(twoFlags.id, lessons[1].id, 16); // waiting 3 days

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.needsAttention.map((row) => row.student.name)).toEqual([
        "Sam",
        "Quinn",
        "Rae",
      ]);
    });
  });

  describe("course cards", () => {
    it("counts enrolled, stuck, unanswered and finished students", () => {
      const lessons = createLessons(base.course.id, 2);
      const finisher = createUser("Fin");
      const quiet = createUser("Quinn");
      const asker = createUser("Ash");

      enroll(finisher.id, base.course.id, 1);
      for (const lesson of lessons) completeLesson(finisher.id, lesson.id, 18);
      enroll(quiet.id, base.course.id, 9);
      enroll(asker.id, base.course.id, 18);
      postComment(asker.id, lessons[0].id, 18); // unanswered, not yet stale
      postComment(asker.id, lessons[1].id, 18);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.courseCards).toEqual([
        {
          course: { id: base.course.id, title: "Test Course", slug: "test-course" },
          enrolledCount: 3,
          stuckCount: 1,
          unansweredCount: 2,
          finishedCount: 1,
          dropOffLesson: null,
        },
      ]);
    });

    it("counts a student with several flags as one stuck student", () => {
      const lessons = createLessons(base.course.id, 2);
      const quiz = createQuiz(lessons[0].id, "Joins Quiz");
      enroll(base.user.id, base.course.id, 1);
      attemptQuiz(base.user.id, quiz.id, false, 2);
      attemptQuiz(base.user.id, quiz.id, false, 2);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.courseCards[0].stuckCount).toBe(1);
    });

    it("includes unpublished courses with students and skips empty ones", () => {
      const draft = createCourse("Draft Course", base.instructor.id);
      testDb
        .update(schema.courses)
        .set({ status: schema.CourseStatus.Draft })
        .where(eq(schema.courses.id, draft.id))
        .run();
      createLessons(draft.id, 1);
      enroll(base.user.id, draft.id, 18);
      createCourse("Empty Course", base.instructor.id);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.courseCards.map((card) => card.course.title)).toEqual([
        "Draft Course",
      ]);
    });
  
    it("sorts by stuck, then unanswered, then title", () => {
      const course = (title: string) => {
        const c = createCourse(title, base.instructor.id);
        return { id: c.id, lesson: createLessons(c.id, 1)[0] };
      };
      let n = 0;
      const active = (courseId: number) => {
        const student = createUser(`Active ${n++}`);
        enroll(student.id, courseId, 18);
        return student;
      };
      const quiet = (courseId: number) =>
        enroll(createUser(`Quiet ${n++}`).id, courseId, 9);

      // base.course ("Test Course"): one student, nothing wrong.
      createLessons(base.course.id, 1);
      active(base.course.id);

      const oneStuck = course("Zeta");
      quiet(oneStuck.id);

      const twoStuck = course("Omega");
      quiet(twoStuck.id);
      quiet(twoStuck.id);

      const stuckAndAsked = course("Yankee");
      quiet(stuckAndAsked.id);
      postComment(active(stuckAndAsked.id).id, stuckAndAsked.lesson.id, 18);

      const alsoClean = course("Alpha");
      active(alsoClean.id);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.courseCards.map((card) => card.course.title)).toEqual([
        "Omega",
        "Yankee",
        "Zeta",
        "Alpha",
        "Test Course",
      ]);
    });

    describe("drop-off lesson", () => {
      // Module 2 is inserted first, so ids disagree with course order.
      function lessonsOutOfInsertOrder() {
        const later = testDb
          .insert(schema.modules)
          .values({ courseId: base.course.id, title: "Later", position: 2 })
          .returning()
          .get();
        const first = testDb
          .insert(schema.modules)
          .values({ courseId: base.course.id, title: "First", position: 1 })
          .returning()
          .get();
        const lesson = (moduleId: number, title: string, position: number) =>
          testDb
            .insert(schema.lessons)
            .values({ moduleId, title, position })
            .returning()
            .get();
        const c = lesson(later.id, "C", 1);
        const b = lesson(first.id, "B", 2);
        const a = lesson(first.id, "A", 1);
        return [a, b, c];
      }

      function studentsAt(count: number, completed: { id: number }[]) {
        for (let i = 0; i < count; i++) {
          const student = createUser(`Student ${completed.length}-${i}`);
          enroll(student.id, base.course.id, 18);
          for (const lesson of completed) completeLesson(student.id, lesson.id, 18);
        }
      }

      it("shows the first incomplete lesson, in course order, shared by 3 students", () => {
        const [a, b, c] = lessonsOutOfInsertOrder();
        studentsAt(3, [a, b]); // stalled at C
        studentsAt(2, [a]); // stalled at B
        studentsAt(4, [a, b, c]); // finished, ignored

        const dashboard = getInstructorDashboard(asInstructor(), NOW);

        expect(dashboard.courseCards[0].dropOffLesson).toEqual({
          id: c.id,
          title: "C",
          studentCount: 3,
        });
      });

      it("hides the drop-off lesson when fewer than 3 students share it", () => {
        const [a] = lessonsOutOfInsertOrder();
        studentsAt(2, []); // stalled at A
        studentsAt(2, [a]); // stalled at B

        const dashboard = getInstructorDashboard(asInstructor(), NOW);

        expect(dashboard.courseCards[0].dropOffLesson).toBeNull();
      });

      it("skips past a completed lesson to the first gap", () => {
        const [a, b, c] = lessonsOutOfInsertOrder();
        studentsAt(3, [a, c]); // stalled at B

        const dashboard = getInstructorDashboard(asInstructor(), NOW);

        expect(dashboard.courseCards[0].dropOffLesson).toEqual({
          id: b.id,
          title: "B",
          studentCount: 3,
        });
      });
    });
  });

  describe("unanswered questions", () => {
    it("lists the 10 oldest, oldest first, with how long each has waited", () => {
      const [lesson] = createLessons(base.course.id, 1);
      enroll(base.user.id, base.course.id, 1);
      const days = [17, 2, 16, 3, 4, 5, 6, 7, 9, 10, 11, 12];
      for (const day of days) postComment(base.user.id, lesson.id, day);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(
        dashboard.unansweredQuestions.map((q) => q.createdAt)
      ).toEqual([2, 3, 4, 5, 6, 7, 9, 10, 11, 12].map((d) => iso(d)));
    });

    it("describes each question and marks it stale at the shared threshold", () => {
      const [lesson] = createLessons(base.course.id, 1);
      enroll(base.user.id, base.course.id, 1);
      const stale = postComment(base.user.id, lesson.id, 16);
      postComment(base.user.id, lesson.id, 17);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.unansweredQuestions).toEqual([
        {
          id: stale.id,
          student: { id: base.user.id, name: "Test User", avatarUrl: null },
          course: { id: base.course.id, title: "Test Course", slug: "test-course" },
          lesson: { id: lesson.id, title: "Lesson 1" },
          excerpt: "Help?",
          createdAt: iso(16),
          waitingDays: 3,
          isStale: true,
        },
        expect.objectContaining({ waitingDays: 2, isStale: false }),
      ]);
    });

    it("uses only the first line of a question", () => {
      const [lesson] = createLessons(base.course.id, 1);
      enroll(base.user.id, base.course.id, 1);
      testDb
        .insert(schema.comments)
        .values({
          userId: base.user.id,
          lessonId: lesson.id,
          body: "Why does the join fail?\n\nHere is my code...",
          createdAt: iso(18),
        })
        .run();

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.unansweredQuestions[0].excerpt).toBe(
        "Why does the join fail?"
      );
    });
  });

  describe("recent discussion", () => {
    function answered(authorId: number, lessonId: number, day: number) {
      const thread = postComment(authorId, lessonId, day);
      postComment(base.instructor.id, lessonId, day, thread.id);
      return thread;
    }

    it("lists the 10 newest answered threads, newest first", () => {
      const [lesson] = createLessons(base.course.id, 1);
      const days = [2, 18, 3, 17, 4, 16, 5, 15, 6, 14, 7, 13];
      for (const day of days) answered(base.user.id, lesson.id, day);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.recentDiscussion.map((e) => e.createdAt)).toEqual(
        [18, 17, 16, 15, 14, 13, 7, 6, 5, 4].map((d) => iso(d))
      );
    });

    it("describes each thread with its live reply count", () => {
      const [lesson] = createLessons(base.course.id, 1);
      const classmate = createUser("Cam");
      const thread = answered(base.user.id, lesson.id, 15);
      postComment(classmate.id, lesson.id, 16, thread.id);
      const deletedReply = postComment(classmate.id, lesson.id, 16, thread.id);
      testDb
        .update(schema.comments)
        .set({ deletedAt: iso(17) })
        .where(eq(schema.comments.id, deletedReply.id))
        .run();

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.recentDiscussion).toEqual([
        {
          id: thread.id,
          author: { id: base.user.id, name: "Test User", avatarUrl: null },
          course: { id: base.course.id, title: "Test Course", slug: "test-course" },
          lesson: { id: lesson.id, title: "Lesson 1" },
          excerpt: "Help?",
          createdAt: iso(15),
          replyCount: 2,
          authorIsEnrolled: false,
        },
      ]);
    });

    it("leaves out unanswered questions, the viewer's own comments, deleted threads and other courses", () => {
      const [lesson] = createLessons(base.course.id, 1);
      const shown = answered(base.user.id, lesson.id, 10);
      postComment(base.user.id, lesson.id, 18); // unanswered
      postComment(base.instructor.id, lesson.id, 18); // the viewer's own
      const deleted = answered(base.user.id, lesson.id, 18);
      testDb
        .update(schema.comments)
        .set({ deletedAt: iso(18) })
        .where(eq(schema.comments.id, deleted.id))
        .run();
      const other = createUser("Other", schema.UserRole.Instructor);
      const theirCourse = createCourse("Their Course", other.id);
      const [theirLesson] = createLessons(theirCourse.id, 1);
      const theirs = postComment(base.user.id, theirLesson.id, 18);
      postComment(other.id, theirLesson.id, 18, theirs.id);

      const dashboard = getInstructorDashboard(asInstructor(), NOW);

      expect(dashboard.recentDiscussion.map((e) => e.id)).toEqual([shown.id]);
    });

    it("says which authors are enrolled, so only students' names open the panel", () => {
      const [lesson] = createLessons(base.course.id, 1);
      enroll(base.user.id, base.course.id);
      const student = answered(base.user.id, lesson.id, 16);
      const staff = answered(base.instructor.id, lesson.id, 15);

      const dashboard = getInstructorDashboard(asAdmin(), NOW);

      expect(
        dashboard.recentDiscussion.map((e) => [e.id, e.authorIsEnrolled])
      ).toEqual([
        [student.id, true],
        [staff.id, false],
      ]);
    });

    it("leaves out an admin's own comments too", () => {
      const [lesson] = createLessons(base.course.id, 1);
      const admin = asAdmin();
      postComment(admin.userId, lesson.id, 18);
      const theirs = answered(base.instructor.id, lesson.id, 17);

      const dashboard = getInstructorDashboard(admin, NOW);

      expect(dashboard.recentDiscussion.map((e) => e.id)).toEqual([theirs.id]);
    });
  });

  describe("student overview", () => {
    const sectionCourses = (studentId: number, viewer = asInstructor()) =>
      getStudentOverview(viewer, studentId, NOW)?.sections.map(
        (s) => s.course.title
      );

    it("has one section per course the student shares with the viewer", () => {
      const other = createUser("Other", schema.UserRole.Instructor);
      const second = createCourse("Second Course", base.instructor.id);
      const theirs = createCourse("Their Course", other.id);
      enroll(base.user.id, base.course.id);
      enroll(base.user.id, second.id);
      enroll(base.user.id, theirs.id);

      const overview = getStudentOverview(asInstructor(), base.user.id, NOW);

      expect(overview?.student).toEqual({
        id: base.user.id,
        name: "Test User",
        avatarUrl: null,
      });
      expect(sectionCourses(base.user.id)?.sort()).toEqual([
        "Second Course",
        "Test Course",
      ]);
    });

    it("returns nothing for a student outside the viewer's courses", () => {
      const other = createUser("Other", schema.UserRole.Instructor);
      const theirs = createCourse("Their Course", other.id);
      enroll(base.user.id, theirs.id);

      expect(getStudentOverview(asInstructor(), base.user.id, NOW)).toBeNull();
    });

    it("returns nothing for a student with no enrollments or no such user", () => {
      expect(getStudentOverview(asInstructor(), base.user.id, NOW)).toBeNull();
      expect(getStudentOverview(asInstructor(), 9999, NOW)).toBeNull();
    });

    const sectionFor = (studentId: number, courseId: number) =>
      getStudentOverview(asInstructor(), studentId, NOW)?.sections.find(
        (s) => s.course.id === courseId
      );

    it("shows progress and the first lesson not yet completed", () => {
      const [first, second, third, fourth] = createLessons(base.course.id, 4);
      enroll(base.user.id, base.course.id);
      completeLesson(base.user.id, first.id);
      completeLesson(base.user.id, third.id);
      viewLesson(base.user.id, fourth.id, 18);

      const section = sectionFor(base.user.id, base.course.id);

      expect(section?.progress).toEqual({ completed: 2, total: 4 });
      expect(section?.currentLesson).toEqual({
        id: second.id,
        title: "Lesson 2",
      });
    });

    it("has no current lesson once the student has finished", () => {
      const lessons = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id);
      for (const lesson of lessons) completeLesson(base.user.id, lesson.id);

      const section = sectionFor(base.user.id, base.course.id);

      expect(section?.progress).toEqual({ completed: 2, total: 2 });
      expect(section?.currentLesson).toBeNull();
    });

    it("shows the same flags as the dashboard, and when they were last active", () => {
      const [lesson] = createLessons(base.course.id, 2);
      const quiz = createQuiz(lesson.id, "Joins Quiz");
      enroll(base.user.id, base.course.id, 10);
      attemptQuiz(base.user.id, quiz.id, false, 14);
      attemptQuiz(base.user.id, quiz.id, false, 14);

      const section = sectionFor(base.user.id, base.course.id);

      // Last active Sat 14; Mon 16, Tue 17, Wed 18, Thu 19 → 4 days.
      expect(section?.flags).toEqual([
        {
          kind: "quizRetry",
          quizId: quiz.id,
          quizTitle: "Joins Quiz",
          failedAttempts: 2,
        },
        { kind: "quiet", days: 4, lastActiveAt: iso(14) },
      ]);
      expect(section?.lastActiveAt).toBe(iso(14));
    });

    it("has no flags for a student who is fine, and no last-active date before they start", () => {
      createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, 18);

      const section = sectionFor(base.user.id, base.course.id);

      expect(section?.flags).toEqual([]);
      expect(section?.lastActiveAt).toBeNull();
    });

    it("never flags a course the student has finished", () => {
      const [lesson] = createLessons(base.course.id, 1);
      enroll(base.user.id, base.course.id, 2);
      completeLesson(base.user.id, lesson.id, 3);

      expect(sectionFor(base.user.id, base.course.id)?.flags).toEqual([]);
    });

    it("lists quizzes the student hasn't passed, with attempt counts", () => {
      const [first, second, third] = createLessons(base.course.id, 3);
      const once = createQuiz(first.id, "Once Quiz");
      const passed = createQuiz(second.id, "Passed Quiz");
      createQuiz(third.id, "Untried Quiz");
      const twice = createQuiz(third.id, "Twice Quiz");
      enroll(base.user.id, base.course.id);
      attemptQuiz(base.user.id, once.id, false);
      attemptQuiz(base.user.id, passed.id, false);
      attemptQuiz(base.user.id, passed.id, true);
      attemptQuiz(base.user.id, twice.id, false);
      attemptQuiz(base.user.id, twice.id, false);
      const classmate = createUser("Classmate");
      enroll(classmate.id, base.course.id);
      attemptQuiz(classmate.id, once.id, false);

      const section = sectionFor(base.user.id, base.course.id);

      expect(section?.unpassedQuizzes).toEqual([
        { id: once.id, title: "Once Quiz", attempts: 1 },
        { id: twice.id, title: "Twice Quiz", attempts: 2 },
      ]);
    });

    it("lists the student's questions, unanswered first, each with its lesson", () => {
      const [first, second] = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id);
      const answeredOld = postComment(base.user.id, first.id, 10);
      postComment(base.instructor.id, first.id, 11, answeredOld.id);
      const answeredNew = postComment(base.user.id, second.id, 16);
      postComment(base.instructor.id, second.id, 17, answeredNew.id);
      const waitingNew = postComment(base.user.id, second.id, 18);
      const waitingOld = postComment(base.user.id, first.id, 12);
      postComment(base.user.id, first.id, 18, answeredOld.id); // a reply
      const deleted = postComment(base.user.id, first.id, 18);
      testDb
        .update(schema.comments)
        .set({ deletedAt: iso(18) })
        .where(eq(schema.comments.id, deleted.id))
        .run();
      const classmate = createUser("Classmate");
      postComment(classmate.id, first.id, 18);

      const questions = sectionFor(base.user.id, base.course.id)?.questions;

      expect(questions?.map((q) => [q.id, q.answered])).toEqual([
        [waitingOld.id, false],
        [waitingNew.id, false],
        [answeredNew.id, true],
        [answeredOld.id, true],
      ]);
      expect(questions?.[0]).toEqual({
        id: waitingOld.id,
        lesson: { id: first.id, title: "Lesson 1" },
        excerpt: "Help?",
        createdAt: iso(12),
        answered: false,
      });
    });

    it("puts flagged courses first, most flags first, then by title", () => {
      const course = (title: string) => {
        const c = createCourse(title, base.instructor.id);
        createLessons(c.id, 2);
        return c;
      };
      const zulu = course("Zulu");
      const alpha = course("Alpha");
      const quiet = course("Quiet");
      const both = course("Both");
      enroll(base.user.id, zulu.id);
      enroll(base.user.id, alpha.id);
      enroll(base.user.id, quiet.id, 10);
      enroll(base.user.id, both.id, 10);
      const [bothLesson] = createLessons(both.id, 1);
      const quiz = createQuiz(bothLesson.id, "Quiz");
      attemptQuiz(base.user.id, quiz.id, false, 12);
      attemptQuiz(base.user.id, quiz.id, false, 12);

      expect(sectionCourses(base.user.id)).toEqual([
        "Both",
        "Quiet",
        "Alpha",
        "Zulu",
      ]);
    });

    it("lets an admin open any student", () => {
      const other = createUser("Other", schema.UserRole.Instructor);
      const theirs = createCourse("Their Course", other.id);
      enroll(base.user.id, theirs.id);

      expect(sectionCourses(base.user.id, asAdmin())).toEqual(["Their Course"]);
    });
  });
});
