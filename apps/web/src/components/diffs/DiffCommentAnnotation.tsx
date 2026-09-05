import { MessageCircle, Pencil, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

import { isCommentSubmitShortcut } from "./commentSubmitShortcut";

interface DiffCommentSecondaryAction {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly allowEmpty?: boolean;
  readonly onAction: (text: string) => void;
}

interface DiffCommentAnnotationProps {
  kind: "draft" | "comment";
  rangeLabel: string;
  text: string;
  onTextChange?: (text: string) => void;
  onCancel: () => void;
  onComment: (text: string) => void;
  onDelete?: () => void;
  onEdit?: (text: string) => void;
  editDraft?: string | null | undefined;
  onEditDraftChange?: (text: string | null) => void;
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  secondaryAction?: DiffCommentSecondaryAction;
  focusOnMount?: boolean;
}

/** Shared comment field for files, thread diffs, and pull-request diffs, with a separate editing draft. */
export function DiffCommentAnnotation({
  kind,
  rangeLabel,
  text,
  onTextChange,
  onCancel,
  onComment,
  onDelete,
  onEdit,
  editDraft,
  onEditDraftChange,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  pending = false,
  secondaryAction,
  focusOnMount = true,
}: DiffCommentAnnotationProps) {
  const [localDraftText, setLocalDraftText] = useState(text);
  const [localEditing, setLocalEditing] = useState(false);
  const editing = onEditDraftChange ? editDraft != null : localEditing;
  const finishEdit = () => (onEditDraftChange ? onEditDraftChange(null) : setLocalEditing(false));
  const isForm = kind === "draft" || editing;
  const displayedText = editing
    ? (editDraft ?? localDraftText)
    : kind === "draft" && !onTextChange
      ? localDraftText
      : text;
  const trimmedText = displayedText.trim();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const cancel = () => (editing ? finishEdit() : onCancel());
  const submit = () => {
    if (editing) {
      onEdit?.(trimmedText);
      finishEdit();
    } else {
      onComment(trimmedText);
    }
  };

  useLayoutEffect(() => {
    if (!isForm || !focusOnMount) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnMount, isForm]);

  useLayoutEffect(() => {
    const form = formRef.current;
    const textarea = textareaRef.current;
    if (!isForm || !form || !textarea) return;
    let viewport = form.parentElement;
    while (viewport && !/(auto|scroll)/.test(getComputedStyle(viewport).overflowY)) {
      viewport = viewport.parentElement;
    }
    if (!viewport) return;
    const scrollContainer = viewport;
    let frame: number | undefined;
    const keepFormVisible = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const availableHeight = scrollContainer.clientHeight;
        const controlsHeight = form.offsetHeight - textarea.offsetHeight;
        textarea.style.maxHeight = `${Math.max(48, Math.min(240, availableHeight - controlsHeight - 16))}px`;
        // Keep only the active form in view; do not scroll while another comment is being read.
        if (!form.contains(document.activeElement)) return;
        const bounds = form.getBoundingClientRect();
        const viewportBounds = scrollContainer.getBoundingClientRect();
        const bottom = viewportBounds.top + scrollContainer.clientTop + availableHeight;
        if (bounds.bottom > bottom) scrollContainer.scrollTop += bounds.bottom - bottom;
        else if (bounds.top < viewportBounds.top)
          scrollContainer.scrollTop += bounds.top - viewportBounds.top;
      });
    };
    const observer = new ResizeObserver(keepFormVisible);
    observer.observe(form);
    observer.observe(scrollContainer);
    keepFormVisible();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [isForm]);

  if (!isForm) {
    return (
      <div
        data-diff-comment-annotation
        className="group/comment flex min-w-0 items-start gap-2.5 border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5 font-sans text-foreground"
        contentEditable={false}
        style={{ userSelect: "text", WebkitUserSelect: "text" }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-primary/70" aria-hidden="true" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-5">{displayedText}</p>
        {onEdit ? (
          <Button
            className="-my-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/comment:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
            variant="ghost"
            size="icon-xs"
            aria-label="Edit comment"
            onClick={() => {
              setLocalDraftText(text);
              if (onEditDraftChange) onEditDraftChange(text);
              else setLocalEditing(true);
            }}
          >
            <Pencil className="size-3" />
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            className="-my-1 -mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/comment:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
            variant="ghost"
            size="icon-xs"
            aria-label="Delete comment"
            onClick={onDelete}
          >
            <Trash2 className="size-3" />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={formRef}
      data-diff-comment-annotation
      className="px-3 py-2 font-sans text-foreground"
      contentEditable={false}
      style={{ userSelect: "text", WebkitUserSelect: "text" }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Textarea
        ref={textareaRef}
        unstyled
        style={{
          caretColor: "auto",
          userSelect: "text",
          WebkitUserSelect: "text",
          maxHeight: 240,
          overflowY: "auto",
          resize: "none",
        }}
        className="relative inline-flex w-full rounded-md border border-border/50 bg-background/20 font-sans text-foreground transition-colors focus-within:border-border/70 [&_[data-slot=textarea]]:min-h-12 [&_[data-slot=textarea]]:cursor-text [&_[data-slot=textarea]]:caret-foreground [&_[data-slot=textarea]]:px-2.5 [&_[data-slot=textarea]]:py-1.5 [&_[data-slot=textarea]]:font-sans [&_[data-slot=textarea]]:text-xs [&_[data-slot=textarea]]:leading-5 max-sm:[&_[data-slot=textarea]]:min-h-12"
        size="sm"
        value={displayedText}
        placeholder={placeholder}
        aria-label={`Comment on lines ${rangeLabel}`}
        onChange={(event) =>
          (editing
            ? (onEditDraftChange ?? setLocalDraftText)
            : (onTextChange ?? setLocalDraftText))(event.target.value)
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
          if (isCommentSubmitShortcut(event, trimmedText, pending)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="mr-auto text-[10px] text-muted-foreground/70">⌘/Ctrl Enter to send</span>
        <Button
          className="text-muted-foreground hover:text-foreground"
          variant="ghost"
          size="xs"
          onClick={cancel}
        >
          Cancel
        </Button>
        {!editing && secondaryAction ? (
          <Button
            size="xs"
            variant="outline"
            disabled={!secondaryAction.allowEmpty && !trimmedText}
            onClick={() => secondaryAction.onAction(trimmedText)}
          >
            {secondaryAction.icon}
            {secondaryAction.label}
          </Button>
        ) : null}
        <Button size="xs" disabled={pending || !trimmedText} onClick={submit}>
          {editing ? "Save comment" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
