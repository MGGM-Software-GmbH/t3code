import { MessageCircle, X } from "lucide-react";
import { useState } from "react";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";

import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { cn } from "~/lib/utils";

interface ComposerPendingReviewCommentsProps {
  comments: ReadonlyArray<ReviewCommentContext>;
  onRemove: (commentId: string) => void;
  onEdit: (commentId: string, text: string) => void;
  className?: string;
}

export function ComposerPendingReviewComments({
  comments,
  onRemove,
  onEdit,
  className,
}: ComposerPendingReviewCommentsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingComment = comments.find((comment) => comment.id === editingId);
  if (comments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {comments.map((comment) => {
        const label = `${comment.filePath} ${comment.rangeLabel}${comment.sourceStatus === "removed" ? " (removed)" : comment.sourceStatus === "unresolved" ? " (unresolved)" : ""}`;
        const chip = (
          <span key={comment.id} className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, "pr-1")}>
            <MessageCircle className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
            <button
              type="button"
              className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}
              aria-label={`Edit comment on ${label}`}
              onClick={() => setEditingId(comment.id)}
            >
              {label}
            </button>
            <button
              type="button"
              aria-label={`Remove comment on ${label}`}
              className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove(comment.id);
              }}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        );
        if (comment.text.length === 0) return chip;
        return (
          <Tooltip key={comment.id}>
            <TooltipTrigger render={chip} />
            <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap leading-tight">
              {comment.text}
            </TooltipPopup>
          </Tooltip>
        );
      })}
      {editingComment ? (
        <div className="w-full rounded border border-border">
          <p className="px-3 pt-2 text-xs text-muted-foreground">
            Selected snapshot. Line numbers refer to the file at selection time.
          </p>
          <pre className="max-h-40 overflow-auto px-3 text-xs">{editingComment.diff}</pre>
          <DiffCommentAnnotation
            key={editingComment.id}
            kind="draft"
            rangeLabel={editingComment.rangeLabel}
            text={editingComment.text}
            submitLabel="Save comment"
            onCancel={() => setEditingId(null)}
            onComment={(text) => {
              onEdit(editingComment.id, text);
              setEditingId(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
