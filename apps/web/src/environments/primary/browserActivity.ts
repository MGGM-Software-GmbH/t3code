import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import { subscribeDocumentReturn } from "../../lib/documentActivity";
import { runPrimaryHttp } from "../../lib/runtime";
import { PrimaryEnvironmentHttpClient } from "./httpClient";

const activityIntervalMs = 60_000;
const inputEvents = ["pointerdown", "keydown", "wheel", "input"] as const;

const reportActivity = () =>
  runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.auth.browserActivity()),
      Effect.provideService(FetchHttpClient.RequestInit, {
        credentials: "same-origin",
        keepalive: true,
      }),
    ),
  );

/** Report foreground use even when all application traffic goes over an existing socket. */
export function trackBrowserSessionActivity(report = reportActivity) {
  let lastReport = -Infinity;
  let lastInput = -Infinity;
  let pending: ReturnType<typeof setTimeout> | undefined;
  function send() {
    clearTimeout(pending);
    pending = undefined;
    const now = Date.now();
    // A suspended tab can run an old batching timer hours after its last input.
    if (now - lastInput > activityIntervalMs + 1000) return;
    lastReport = now;
    void report().catch(() => console.warn("Could not renew the browser session on activity."));
  }
  function onActivity() {
    if (document.visibilityState !== "visible") return;
    lastInput = Date.now();
    const remaining = lastReport + activityIntervalMs - lastInput;
    if (remaining <= 0) send();
    else pending ??= setTimeout(send, remaining);
  }
  function onPageHide() {
    if (pending !== undefined) send();
  }
  const unsubscribe = subscribeDocumentReturn(onActivity);
  for (const event of inputEvents)
    window.addEventListener(event, onActivity, { capture: true, passive: true });
  window.addEventListener("pagehide", onPageHide);
  onActivity();
  return () => {
    clearTimeout(pending);
    unsubscribe();
    for (const event of inputEvents) window.removeEventListener(event, onActivity, true);
    window.removeEventListener("pagehide", onPageHide);
  };
}
