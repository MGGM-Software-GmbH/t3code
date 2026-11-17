import { WS_METHODS } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  acknowledgeRpcRequest,
  getSlowRpcAckRequests,
  trackRpcRequestSent,
  setSlowRpcAckThresholdSeconds,
  SLOW_RPC_ACK_THRESHOLD_MS,
} from "./requestLatencyState";

const LONG_RUNNING_RPC_ACK_THRESHOLD_MS = 120_000;

describe("requestLatencyState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSlowRpcAckThresholdSeconds(0);
    setSlowRpcAckThresholdSeconds(SLOW_RPC_ACK_THRESHOLD_MS / 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks unary requests as slow when the ack threshold is exceeded", () => {
    expect(SLOW_RPC_ACK_THRESHOLD_MS).toBe(60_000);
    trackRpcRequestSent("1", "server.getConfig");
    vi.advanceTimersByTime(SLOW_RPC_ACK_THRESHOLD_MS - 1);
    expect(getSlowRpcAckRequests()).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(getSlowRpcAckRequests()).toMatchObject([
      {
        requestId: "1",
        tag: "server.getConfig",
        thresholdMs: SLOW_RPC_ACK_THRESHOLD_MS,
      },
    ]);
  });

  it("uses the configured threshold for new requests", () => {
    setSlowRpcAckThresholdSeconds(3);
    trackRpcRequestSent("1", "git.status");
    vi.advanceTimersByTime(2_999);
    expect(getSlowRpcAckRequests()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(getSlowRpcAckRequests()).toMatchObject([{ requestId: "1", thresholdMs: 3_000 }]);
  });

  it("disables both ordinary and long-running request warnings with zero", () => {
    setSlowRpcAckThresholdSeconds(0);
    trackRpcRequestSent("1", "git.status");
    trackRpcRequestSent("2", WS_METHODS.serverUpdateProvider);
    vi.advanceTimersByTime(LONG_RUNNING_RPC_ACK_THRESHOLD_MS * 2);
    expect(getSlowRpcAckRequests()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears visible warnings and pending timers immediately when disabled", () => {
    setSlowRpcAckThresholdSeconds(2);
    trackRpcRequestSent("1", "git.status");
    vi.advanceTimersByTime(2_000);
    trackRpcRequestSent("2", "server.getConfig");
    expect(getSlowRpcAckRequests()).toHaveLength(1);
    setSlowRpcAckThresholdSeconds(0);
    expect(getSlowRpcAckRequests()).toEqual([]);
    vi.advanceTimersByTime(LONG_RUNNING_RPC_ACK_THRESHOLD_MS * 2);
    expect(getSlowRpcAckRequests()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resumes warnings for new requests after being enabled again", () => {
    setSlowRpcAckThresholdSeconds(0);
    trackRpcRequestSent("disabled", "git.status");
    setSlowRpcAckThresholdSeconds(1);
    trackRpcRequestSent("enabled", "git.status");
    vi.advanceTimersByTime(1_000);
    expect(getSlowRpcAckRequests().map((request) => request.requestId)).toEqual(["enabled"]);
  });

  it("extends a pending request's threshold without restarting its elapsed time", () => {
    setSlowRpcAckThresholdSeconds(2);
    trackRpcRequestSent("1", "git.status");
    vi.advanceTimersByTime(1_000);
    setSlowRpcAckThresholdSeconds(4);
    vi.advanceTimersByTime(2_999);
    expect(getSlowRpcAckRequests()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(getSlowRpcAckRequests()).toMatchObject([{ requestId: "1", thresholdMs: 4_000 }]);
  });

  it("warns immediately when a reduced threshold is already exceeded", () => {
    trackRpcRequestSent("1", "git.status");
    vi.advanceTimersByTime(5_000);
    setSlowRpcAckThresholdSeconds(3);
    expect(getSlowRpcAckRequests()).toMatchObject([{ requestId: "1", thresholdMs: 3_000 }]);
  });

  it("removes a visible warning until an increased threshold is exceeded", () => {
    setSlowRpcAckThresholdSeconds(1);
    trackRpcRequestSent("1", "git.status");
    vi.advanceTimersByTime(1_000);
    expect(getSlowRpcAckRequests()).toHaveLength(1);
    setSlowRpcAckThresholdSeconds(3);
    expect(getSlowRpcAckRequests()).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(getSlowRpcAckRequests()).toMatchObject([{ requestId: "1", thresholdMs: 3_000 }]);
    acknowledgeRpcRequest("1");
    expect(getSlowRpcAckRequests()).toEqual([]);
  });

  it("preserves the longer threshold for provider updates when settings change", () => {
    trackRpcRequestSent("1", WS_METHODS.serverUpdateProvider);
    vi.advanceTimersByTime(10_000);
    setSlowRpcAckThresholdSeconds(180);
    vi.advanceTimersByTime(169_999);
    expect(getSlowRpcAckRequests()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(getSlowRpcAckRequests()).toMatchObject([{ requestId: "1", thresholdMs: 180_000 }]);
  });
});
