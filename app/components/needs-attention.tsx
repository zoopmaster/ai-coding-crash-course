import { useState } from "react";
import { Link } from "react-router";
import { Clock, Moon, RotateCcw, type LucideIcon } from "lucide-react";
import { Card } from "~/components/ui/card";
import { UserAvatar } from "~/components/user-avatar";
import type {
  AttentionFlag,
  NeedsAttentionRow,
} from "~/services/instructorDashboardService";

// Rows shown before "Show all (N)".
const VISIBLE_ROWS = 10;

// Indicators stay terse: an icon for what's wrong, a short label for how bad.
// The detail lives in the hover tooltip, never in the row.
function describeFlag(flag: AttentionFlag): {
  icon: LucideIcon;
  label: string;
  detail: string;
} {
  switch (flag.kind) {
    case "quizRetry":
      return {
        icon: RotateCcw,
        label: `×${flag.failedAttempts}`,
        detail: `Failed "${flag.quizTitle}" ${flag.failedAttempts} times`,
      };
    case "quiet":
      return {
        icon: Moon,
        label: `${flag.days}d`,
        detail: `Last active ${new Date(flag.lastActiveAt).toLocaleDateString(
          undefined,
          { weekday: "short", month: "short", day: "numeric" }
        )}`,
      };
    case "waiting":
      return {
        icon: Clock,
        label: `${flag.days}d`,
        detail:
          flag.questionCount > 1
            ? `"${flag.excerpt}" and ${flag.questionCount - 1} more`
            : `"${flag.excerpt}"`,
      };
  }
}

function FlagIndicator({ flag }: { flag: AttentionFlag }) {
  const { icon: Icon, label, detail } = describeFlag(flag);
  return (
    <span
      className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"
      title={detail}
      suppressHydrationWarning
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{detail}</span>
      <span aria-hidden>{label}</span>
    </span>
  );
}

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
                  <span className="font-medium">{row.student.name}</span>
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
