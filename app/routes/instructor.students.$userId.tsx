import type { ReactNode } from "react";
import {
  data,
  isRouteErrorResponse,
  Link,
  useLocation,
  useNavigate,
} from "react-router";
import { CheckCircle2, Clock } from "lucide-react";
import type { Route } from "./+types/instructor.students.$userId";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import {
  getStudentOverview,
  type StudentCourseSection,
} from "~/services/instructorDashboardService";
import { FlagIndicator } from "~/components/flag-indicator";
import type { StudentPanelState } from "~/components/student-link";
import { UserAvatar } from "~/components/user-avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { formatDay } from "~/lib/utils";

// The student panel: a sheet over /instructor, open for as long as this route
// is. Back, Esc and the close button all land on /instructor, which closes it.

export async function loader({ request, params }: Route.LoaderArgs) {
  const { userId, isAdmin } = await requireInstructorOrAdmin(request);
  const studentId = Number(params.userId);

  const overview = Number.isInteger(studentId)
    ? getStudentOverview({ userId, isAdmin }, studentId, new Date())
    : null;

  if (!overview) {
    throw data("This student isn't in any of your courses.", { status: 404 });
  }

  return { overview, isAdmin };
}

function StudentSheet({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Opened from the dashboard: step back, so Back doesn't reopen the panel.
  // Opened from a shared link: there's no dashboard entry to return to.
  const close = () =>
    (location.state as StudentPanelState | null)?.fromDashboard
      ? navigate(-1)
      : navigate("/instructor", { replace: true, preventScrollReset: true });

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-3 text-lg">
            {title}
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="divide-y divide-border px-4 pb-6 [&>*]:pb-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function StudentPanel({ loaderData }: Route.ComponentProps) {
  const { student, sections } = loaderData.overview;
  const courseCount = `${sections.length} ${
    sections.length === 1 ? "course" : "courses"
  }`;

  return (
    <StudentSheet
      title={
        <>
          <UserAvatar
            name={student.name}
            avatarUrl={student.avatarUrl}
            className="size-8"
          />
          {student.name}
        </>
      }
      description={
        // Admins see every course, so "your" would be wrong for them.
        loaderData.isAdmin
          ? `Enrolled in ${courseCount}`
          : `Enrolled in ${sections.length} of your courses`
      }
    >
      {sections.map((section) => (
        <CourseSection key={section.course.id} section={section} />
      ))}
    </StudentSheet>
  );
}

function CourseSection({ section }: { section: StudentCourseSection }) {
  const { course, progress, currentLesson, flags, lastActiveAt } = section;
  const percent =
    progress.total === 0
      ? 0
      : Math.round((progress.completed / progress.total) * 100);

  return (
    <section className="space-y-3 pt-4">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/instructor/${course.id}/students`}
          className="font-semibold hover:underline"
        >
          {course.title}
        </Link>
        {flags.length > 0 && (
          <div className="flex shrink-0 items-center gap-3">
            {flags.map((flag, i) => (
              <FlagIndicator key={i} flag={flag} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-sm font-medium">{percent}%</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {currentLesson ? (
            <>
              On <span className="text-foreground">{currentLesson.title}</span>
            </>
          ) : (
            "Finished"
          )}
          {" · "}
          <span suppressHydrationWarning>
            Last active {lastActiveAt ? formatDay(lastActiveAt) : "never"}
          </span>
        </p>
      </div>

      {section.unpassedQuizzes.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium">Quizzes not passed</h3>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {section.unpassedQuizzes.map((quiz) => (
              <li key={quiz.id} className="flex justify-between gap-3">
                <span className="truncate">{quiz.title}</span>
                <span className="shrink-0">
                  {quiz.attempts} {quiz.attempts === 1 ? "attempt" : "attempts"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {section.questions.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium">Questions</h3>
          <ul className="space-y-1 text-sm">
            {section.questions.map((question) => (
              <li key={question.id}>
                <Link
                  to={`/courses/${course.slug}/lessons/${question.lesson.id}`}
                  className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-muted/50"
                  title={question.lesson.title}
                >
                  {question.answered ? (
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-label="Answered"
                    />
                  ) : (
                    <Clock
                      className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
                      aria-label="Waiting for a reply"
                    />
                  )}
                  <span className="truncate">{question.excerpt}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message =
    isRouteErrorResponse(error) && typeof error.data === "string"
      ? error.data
      : "Something went wrong loading this student.";

  return (
    <StudentSheet title="Student not found" description={message}>
      {null}
    </StudentSheet>
  );
}
