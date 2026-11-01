import type {
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { isOrchestrationV2TurnItemVisible } from "@t3tools/shared/orchestrationV2Timeline";

export type ThreadHistoryMeta = {
  readonly historyCursor: string | null;
  readonly hasMoreHistory: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly expanded: boolean;
  readonly latestLocalTurnOrdinal: number | null;
  /** Oldest contiguous loaded row, excluding history retained across a snapshot gap. */
  readonly oldestLoadedTurnOrdinal: number | null;
};

export const EMPTY_THREAD_HISTORY_META: ThreadHistoryMeta = {
  historyCursor: null,
  hasMoreHistory: false,
  loading: false,
  error: null,
  expanded: false,
  latestLocalTurnOrdinal: null,
  oldestLoadedTurnOrdinal: null,
};

export function isActiveHistoryRequestCursor(
  requestCursor: string,
  history: { readonly historyCursor: string | null },
): boolean {
  return history.historyCursor === requestCursor;
}

export function clearActiveHistoryLoading(
  requestCursor: string,
  history: ThreadHistoryMeta,
): ThreadHistoryMeta {
  if (!isActiveHistoryRequestCursor(requestCursor, history) || !history.loading) {
    return history;
  }
  return { ...history, loading: false };
}

function projectedItemKey(row: OrchestrationV2ProjectedTurnItem): string {
  return `${row.sourceThreadId}:${row.sourceItemId}`;
}

function renumberVisible(
  rows: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): OrchestrationV2ProjectedTurnItem[] {
  return rows.map((row, position) => (row.position === position ? row : { ...row, position }));
}

export function oldestLocalHistoryOrdinal(projection: {
  readonly thread: Pick<OrchestrationV2ThreadProjection["thread"], "id">;
  readonly visibleTurnItems: OrchestrationV2ThreadProjection["visibleTurnItems"];
}): number | null {
  let oldest: number | null = null;
  for (const row of projection.visibleTurnItems) {
    if (row.sourceThreadId !== projection.thread.id) continue;
    oldest = Math.min(oldest ?? row.item.ordinal, row.item.ordinal);
  }
  return oldest;
}

export function oldestPendingQuestion(projection: OrchestrationV2ThreadProjection) {
  const pending = new Set(
    projection.runtimeRequests
      .filter((request) => request.kind === "user_input" && request.status === "pending")
      .map((request) => request.id),
  );
  let oldest:
    | Extract<
        OrchestrationV2ThreadProjection["turnItems"][number],
        {
          type: "user_input_request";
        }
      >
    | undefined;
  for (const item of projection.turnItems) {
    if (item.type !== "user_input_request" || !pending.has(item.requestId)) continue;
    if (oldest === undefined || item.ordinal < oldest.ordinal) oldest = item;
  }
  return oldest;
}

export function retainPendingQuestionHistory(
  previous: OrchestrationV2ThreadProjection,
  incoming: OrchestrationV2ThreadProjection,
): OrchestrationV2ThreadProjection {
  const question = oldestPendingQuestion(incoming);
  if (question === undefined) return incoming;
  return mergeOlderHistoryIntoProjection(
    incoming,
    previous.visibleTurnItems.filter(
      (row) => row.sourceThreadId === incoming.thread.id && row.item.ordinal >= question.ordinal,
    ),
  );
}

export function mergeOlderHistoryIntoProjection(
  projection: OrchestrationV2ThreadProjection,
  olderItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  work?: { readonly anchorId: string; readonly nextCursor: string | null },
): OrchestrationV2ThreadProjection {
  if (olderItems.length === 0 && work === undefined) {
    return projection;
  }

  const start =
    work === undefined
      ? -1
      : projection.visibleTurnItems.findIndex((row) => row.sourceItemId === work.anchorId);
  const anchor = projection.visibleTurnItems[start];
  const deferred = anchor?.item.deferredWork;
  if (work !== undefined && deferred === undefined) return projection;
  const currentByKey = new Map(
    projection.visibleTurnItems.map((row) => [projectedItemKey(row), row]),
  );
  const turnItemById = new Map(projection.turnItems.map((item) => [String(item.id), item]));
  const pageKeys = new Set<string>();
  const page: OrchestrationV2ProjectedTurnItem[] = [];
  for (const pageRow of olderItems) {
    if (
      work &&
      anchor &&
      deferred &&
      (pageRow.sourceThreadId !== anchor.sourceThreadId ||
        pageRow.item.ordinal < anchor.item.ordinal ||
        pageRow.item.ordinal > deferred.lastOrdinal)
    )
      continue;
    const key = projectedItemKey(pageRow);
    if (pageKeys.has(key)) continue;
    let row = currentByKey.get(key) ?? pageRow;
    if (
      !currentByKey.has(key) &&
      (row.visibility === "local" || row.sourceThreadId === projection.thread.id)
    ) {
      const currentItem = turnItemById.get(String(row.sourceItemId));
      if (currentItem !== undefined) {
        if (
          (currentItem.type !== "run_interrupt_request" &&
            currentItem.type !== "user_input_request") ||
          !isOrchestrationV2TurnItemVisible({
            item: currentItem,
            runs: projection.runs,
            attempts: projection.attempts,
            items: projection.turnItems,
          })
        )
          continue;
        row = { ...row, item: currentItem };
      }
    }
    pageKeys.add(key);
    page.push(row);
    if (
      (row.visibility === "local" || row.sourceThreadId === projection.thread.id) &&
      !turnItemById.has(String(row.sourceItemId))
    )
      turnItemById.set(String(row.sourceItemId), row.item);
  }
  if (page.length === 0 && work === undefined) return projection;
  let visible = [
    ...page,
    ...projection.visibleTurnItems.filter((row) => !pageKeys.has(projectedItemKey(row))),
  ];
  if (work === undefined) {
    visible = [
      ...visible.filter((row) => row.sourceThreadId !== projection.thread.id),
      ...visible
        .filter((row) => row.sourceThreadId === projection.thread.id)
        .sort((left, right) => left.item.ordinal - right.item.ordinal),
    ];
  }
  if (work && anchor && deferred) {
    let end = start + 1;
    while (end < projection.visibleTurnItems.length) {
      const row = projection.visibleTurnItems[end]!;
      if (
        row.sourceThreadId !== anchor.sourceThreadId ||
        row.visibility === "synthetic" ||
        row.item.ordinal > deferred.lastOrdinal
      )
        break;
      end += 1;
    }
    const item = { ...anchor.item };
    if (work.nextCursor === null) delete item.deferredWork;
    else item.deferredWork = { ...deferred, cursor: work.nextCursor };
    const updated = { ...anchor, item };
    const section = [
      ...page,
      ...projection.visibleTurnItems
        .slice(start, end)
        .filter((row) => !pageKeys.has(projectedItemKey(row))),
    ];
    const ordered = section
      .map((row) => (row.sourceItemId === anchor.sourceItemId ? updated : row))
      .sort((left, right) => left.item.ordinal - right.item.ordinal);
    visible = [
      ...projection.visibleTurnItems.slice(0, start),
      ...ordered,
      ...projection.visibleTurnItems.slice(end),
    ];
    if (anchor.visibility === "local") turnItemById.set(String(updated.item.id), updated.item);
  }
  if (
    visible.length === projection.visibleTurnItems.length &&
    visible.every((row, index) => row === projection.visibleTurnItems[index])
  )
    return projection;
  return {
    ...projection,
    turnItems: [...turnItemById.values()],
    visibleTurnItems: renumberVisible(visible),
  };
}

export function applyHistoryPageMeta(
  current: ThreadHistoryMeta,
  page: {
    readonly nextCursor: string | null;
    readonly hasMoreHistory: boolean;
    readonly items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  },
  threadId: OrchestrationV2ThreadProjection["thread"]["id"],
): ThreadHistoryMeta {
  const oldest = oldestLocalHistoryOrdinal({
    thread: { id: threadId },
    visibleTurnItems: page.items,
  });
  return {
    historyCursor: page.nextCursor,
    hasMoreHistory: page.hasMoreHistory,
    loading: false,
    error: null,
    expanded: true,
    latestLocalTurnOrdinal: current.latestLocalTurnOrdinal,
    oldestLoadedTurnOrdinal:
      oldest === null
        ? current.oldestLoadedTurnOrdinal
        : Math.min(current.oldestLoadedTurnOrdinal ?? oldest, oldest),
  };
}

export function shouldShowLoadEarlierControl(history: ThreadHistoryMeta): boolean {
  return history.hasMoreHistory || history.error !== null;
}
