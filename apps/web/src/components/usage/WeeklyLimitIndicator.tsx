import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitNotices,
  limitsNotice,
  summarizeWeeklyLimits,
  type LimitAccount,
} from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactElement } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { formatGermanTimestamp } from "../../timestampFormat";
import { ComposerControl } from "../chat/ComposerControl";
import { providerClients } from "../settings/providerDriverMeta";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { UsageIndicatorDetails } from "./UsageIndicatorDetails";
import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

const EMPTY_NOTICES: readonly string[] = [];

function resetExpiringSoon(expiresAt: string | undefined | null, now: number) {
  const expiresIn = expiresAt ? Date.parse(expiresAt) - now : null;
  return expiresIn !== null && expiresIn >= 0 && expiresIn <= 120 * 60 * 60_000;
}

/** Keep the expiry attached to its account and the local timestamp on one line. */
function BankedResetExpiry({
  credits,
  now,
}: {
  readonly credits: LimitAccount["limits"]["resetCredits"];
  readonly now: number;
}) {
  return (
    <div className="flex flex-wrap gap-x-1 text-muted-foreground">
      <span className="whitespace-nowrap">Next banked reset expiry: </span>
      <span className="whitespace-nowrap">
        {credits?.availableCount === 0 ? (
          "none"
        ) : credits?.nextExpiresAt ? (
          <>
            <time
              dateTime={credits.nextExpiresAt}
              className={
                resetExpiringSoon(credits.nextExpiresAt, now)
                  ? "text-reset-expiry-foreground"
                  : undefined
              }
            >
              {formatGermanTimestamp(credits.nextExpiresAt)}
            </time>{" "}
            (local time)
          </>
        ) : (
          "not reported"
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
}: {
  readonly accounts: readonly LimitAccount[];
  readonly notices?: readonly string[];
  readonly title: string;
  readonly render: ReactElement;
  readonly onNavigate?: () => void;
}) {
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
      actionLabel="Usage details"
      desktopHint="Click for usage details."
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
                  expiringSoon && "text-reset-expiry-foreground",
                )}
              >
                +{banked}
              </text>
            ) : null}
          </svg>
        </span>
      }
    >
      <div className="flex flex-col gap-2 text-left">
        <div className="font-medium">{title}</div>
        <div>
          {percent === null ? "No account-wide seven-day limit reported." : `${percent}% remaining`}
          {summary.members.length > 1
            ? ` · ${summary.members.length} accounts, equally weighted`
            : null}
        </div>
        <div>
          {summary.elapsedDays === null
            ? "Weekly period elapsed: not reported"
            : `Weekly period elapsed: ${summary.elapsedDays.toFixed(1)} of 7 days${summary.members.length > 1 ? ` (average of ${summary.reportedPeriods} accounts)` : ""}`}
          {summary.reportedPeriods < summary.members.length
            ? `; ${summary.members.length - summary.reportedPeriods} periods not reported.`
            : null}
        </div>
        <div>
          {banked === null
            ? "Banked resets: not reported"
            : `Banked resets${accounts.length > 1 ? " (total)" : ""}: ${banked}`}
          {banked !== null && summary.unreportedResetCredits > 0
            ? `; ${summary.unreportedResetCredits} accounts not reported.`
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
            ? `Reported reset ${time(summary.nextResetAt)}; awaiting updated limits.`
            : `Next regular reset: ${summary.nextResetAt ? time(summary.nextResetAt) : "not reported"} (local time)`}
        </div>
        {summary.members.length > 1 ? (
          summary.members.map(({ account, window, remainingPercent, elapsedDays }) => (
            <div
              key={account.key}
              role="group"
              aria-label={accountName(account)}
              className="flex flex-col gap-0.5"
            >
              <span className="flex justify-between gap-3">
                <span>{accountName(account)}</span>
                <span className="shrink-0 tabular-nums">{remainingPercent}% remaining</span>
              </span>
              <span className="text-muted-foreground">
                {window.resetsAt ? `Reset ${time(window.resetsAt)}` : "Reset not reported"}
              </span>
              <span className="text-muted-foreground">
                {elapsedDays === null
                  ? "Period not reported"
                  : `${elapsedDays.toFixed(1)} of 7 days elapsed`}
                {account.limits.resetCredits
                  ? ` · ${account.limits.resetCredits.availableCount} banked resets`
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
          <div key={account.key}>{accountName(account)}: weekly limit unavailable</div>
        ))}
        {notices.map((notice) => (
          <div key={notice}>{notice}</div>
        ))}
        <div className="text-muted-foreground">
          Outer ring: weekly allowance remaining. Inner segments: seven days elapsed. +N: banked
          resets.
        </div>
        <div className="text-muted-foreground">
          {summary.oldestCheckedAt
            ? `Updated ${time(summary.oldestCheckedAt)}${summary.members.length > 1 ? " (oldest report)" : ""}. `
            : null}
        </div>
      </div>
    </UsageIndicatorDetails>
  );
}

/** All connected accounts share the same deduplication and cache as the Limits page. */
export function SidebarWeeklyLimit() {
  const { isMobile, setOpenMobile } = useSidebar();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const accounts = collectLimitAccounts(presentations);
  const notices = collectLimitNotices(presentations);
  return (
    <SidebarMenuItem className="shrink-0">
      <WeeklyLimitIndicator
        accounts={accounts}
        notices={notices}
        title="Weekly limit, all accounts"
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
  const notice = provider?.usageLimits ? limitsNotice(provider.usageLimits) : null;
  return (
    <WeeklyLimitIndicator
      accounts={accounts}
      notices={notice ? [notice] : []}
      title={`Weekly limit, ${provider?.displayName ?? providerClients.get(provider?.driver)?.label ?? instanceId}`}
      render={<ComposerControl size={size} className="px-1" data-composer-weekly-limit />}
    />
  );
}
