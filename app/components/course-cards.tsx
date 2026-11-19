import { Link } from "react-router";
import { MessageCircleQuestion, TrendingDown, UserX, Users } from "lucide-react";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import type { CourseCard } from "~/services/instructorDashboardService";

// Problems lead; the finished count is deliberately small and quiet.
function Stat({
  icon: Icon,
  value,
  label,
  alert = false,
}: {
  icon: typeof Users;
  value: number;
  label: string;
  alert?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        alert && value > 0
          ? "text-amber-700 dark:text-amber-400"
          : "text-muted-foreground"
      )}
      title={label}
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{label}:</span>
      {value}
    </span>
  );
}

export function CourseCards({ cards }: { cards: CourseCard[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-semibold">Courses</h2>

      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No students enrolled yet</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.course.id}
              to={`/instructor/${card.course.id}/students`}
              className="group"
            >
              <Card className="h-full gap-2 px-4 py-4 transition-colors group-hover:border-primary">
                <span className="font-medium leading-tight">
                  {card.course.title}
                </span>
                <div className="flex items-center gap-4 text-sm">
                  <Stat icon={Users} value={card.enrolledCount} label="Enrolled" />
                  <Stat icon={UserX} value={card.stuckCount} label="Stuck" alert />
                  <Stat
                    icon={MessageCircleQuestion}
                    value={card.unansweredCount}
                    label="Unanswered questions"
                    alert
                  />
                </div>
                {card.dropOffLesson && (
                  <p
                    className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"
                    title={`${card.dropOffLesson.studentCount} students stopped here`}
                  >
                    <TrendingDown className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{card.dropOffLesson.title}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground/70">
                  {card.finishedCount} finished
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
