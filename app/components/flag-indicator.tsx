import { Clock, Moon, RotateCcw, type LucideIcon } from "lucide-react";
import { formatDay } from "~/lib/utils";
import type { AttentionFlag } from "~/services/instructorDashboardService";

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
        detail: `Last active ${formatDay(flag.lastActiveAt)}`,
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

export function FlagIndicator({ flag }: { flag: AttentionFlag }) {
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
