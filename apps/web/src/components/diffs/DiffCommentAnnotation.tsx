import { MessageCircle, Trash2 } from "lucide-react";
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
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  secondaryAction?: DiffCommentSecondaryAction;
  focusOnMount?: boolean;
}

/** The shared inline comment treatment for file previews, thread diffs, and pull-request diffs. */
export function DiffCommentAnnotation({
  kind,
  rangeLabel,
  text,
  onTextChange,
  onCancel,
  onComment,
  onDelete,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  pending = false,
  secondaryAction,
  focusOnMount = true,
}: DiffCommentAnnotationProps) {
  const [localDraftText, setLocalDraftText] = useState(text);
  const displayedText = kind === "draft" && !onTextChange ? localDraftText : text;
  const trimmedText = displayedText.trim();
  const isForm = kind === "draft";
  const formRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (kind !== "draft" || !focusOnMount) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnMount, kind]);

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

  if (kind === "comment") {
    return (
      <div
        data-diff-comment-annotation
        className="group/comment flex min-w-0 items-start gap-2.5 border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5 font-sans text-foreground"
        contentEditable={false}
        style={{ userSelect: "text", WebkitUserSelect: "text" }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-primary/70" aria-hidden="true" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5">{displayedText}</p>
        {onDelete ? (
          <span className="-my-1 -mr-1 flex shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Delete comment"
              onClick={onDelete}
            >
              <Trash2 className="size-3" />
            </Button>
          </span>
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
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Textarea
        ref={textareaRef}
        style={{
          caretColor: "auto",
          userSelect: "text",
          WebkitUserSelect: "text",
          maxHeight: 240,
          overflowY: "auto",
          resize: "none",
        }}
        size="sm"
        value={displayedText}
        placeholder={placeholder}
        aria-label={`Comment on lines ${rangeLabel}`}
        onChange={(event) => (onTextChange ?? setLocalDraftText)(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (isCommentSubmitShortcut(event, trimmedText, pending)) {
            event.preventDefault();
            onComment(trimmedText);
          }
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="mr-auto text-3xs text-muted-foreground/70">⌘/Ctrl Enter to send</span>
        <Button variant="ghost-muted" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        {secondaryAction ? (
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
        <Button size="xs" disabled={pending || !trimmedText} onClick={() => onComment(trimmedText)}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
