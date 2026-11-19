import { Link } from "react-router";
import { MessageCircle } from "lucide-react";
import { Card } from "~/components/ui/card";
import { StudentLink } from "~/components/student-link";
import { UserAvatar } from "~/components/user-avatar";
import { formatRelativeTime } from "~/lib/utils";
import type { DiscussionEntry } from "~/services/instructorDashboardService";

export function RecentDiscussion({ entries }: { entries: DiscussionEntry[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-semibold">Recent discussion</h2>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent discussion</p>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id}>
                {/* The row links to the thread; the name, above it, opens the panel. */}
                <div className="relative flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
                  <UserAvatar
                    name={entry.author.name}
                    avatarUrl={entry.author.avatarUrl}
                    className="size-7 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {/* Staff can post too; only students have a panel. */}
                      {entry.authorIsEnrolled ? (
                        <StudentLink
                          student={entry.author}
                          className="relative z-10"
                        />
                      ) : (
                        <span className="font-medium">{entry.author.name}</span>
                      )}
                      <span className="text-muted-foreground">
                        {" "}
                        · {entry.lesson.title}
                      </span>
                    </p>
                    <Link
                      to={`/courses/${entry.course.slug}/lessons/${entry.lesson.id}`}
                      className="block truncate text-sm text-muted-foreground after:absolute after:inset-0"
                    >
                      {entry.excerpt}
                    </Link>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span suppressHydrationWarning>
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                    <span
                      className="relative inline-flex items-center gap-1"
                      title={`${entry.replyCount} ${entry.replyCount === 1 ? "reply" : "replies"}`}
                    >
                      <MessageCircle className="size-3.5" aria-hidden />
                      {entry.replyCount}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
