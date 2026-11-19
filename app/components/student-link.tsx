import { Link } from "react-router";
import { cn } from "~/lib/utils";

/**
 * Set on links that open the panel from the dashboard, so closing it can step
 * back through history instead of stacking another /instructor entry.
 */
export type StudentPanelState = { fromDashboard: true };

/**
 * A student's name that opens their panel. Keeps the dashboard's scroll
 * position, since the panel slides in over it.
 */
export function StudentLink({
  student,
  className,
}: {
  student: { id: number; name: string };
  className?: string;
}) {
  return (
    <Link
      to={`/instructor/students/${student.id}`}
      state={{ fromDashboard: true } satisfies StudentPanelState}
      preventScrollReset
      className={cn("font-medium hover:underline", className)}
    >
      {student.name}
    </Link>
  );
}
