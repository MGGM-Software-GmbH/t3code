import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { MessageCircle, Pencil, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  PullRequestMarkdownTextarea,
  type PullRequestCompletionScope,
} from "~/components/pullRequest/PullRequestMarkdownTextarea";
import {
  SpeechTextField,
  TextFieldSpeechControls,
  type TextFieldSpeech,
} from "~/speech/useTextFieldSpeech";
import { textDirection } from "~/textDirection";
import { observeResize } from "~/lib/observeResize";

import { isCommentSubmitShortcut } from "./commentSubmitShortcut";

interface DiffCommentSecondaryAction {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly allowEmpty?: boolean;
  readonly onAction: (text: string) => void;
}

interface DiffCommentAnnotationProps {
  /** With an environment, the draft can be dictated; its project supplies vocabulary. */
  environmentId?: EnvironmentId | undefined;
  projectId?: ProjectId | null | undefined;
  ownerKey?: string;
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
  /** Set only for pull request comments, where `@` completes the repository's users. */
  completionScope?: PullRequestCompletionScope | null;
}

/** Shared comment field for files, thread diffs, and pull-request diffs, with a separate editing draft. */
export function DiffCommentAnnotation({
  environmentId,
  projectId,
  ownerKey,
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
  completionScope = null,
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
  const submitComment = (value: string) => {
    if (editing) {
      onEdit?.(value);
      finishEdit();
    } else {
      onComment(value);
    }
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the draft textarea on the next animation frame after mount
  useLayoutEffect(() => {
    if (!isForm || !focusOnMount) return;
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnMount, isForm]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Resize observations keep the active comment form inside its scroll viewport.
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
    const stopObserving = observeResize([form, scrollContainer], keepFormVisible);
    keepFormVisible();
    return () => {
      stopObserving();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [isForm]);

  if (!isForm) {
    return (
      <div
        data-diff-comment-annotation
        className="group/comment flex min-w-0 flex-wrap select-text items-start gap-2.5 border-s-2 border-primary/55 bg-primary/[0.045] px-3 py-2.5 font-sans text-foreground selection:bg-primary selection:text-primary-foreground"
        contentEditable={false}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MessageCircle className="size-3.5 h-5 shrink-0 text-primary/70" aria-hidden="true" />
        <p
          className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5"
          dir={textDirection(displayedText)}
        >
          {displayedText}
        </p>
        {onEdit ? (
          <span className="-my-1 flex shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
            <Button
              variant="ghost-muted"
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
          </span>
        ) : null}
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

  const submit = (
    speech: TextFieldSpeech | undefined,
    action: (text: string) => void,
    allowEmpty = false,
  ) => {
    const finish = (value: string) => {
      if (!pending && (allowEmpty || value.trim())) action(value.trim());
    };
    if (speech) speech.submitAfterDictation(finish);
    else finish(displayedText);
  };

  // Pierre hides native carets and selection; textarea comments need their own visible feedback.
  const renderDraft = (speech?: TextFieldSpeech) => (
    <div
      ref={formRef}
      data-diff-comment-annotation
      className="select-text px-3 py-2 font-sans text-foreground caret-foreground selection:bg-primary selection:text-primary-foreground"
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <PullRequestMarkdownTextarea
        ref={textareaRef}
        completionScope={completionScope}
        readOnly={speech?.freezesEditor}
        autoFocus={focusOnMount}
        size="sm"
        value={displayedText}
        dir={textDirection(displayedText)}
        placeholder={placeholder}
        aria-label={`Comment on lines ${rangeLabel}`}
        onValueChange={
          editing ? (onEditDraftChange ?? setLocalDraftText) : (onTextChange ?? setLocalDraftText)
        }
        onFocus={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (speech && speech.state.phase !== "idle") speech.cancel();
            else cancel();
          }
          if (isCommentSubmitShortcut(event, trimmedText, pending, speech?.blocksSubmission)) {
            event.preventDefault();
            submit(speech, submitComment);
          }
        }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="mr-auto text-3xs text-muted-foreground/70">⌘/Ctrl Enter to send</span>
        {speech ? <TextFieldSpeechControls speech={speech} disabled={pending} /> : null}
        <Button variant="ghost-muted" size="xs" onClick={cancel}>
          Cancel
        </Button>
        {!editing && secondaryAction ? (
          <Button
            size="xs"
            variant="outline"
            disabled={
              speech?.preparing ||
              pending ||
              (!speech?.blocksSubmission && !secondaryAction.allowEmpty && !trimmedText)
            }
            onClick={() => submit(speech, secondaryAction.onAction, secondaryAction.allowEmpty)}
          >
            {secondaryAction.icon}
            {secondaryAction.label}
          </Button>
        ) : null}
        <Button
          size="xs"
          disabled={speech?.preparing || pending || (!speech?.blocksSubmission && !trimmedText)}
          onClick={() => submit(speech, submitComment)}
        >
          {editing ? "Save comment" : submitLabel}
        </Button>
      </div>
    </div>
  );

  return environmentId ? (
    <SpeechTextField
      environmentId={environmentId}
      projectId={projectId}
      ownerKey={ownerKey ?? rangeLabel}
      text={displayedText}
      textareaRef={textareaRef}
      onTextChange={onTextChange ?? setLocalDraftText}
      disabled={pending}
    >
      {renderDraft}
    </SpeechTextField>
  ) : (
    renderDraft()
  );
}
