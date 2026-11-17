import { useAtomValue } from "@effect/atom-react";
import type { CodexResetForecast } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { ensureLocalApi } from "../../localApi";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { serverEnvironment } from "../../state/server";
import { formatGermanTimestamp } from "../../timestampFormat";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { UsageIndicatorDetails } from "./UsageIndicatorDetails";

const FORECAST_SITE = "https://codex.lunarwerx.com/";
const probabilityFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const forecastAtom = Atom.make(
  (
    get,
  ): {
    readonly forecast: CodexResetForecast | null;
    readonly loading: boolean;
  } => {
    const environmentId = get(primaryEnvironmentIdAtom);
    if (environmentId === null) return { forecast: null, loading: false };
    const result = get(serverEnvironment.codexResetForecast({ environmentId, input: {} }));
    return {
      forecast: result._tag === "Failure" ? null : Option.getOrNull(AsyncResult.value(result)),
      loading: result.waiting,
    };
  },
);

/** A static gauge for a third-party forecast, never an account's scheduled reset. */
export function CodexResetForecastIndicator() {
  const { forecast, loading } = useAtomValue(forecastAtom);
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const minute = useNowMinute();
  const now = Math.max(openedAt, Date.parse(`${minute}:00.000Z`));
  const resetAge = forecast?.lastResetAt ? now - Date.parse(forecast.lastResetAt) : null;
  const resetMinutes = resetAge === null ? null : Math.max(0, Math.floor(resetAge / 60_000));
  const recentReset = resetAge !== null && resetAge >= 0 && resetAge < 8 * 60 * 60_000;
  const probability = forecast?.next24Hours.probability;
  const percent = probability === undefined ? null : Math.round(probability * 100);
  const angle = Math.PI * (1 - (probability ?? 0));
  const label = `Codex reset forecast: ${percent === null ? (loading ? "loading" : "unavailable") : `${percent}% chance in 24 hours`}`;

  return (
    <SidebarMenuItem className="shrink-0">
      <UsageIndicatorDetails
        label={label}
        render={<SidebarMenuButton size="icon" />}
        actionLabel="Open Codex Forecast"
        desktopHint="Click to open Codex Forecast."
        onOpen={() => setOpenedAt(Date.now())}
        onActivate={() => void ensureLocalApi().shell.openExternal(FORECAST_SITE)}
        glyph={
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground grayscale"
          >
            <svg viewBox="0 0 32 32" className="size-7" fill="none" data-composer-control-icon>
              <path
                d="M 4 18 A 12 12 0 0 1 28 18"
                strokeWidth="3"
                strokeLinecap="round"
                className="stroke-current opacity-25"
              />
              {probability !== undefined ? (
                <>
                  <path
                    d="M 4 18 A 12 12 0 0 1 28 18"
                    strokeWidth="3"
                    strokeLinecap="round"
                    pathLength="100"
                    strokeDasharray={`${probability * 100} 100`}
                    className="stroke-current"
                  />
                  <path
                    d={`M 16 18 L ${16 + 9 * Math.cos(angle)} ${18 - 9 * Math.sin(angle)}`}
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    className="stroke-current"
                  />
                  <circle cx="16" cy="18" r="1.65" className="fill-current" />
                </>
              ) : null}
              <text
                x="16"
                y="29"
                textAnchor="middle"
                className="fill-current text-4xs font-medium tabular-nums"
              >
                {percent === null ? "?" : `${percent}%`}
              </text>
            </svg>
          </span>
        }
      >
        <div className="flex flex-col gap-2 text-left">
          <div className="font-medium">Codex reset forecast</div>
          <div>Statistical estimate, not a guaranteed reset.</div>
          {forecast ? (
            <>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 tabular-nums">
                <dt>Chance within 24 hours</dt>
                <dd className="text-right">
                  {probabilityFormat.format(forecast.next24Hours.probability)}
                </dd>
                <dt>Chance within {forecast.nearTerm.hours} hours</dt>
                <dd className="text-right">
                  {probabilityFormat.format(forecast.nearTerm.probability)}
                </dd>
                <dt>24-hour uncertainty range</dt>
                <dd className="text-right">
                  {probabilityFormat.format(forecast.next24Hours.low)} to{" "}
                  {probabilityFormat.format(forecast.next24Hours.high)}
                </dd>
              </dl>
              {forecast.lastResetAt && resetMinutes !== null ? (
                <div className={recentReset ? "text-success-foreground" : "text-muted-foreground"}>
                  <div>
                    Last reset:{" "}
                    <time dateTime={forecast.lastResetAt}>
                      {formatGermanTimestamp(forecast.lastResetAt)}
                    </time>
                  </div>
                  <div>
                    Time since last reset:{" "}
                    {resetMinutes < 1
                      ? "just now"
                      : `${resetMinutes >= 60 ? `${Math.floor(resetMinutes / 60)}h ` : ""}${resetMinutes % 60}m`}
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">Last reset: not reported</div>
              )}
              <div className="text-muted-foreground">
                Forecast from{" "}
                <time dateTime={forecast.generatedAt}>
                  {formatGermanTimestamp(forecast.generatedAt)}
                </time>{" "}
                (local time). Updated every 60 minutes.
              </div>
            </>
          ) : (
            <div>
              {loading
                ? "Loading forecast…"
                : "Forecast unavailable. A current estimate could not be read."}
            </div>
          )}
          <div className="text-muted-foreground">
            LunarWerx forecast of additional Codex resets. Separate from your regular account reset.
          </div>
        </div>
      </UsageIndicatorDetails>
    </SidebarMenuItem>
  );
}
