import { useGT, useMessages, T, Var } from "gt-react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  summarizeWeeklyLimits,
  shouldShowWeeklyLimit,
  type LimitAccount,
} from "@t3tools/shared/usageLimits";
import { collectLimitNotices, limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactElement } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { formatGermanTimestamp } from "../../timestampFormat";
import { ComposerControl } from "../chat/ComposerControl";
import { providerClients } from "../settings/providerDriverMeta";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { UsageIndicatorDetails } from "./UsageIndicatorDetails";
import { resetExpiringSoon } from "./resetCreditExpiry";
import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

const EMPTY_NOTICES: readonly string[] = [];

/** Keep the expiry attached to its account and the local timestamp on one line. */
function BankedResetExpiry({
  credits,
  now,
}: {
  readonly credits: LimitAccount["limits"]["resetCredits"];
  readonly now: number;
}) {
  const uebersetzen = useGT();
  return (
    <div className="flex flex-wrap gap-x-1 text-muted-foreground">
      <span className="whitespace-nowrap">
        <T>Next banked reset expiry: </T>
      </span>
      <span className="whitespace-nowrap">
        {credits?.availableCount === 0 ? (
          "none"
        ) : credits?.nextExpiresAt ? (
          <>
            <T>
              <time
                dateTime={credits.nextExpiresAt}
                className={
                  resetExpiringSoon(credits.nextExpiresAt, now)
                    ? "text-reset-expiry-foreground"
                    : undefined
                }
              >
                <Var>{formatGermanTimestamp(credits.nextExpiresAt)}</Var>
              </time>
              <Var> </Var>
              (local time)
            </T>
          </>
        ) : (
          uebersetzen("not reported")
        )}
      </span>
    </div>
  );
}

function accountName(account: LimitAccount) {
  return (
    account.displayName ?? providerClients.get(account.driver)?.label ?? String(account.driver)
  );
}

/** Each inner arc is one day; a partial arc shows time elapsed in the current day. */
function dayArc(start: number, end: number) {
  const point = (angle: number) => {
    const radians = ((angle - 90) * Math.PI) / 180;
    return `${16 + 10.8 * Math.cos(radians)} ${16 + 10.8 * Math.sin(radians)}`;
  };
  return `M ${point(start)} A 10.8 10.8 0 0 1 ${point(end)}`;
}

/** A static, neutral quota glyph; it reads snapshots and never requests a provider refresh. */
function WeeklyLimitIndicator({
  accounts,
  notices = EMPTY_NOTICES,
  title,
  render,
  onNavigate,
  autoRedeemAtWeeklyLimit = false,
}: {
  readonly accounts: readonly LimitAccount[];
  readonly notices?: readonly string[];
  readonly title: string;
  readonly render: ReactElement;
  readonly onNavigate?: () => void;
  readonly autoRedeemAtWeeklyLimit?: boolean;
}) {
  const uebersetzen = useGT();
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const minute = useNowMinute();
  const now = Math.max(openedAt, Date.parse(`${minute}:00.000Z`));
  const summary = summarizeWeeklyLimits(accounts, now);
  const percent = summary.remainingPercent;
  const banked = summary.bankedResets;
  const expiringSoon = resetExpiringSoon(summary.nextCreditExpiresAt, now);
  const elapsedDays = summary.elapsedDays;
  const label = `${title}: ${percent === null ? "unavailable" : `${percent}% remaining`}`;
  const time = formatGermanTimestamp;
  const navigate = useNavigate();
  return (
    <UsageIndicatorDetails
      wide
      render={render}
      label={label}
      onOpen={() => setOpenedAt(Date.now())}
      actionLabel={uebersetzen("Usage details")}
      desktopHint={uebersetzen("Click for usage details.")}
      onActivate={() => {
        saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "limits" });
        onNavigate?.();
        void navigate({ to: "/usage" });
      }}
      glyph={
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground"
        >
          {/* Keep the ring aligned with its label instead of inheriting negative icon margins. */}
          <svg viewBox="0 0 32 32" className="size-8" fill="none" data-composer-control-icon>
            <circle
              cx="16"
              cy="16"
              r="14.5"
              strokeWidth="2.2"
              className="stroke-current opacity-25"
            />
            {percent !== null ? (
              <circle
                cx="16"
                cy="16"
                r="14.5"
                pathLength="100"
                strokeWidth="2.2"
                strokeDasharray={`${percent} 100`}
                transform="rotate(-90 16 16)"
                className="stroke-current"
              />
            ) : null}
            {elapsedDays !== null
              ? Array.from({ length: 7 }, (_, day) => {
                  const start = (day * 360) / 7 + 3;
                  const end = ((day + 1) * 360) / 7 - 3;
                  const fraction = Math.max(0, Math.min(1, elapsedDays - day));
                  return (
                    <g key={day}>
                      <path
                        d={dayArc(start, end)}
                        strokeWidth="1.15"
                        className="stroke-current opacity-25"
                      />
                      {fraction > 0 ? (
                        <path
                          d={dayArc(start, start + (end - start) * fraction)}
                          strokeWidth="1.15"
                          className="stroke-current opacity-85"
                        />
                      ) : null}
                    </g>
                  );
                })
              : null}
            <text
              x="16"
              y={banked ? 15.6 : 18.8}
              textAnchor="middle"
              className="fill-current text-4xs font-medium tabular-nums"
            >
              {percent === null ? "?" : `${percent}%`}
            </text>
            {banked ? (
              <text
                x="16"
                y="23.5"
                textAnchor="middle"
                className={cn(
                  "fill-current text-5xs font-medium tabular-nums",
                  autoRedeemAtWeeklyLimit
                    ? "text-info-foreground"
                    : expiringSoon && "text-reset-expiry-foreground",
                )}
              >
                +{banked}
              </text>
            ) : null}
          </svg>
        </span>
      }
    >
      <div className="flex max-h-[calc(100dvh-5rem)] flex-col gap-2 overflow-y-auto text-left">
        <div className="font-medium">{title}</div>
        <div>
          {summary.capacityUnavailable
            ? uebersetzen(
                "Combined percentage unavailable: plan capacities are unknown or not comparable.",
              )
            : percent === null
              ? uebersetzen("No account-wide seven-day limit reported.")
              : uebersetzen("{wert1}% remaining", { wert1: percent })}
          {summary.members.length > 1 && !summary.capacityUnavailable
            ? uebersetzen(" · {wert1} accounts, weighted by plan allowance", {
                wert1: summary.members.length,
              })
            : null}
        </div>
        <div>
          {summary.elapsedDays === null
            ? uebersetzen("Weekly period elapsed: not reported")
            : uebersetzen("Weekly period elapsed: {wert1} of 7 days{wert2}", {
                wert1: summary.elapsedDays.toFixed(1),
                wert2:
                  summary.members.length > 1
                    ? ` (average of ${summary.reportedPeriods} accounts)`
                    : "",
              })}
          {summary.reportedPeriods < summary.members.length
            ? uebersetzen("; {wert1} periods not reported.", {
                wert1: summary.members.length - summary.reportedPeriods,
              })
            : null}
        </div>
        <div>
          {banked === null
            ? uebersetzen("Banked resets: not reported")
            : uebersetzen("Banked resets{wert1}: {wert2}", {
                wert1: accounts.length > 1 ? " (total)" : "",
                wert2: banked,
              })}
          {banked !== null && summary.unreportedResetCredits > 0
            ? uebersetzen("; {wert1} accounts not reported.", {
                wert1: summary.unreportedResetCredits,
              })
            : null}
          {summary.members.length === 1 ? (
            <BankedResetExpiry
              credits={summary.members[0]!.account.limits.resetCredits}
              now={now}
            />
          ) : null}
        </div>
        <div>
          {summary.nextResetAt && Date.parse(summary.nextResetAt) <= now
            ? uebersetzen("Reported reset {wert1}; awaiting updated limits.", {
                wert1: time(summary.nextResetAt),
              })
            : uebersetzen("Next regular reset: {wert1} (local time)", {
                wert1: summary.nextResetAt ? time(summary.nextResetAt) : "not reported",
              })}
        </div>
        {summary.members.length > 1 ? (
          summary.members.map(({ account, window, remainingPercent, elapsedDays, capacity }) => (
            <div
              key={account.key}
              role="group"
              aria-label={accountName(account)}
              className="flex flex-col gap-0.5"
            >
              <span>
                {accountName(account)}{" "}
                <span className="whitespace-nowrap tabular-nums">
                  <T>
                    (<Var>{remainingPercent}</Var>% remaining)
                  </T>
                </span>
              </span>
              <span className="text-muted-foreground">
                {account.plan ? `${account.plan} · ` : ""}
                {capacity === null
                  ? uebersetzen("Plan capacity unknown")
                  : uebersetzen("{wert1}× Plus allowance", { wert1: capacity })}
              </span>
              <span className="text-muted-foreground">
                {window.resetsAt
                  ? uebersetzen("Reset {wert1}", { wert1: time(window.resetsAt) })
                  : uebersetzen("Reset not reported")}
              </span>
              <span className="text-muted-foreground">
                {elapsedDays === null
                  ? uebersetzen("Period not reported")
                  : uebersetzen("{wert1} of 7 days elapsed", { wert1: elapsedDays.toFixed(1) })}
                {account.limits.resetCredits
                  ? uebersetzen(" · {wert1} banked resets", {
                      wert1: account.limits.resetCredits.availableCount,
                    })
                  : ""}
              </span>
              <BankedResetExpiry credits={account.limits.resetCredits} now={now} />
            </div>
          ))
        ) : summary.members[0] ? (
          <div className="text-muted-foreground">
            <div>{summary.members[0].account.plan}</div>
            <div>
              {summary.members[0].account.environments
                .map((environment) => environment.label)
                .join(", ") || summary.members[0].account.sourceLabel}
            </div>
          </div>
        ) : null}
        {summary.missing.map((account) => (
          <div key={account.key}>
            <T>
              <Var>{accountName(account)}</Var>: weekly limit unavailable
            </T>
          </div>
        ))}
        {notices.map((notice) => (
          <div key={notice}>{notice}</div>
        ))}
        <div className="text-muted-foreground">
          <T>
            Outer ring: weekly allowance remaining. Inner segments: seven days elapsed. +N: banked
            resets.
          </T>
        </div>
        <div className="text-muted-foreground">
          {summary.oldestCheckedAt
            ? uebersetzen("Updated {wert1}{wert2}. ", {
                wert1: time(summary.oldestCheckedAt),
                wert2: summary.members.length > 1 ? " (oldest report)" : "",
              })
            : null}
        </div>
      </div>
    </UsageIndicatorDetails>
  );
}

/** All connected accounts share the same deduplication and cache as the Limits page. */
export function SidebarWeeklyLimit() {
  const uebersetzen = useGT();
  const resolve = useMessages();
  const { isMobile, setOpenMobile } = useSidebar();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const accounts = collectLimitAccounts(presentations);
  const notices = collectLimitNotices(presentations, resolve);
  return (
    <SidebarMenuItem className="shrink-0">
      <WeeklyLimitIndicator
        accounts={accounts}
        notices={notices}
        title={uebersetzen("Weekly limit, all accounts")}
        render={<SidebarMenuButton size="icon" />}
        onNavigate={() => {
          if (isMobile) setOpenMobile(false);
        }}
      />
    </SidebarMenuItem>
  );
}

/** Resolve the selected instance in its own environment, even when instance ids repeat elsewhere. */
export function ComposerWeeklyLimit({
  environmentId,
  instanceId,
  size,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly size: "sm" | "xs";
}) {
  const uebersetzen = useGT();
  const resolve = useMessages();
  const autoRedeemAtWeeklyLimit = useEnvironmentSettings(
    environmentId,
    (settings) => settings.mggmCodexAutoRedeemAtWeeklyLimit,
  );
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const presentation = presentations.get(environmentId);
  const provider = presentation?.serverConfig?.providers.find(
    (provider) => provider.instanceId === instanceId,
  );
  const accounts =
    presentation && provider
      ? collectLimitAccounts(
          new Map([[environmentId, { ...presentation, serverConfig: { providers: [provider] } }]]),
        )
      : [];
  const notice = provider?.usageLimits ? limitsNotice(provider.usageLimits, resolve) : null;
  if (provider && !shouldShowWeeklyLimit(provider)) return null;
  return (
    <WeeklyLimitIndicator
      accounts={accounts}
      autoRedeemAtWeeklyLimit={provider?.driver === "codex" && autoRedeemAtWeeklyLimit}
      notices={notice ? [notice] : []}
      title={uebersetzen("Weekly limit, {wert1}", {
        wert1: provider?.displayName ?? providerClients.get(provider?.driver)?.label ?? instanceId,
      })}
      render={<ComposerControl size={size} className="px-1" data-composer-weekly-limit />}
    />
  );
}
