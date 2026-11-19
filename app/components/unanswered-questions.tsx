import { Link } from "react-router";
import { Card } from "~/components/ui/card";
import { StudentLink } from "~/components/student-link";
import { UserAvatar } from "~/components/user-avatar";
import { cn } from "~/lib/utils";
import type { UnansweredQuestion } from "~/services/instructorDashboardService";

export function UnansweredQuestions({
  questions,
}: {
  questions: UnansweredQuestion[];
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Unanswered questions</h2>
        <Link
          to="/instructor/questions"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          See all
        </Link>
      </div>

      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">✓ All caught up</p>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y divide-border">
            {questions.map((q) => (
              <li key={q.id}>
                {/* The row links to the thread; the name, above it, opens the panel. */}
                <div className="relative flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
                  <UserAvatar
                    name={q.student.name}
                    avatarUrl={q.student.avatarUrl}
                    className="size-7 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <StudentLink
                        student={q.student}
                        className="relative z-10"
                      />
                      <span className="text-muted-foreground">
                        {" "}
                        · {q.course.title} / {q.lesson.title}
                      </span>
                    </p>
                    <Link
                      to={`/courses/${q.course.slug}/lessons/${q.lesson.id}`}
                      className="block truncate text-sm text-muted-foreground after:absolute after:inset-0"
                    >
                      {q.excerpt}
                    </Link>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      q.isStale
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {q.waitingDays === 0 ? "Today" : `${q.waitingDays}d`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
