import { useState } from "react";
import { Link } from "react-router";
import { Card } from "~/components/ui/card";
import { FlagIndicator } from "~/components/flag-indicator";
import { StudentLink } from "~/components/student-link";
import { UserAvatar } from "~/components/user-avatar";
import type { NeedsAttentionRow } from "~/services/instructorDashboardService";

// Rows shown before "Show all (N)".
const VISIBLE_ROWS = 10;

export function NeedsAttention({ rows }: { rows: NeedsAttentionRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-semibold">Needs attention</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">✓ Nobody stuck</p>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y divide-border">
            {visible.map((row) => (
              <li
                key={`${row.student.id}:${row.course.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <UserAvatar
                    name={row.student.name}
                    avatarUrl={row.student.avatarUrl}
                    className="size-7"
                  />
                  <StudentLink student={row.student} />
                </div>
                <Link
                  to={`/instructor/${row.course.id}/students`}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {row.course.title}
                </Link>
                <div className="ml-auto flex items-center gap-4">
                  {row.flags.map((flag, i) => (
                    <FlagIndicator key={i} flag={flag} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {rows.length > VISIBLE_ROWS && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="border-t border-border px-4 py-2 text-left text-sm text-muted-foreground hover:text-foreground"
            >
              Show all ({rows.length})
            </button>
          )}
        </Card>
      )}
    </section>
  );
}
