import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { UserAvatar } from "~/components/user-avatar";
import { MAX_COMMENT_LENGTH, type CommentAuthorBadge } from "~/lib/comments";

// Mirrors CommentView / CommentThread from commentService (kept structural so
// this client component doesn't import server code).
type Comment = {
  id: number;
  parentId: number | null;
  body: string | null;
  author: {
    id: number;
    name: string;
    avatarUrl: string | null;
    badge: CommentAuthorBadge;
  } | null;
  createdAt: string;
  edited: boolean;
  deleted: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type Thread = Comment & { replies: Comment[] };

type CommentActionData = { ok: boolean; error: string | null } | undefined;

/** Toasts errors and calls onSuccess once each time a submission finishes. */
function useCommentFetcher(onSuccess?: () => void) {
  const fetcher = useFetcher<CommentActionData>();
  const wasSubmitting = useRef(false);

  useEffect(() => {
    if (fetcher.state !== "idle") {
      wasSubmitting.current = true;
      return;
    }
    if (!wasSubmitting.current) return;
    wasSubmitting.current = false;

    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data?.ok) {
      onSuccess?.();
    }
  }, [fetcher.state, fetcher.data, onSuccess]);

  return fetcher;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LessonDiscussion({
  threads,
  count,
}: {
  threads: Thread[];
  count: number;
}) {
  return (
    <section className="mb-8 border-t pt-6" aria-labelledby="discussion-heading">
      <h2
        id="discussion-heading"
        className="mb-4 flex items-center gap-2 text-xl font-semibold"
      >
        <MessageSquare className="size-5" />
        Discussion ({count})
      </h2>

      <CommentForm
        intent="add-comment"
        placeholder="Ask a question or share a thought…"
        submitLabel="Post"
      />

      {threads.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No comments yet. Be the first to start the discussion.
        </p>
      ) : (
        <ul className="mt-6 space-y-6">
          {threads.map((thread) => (
            <li key={thread.id}>
              <ThreadView thread={thread} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ThreadView({ thread }: { thread: Thread }) {
  const [replying, setReplying] = useState(false);

  return (
    <div>
      <CommentView
        comment={thread}
        onReply={thread.deleted ? undefined : () => setReplying((r) => !r)}
      />

      {(thread.replies.length > 0 || replying) && (
        <div className="mt-4 ml-11 space-y-4 border-l pl-4">
          {thread.replies.map((reply) => (
            <CommentView key={reply.id} comment={reply} />
          ))}
          {replying && (
            <CommentForm
              intent="add-comment"
              parentId={thread.id}
              placeholder="Write a reply…"
              submitLabel="Reply"
              autoFocus
              onCancel={() => setReplying(false)}
              onSuccess={() => setReplying(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AuthorBadge({ badge }: { badge: CommentAuthorBadge }) {
  if (!badge) return null;
  return (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      {badge === "instructor" ? "Instructor" : "Admin"}
    </span>
  );
}

function CommentView({
  comment,
  onReply,
}: {
  comment: Comment;
  onReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const deleteFetcher = useCommentFetcher(() => toast.success("Comment deleted"));
  const isDeleting = deleteFetcher.state !== "idle";

  if (comment.deleted || !comment.author) {
    return (
      <div className="flex gap-3">
        <div className="size-8 shrink-0 rounded-full bg-muted" />
        <p className="py-1 text-sm italic text-muted-foreground">[deleted]</p>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <UserAvatar
        name={comment.author.name}
        avatarUrl={comment.author.avatarUrl}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{comment.author.name}</span>
          <AuthorBadge badge={comment.author.badge} />
          <span className="text-muted-foreground">
            {formatDate(comment.createdAt)}
            {comment.edited && " (edited)"}
          </span>
        </div>

        {editing ? (
          <div className="mt-2">
            <CommentForm
              intent="edit-comment"
              commentId={comment.id}
              defaultValue={comment.body ?? ""}
              submitLabel="Save"
              autoFocus
              onCancel={() => setEditing(false)}
              onSuccess={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {comment.body}
            </p>
            <div className="mt-1 flex items-center gap-1">
              {onReply && (
                <Button variant="ghost" size="sm" onClick={onReply}>
                  Reply
                </Button>
              )}
              {comment.canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              )}
              {comment.canDelete && (
                <deleteFetcher.Form method="post">
                  <input type="hidden" name="intent" value="delete-comment" />
                  <input type="hidden" name="commentId" value={comment.id} />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isDeleting}
                    className="text-destructive hover:text-destructive"
                  >
                    {isDeleting ? "Deleting…" : "Delete"}
                  </Button>
                </deleteFetcher.Form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CommentForm({
  intent,
  parentId,
  commentId,
  defaultValue = "",
  placeholder,
  submitLabel,
  autoFocus,
  onCancel,
  onSuccess,
}: {
  intent: "add-comment" | "edit-comment";
  parentId?: number;
  commentId?: number;
  defaultValue?: string;
  placeholder?: string;
  submitLabel: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const [body, setBody] = useState(defaultValue);
  const fetcher = useCommentFetcher(() => {
    setBody("");
    onSuccess?.();
  });
  const isSubmitting = fetcher.state !== "idle";
  const tooLong = body.length > MAX_COMMENT_LENGTH;

  return (
    <fetcher.Form method="post" className="space-y-2">
      <input type="hidden" name="intent" value={intent} />
      {parentId !== undefined && (
        <input type="hidden" name="parentId" value={parentId} />
      )}
      {commentId !== undefined && (
        <input type="hidden" name="commentId" value={commentId} />
      )}
      <Textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={tooLong || undefined}
        aria-label={placeholder ?? "Comment"}
      />
      <div className="flex items-center justify-end gap-2">
        {body.length > MAX_COMMENT_LENGTH * 0.9 && (
          <span
            className={
              tooLong
                ? "mr-auto text-xs text-destructive"
                : "mr-auto text-xs text-muted-foreground"
            }
          >
            {body.length.toLocaleString()} /{" "}
            {MAX_COMMENT_LENGTH.toLocaleString()}
          </span>
        )}
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          disabled={isSubmitting || tooLong || body.trim().length === 0}
        >
          {isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </fetcher.Form>
  );
}
