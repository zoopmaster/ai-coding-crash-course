import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getInstructorDashboard } from "./instructorDashboardService";

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

const asInstructor = () => base.instructor.id;

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

      const dashboard = getInstructorDashboard(null, NOW);

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
});
