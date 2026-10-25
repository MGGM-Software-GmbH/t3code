import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_CLIENT_SETTINGS, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "./atomRegistry";

export const SLOW_RPC_ACK_THRESHOLD_MS =
  DEFAULT_CLIENT_SETTINGS.slowRequestWarningThresholdSeconds * 1000;
/**
 * Some requests are slow by design. Provider and server updates shell out to a
 * package manager and only respond once the install finishes. A VCS status
 * refresh fetches, may auto-pull, looks up the pull request, and first waits for
 * any background refresh of the same repository, which often totals over 15s.
 * Warning about those after 15s is noise, so they get a much longer leash.
 */
const LONG_RUNNING_RPC_ACK_THRESHOLD_MS = 120_000;
const MAX_TRACKED_RPC_ACK_REQUESTS = 256;
let slowRpcAckThresholdMs = SLOW_RPC_ACK_THRESHOLD_MS;

export interface SlowRpcAckRequest {
  readonly requestId: string;
  readonly method: string;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly tag: string;
  readonly thresholdMs: number;
}

interface PendingRpcAckRequest {
  readonly request: SlowRpcAckRequest;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

const pendingRpcAckRequests = new Map<string, PendingRpcAckRequest>();
// Background reports nobody waits on. A busy host delays them first, and warning
// about a request the user never made does not say what is wrong.
const untrackedRpcAckMethods = new Set<string>([
  WS_METHODS.serverGetUsageSummary,
  WS_METHODS.serverReportClientActivity,
]);
const longRunningRpcAckMethods = new Set<string>([
  WS_METHODS.serverUpdateProvider,
  WS_METHODS.serverRefreshProviders,
  WS_METHODS.serverUpdateServer,
  WS_METHODS.vcsRefreshStatus,
]);

const slowRpcAckRequestsAtom = Atom.make<ReadonlyArray<SlowRpcAckRequest>>([]).pipe(
  Atom.keepAlive,
  Atom.withLabel("slow-rpc-ack-requests"),
);

function setSlowRpcAckRequests(requests: ReadonlyArray<SlowRpcAckRequest>) {
  appAtomRegistry.set(slowRpcAckRequestsAtom, [...requests]);
}

function getSlowRpcAckRequestsValue(): ReadonlyArray<SlowRpcAckRequest> {
  return appAtomRegistry.get(slowRpcAckRequestsAtom);
}

function shouldTrackRpcAck(method: string): boolean {
  return (
    !method.includes("subscribe") &&
    !method.startsWith("pullRequests.") &&
    !untrackedRpcAckMethods.has(method)
  );
}

function rpcAckThresholdMs(method: string): number {
  return longRunningRpcAckMethods.has(method)
    ? Math.max(slowRpcAckThresholdMs, LONG_RUNNING_RPC_ACK_THRESHOLD_MS)
    : slowRpcAckThresholdMs;
}

export function getSlowRpcAckRequests(): ReadonlyArray<SlowRpcAckRequest> {
  return getSlowRpcAckRequestsValue();
}

/** Apply settings to in-flight requests without restarting their elapsed time. */
export function setSlowRpcAckThresholdSeconds(seconds: number): void {
  const thresholdMs = seconds * 1000;
  if (thresholdMs === slowRpcAckThresholdMs) return;
  const requests = [
    ...getSlowRpcAckRequestsValue(),
    ...[...pendingRpcAckRequests.values()].map(({ request }) => request),
  ];
  slowRpcAckThresholdMs = thresholdMs;
  clearAllTrackedRpcRequests();
  if (thresholdMs === 0) return;
  for (const request of requests) {
    scheduleRpcRequest(request.requestId, request.method, request.tag, request.startedAtMs);
  }
}

/**
 * Starts the slow-request timer for one in-flight unary RPC. `method` is the
 * bare WS method (used to decide whether and how long to wait); `tag` is the
 * human-readable label shown in the toast, which defaults to the method.
 */
export function trackRpcRequestSent(requestId: string, method: string, tag = method): void {
  if (slowRpcAckThresholdMs === 0 || !shouldTrackRpcAck(method)) {
    return;
  }

  scheduleRpcRequest(requestId, method, tag, Date.now());
}

function scheduleRpcRequest(
  requestId: string,
  method: string,
  tag: string,
  startedAtMs: number,
): void {
  clearTrackedRpcRequest(requestId);
  evictOldestPendingRpcRequestIfNeeded();

  const thresholdMs = rpcAckThresholdMs(method);
  const request: SlowRpcAckRequest = {
    requestId,
    method,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    tag,
    thresholdMs,
  };
  const remainingMs = thresholdMs - (Date.now() - startedAtMs);
  if (remainingMs <= 0) {
    appendSlowRpcAckRequest(request);
    return;
  }
  const timeoutId = setTimeout(() => {
    pendingRpcAckRequests.delete(requestId);
    appendSlowRpcAckRequest(request);
  }, remainingMs);

  pendingRpcAckRequests.set(requestId, {
    request,
    timeoutId,
  });
}

export function acknowledgeRpcRequest(requestId: string): void {
  clearTrackedRpcRequest(requestId);
  const slowRequests = getSlowRpcAckRequestsValue();
  if (!slowRequests.some((request) => request.requestId === requestId)) {
    return;
  }

  setSlowRpcAckRequests(slowRequests.filter((request) => request.requestId !== requestId));
}

function clearTrackedRpcRequest(requestId: string): void {
  const pending = pendingRpcAckRequests.get(requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingRpcAckRequests.delete(requestId);
}

function clearAllTrackedRpcRequests(): void {
  for (const requestId of pendingRpcAckRequests.keys()) {
    clearTrackedRpcRequest(requestId);
  }
  setSlowRpcAckRequests([]);
}

function appendSlowRpcAckRequest(request: SlowRpcAckRequest): void {
  const requests = [...getSlowRpcAckRequestsValue(), request];
  if (requests.length <= MAX_TRACKED_RPC_ACK_REQUESTS) {
    setSlowRpcAckRequests(requests);
    return;
  }

  setSlowRpcAckRequests(requests.slice(-MAX_TRACKED_RPC_ACK_REQUESTS));
}

function evictOldestPendingRpcRequestIfNeeded(): void {
  while (pendingRpcAckRequests.size >= MAX_TRACKED_RPC_ACK_REQUESTS) {
    const oldestRequestId = pendingRpcAckRequests.keys().next().value;
    if (oldestRequestId === undefined) {
      return;
    }

    clearTrackedRpcRequest(oldestRequestId);
  }
}

export function useSlowRpcAckRequests(): ReadonlyArray<SlowRpcAckRequest> {
  return useAtomValue(slowRpcAckRequestsAtom);
}
