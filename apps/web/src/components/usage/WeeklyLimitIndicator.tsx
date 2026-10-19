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

import { usePrimarySettings } from "../../hooks/useSettings";
import { environmentPresentations, useEnvironmentPresentation } from "../../state/presentation";
import { formatChatTimestampTooltip } from "../../timestampFormat";
import { ComposerControl } from "../chat/ComposerControl";
import { providerClients } from "../settings/providerDriverMeta";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

const EMPTY_NOTICES: readonly string[] = [];

function accountName(account: LimitAccount) {
  return (
    account.displayName ?? providerClients.get(account.driver)?.label ?? String(account.driver)
  );
}

/** A static, neutral quota glyph; it reads snapshots and never requests a provider refresh. */
function WeeklyLimitIndicator({
  accounts,
  notices = EMPTY_NOTICES,
  title,
  render,
}: {
  readonly accounts: readonly LimitAccount[];
  readonly notices?: readonly string[];
  readonly title: string;
  readonly render: ReactElement;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const [now, setNow] = useState(() => Date.now());
  const summary = summarizeWeeklyLimits(accounts);
  const percent = summary.remainingPercent;
  const label = `${title}: ${percent === null ? "unavailable" : `${percent}% remaining`}`;
  const time = (value: string) => formatChatTimestampTooltip(value, timestampFormat);
  const navigate = useNavigate();
  return (
    <Tooltip
      onOpenChange={(open) => {
        if (open) setNow(Date.now());
      }}
    >
      <TooltipTrigger
        render={render}
        aria-label={label}
        onClick={() => {
          saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "limits" });
          void navigate({ to: "/usage" });
        }}
      >
        <span
          aria-hidden="true"
          className="relative inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground grayscale"
        >
          {/* Keep the ring aligned with its label instead of inheriting negative icon margins. */}
          <svg
            viewBox="0 0 32 32"
            className="absolute inset-0 size-7 -rotate-90"
            fill="none"
            data-composer-control-icon
          >
            <circle
              cx="16"
              cy="16"
              r="13"
              strokeWidth="2.5"
              className="stroke-current opacity-25"
            />
            {percent !== null ? (
              <circle
                cx="16"
                cy="16"
                r="13"
                pathLength="100"
                strokeWidth="2.5"
                strokeDasharray={`${percent} 100`}
                className="stroke-current"
              />
            ) : null}
          </svg>
          <span className="text-4xs leading-none font-medium tabular-nums">
            {percent === null ? "?" : `${percent}%`}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <div className="flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-2 text-left">
          <div className="font-medium">{title}</div>
          <div>
            {percent === null
              ? "No account-wide seven-day limit reported."
              : `${percent}% remaining`}
            {summary.members.length > 1
              ? ` · ${summary.members.length} accounts, equally weighted`
              : null}
          </div>
          <div>
            {summary.nextResetAt && Date.parse(summary.nextResetAt) <= now
              ? `Reported reset ${time(summary.nextResetAt)}; awaiting updated limits.`
              : `Next regular reset: ${summary.nextResetAt ? time(summary.nextResetAt) : "not reported"} (local time)`}
          </div>
          {summary.members.length > 1 ? (
            summary.members.map(({ account, window, remainingPercent }) => (
              <div key={account.key} className="flex flex-col gap-0.5">
                <span className="flex justify-between gap-3">
                  <span>{accountName(account)}</span>
                  <span className="shrink-0 tabular-nums">{remainingPercent}% remaining</span>
                </span>
                <span className="text-muted-foreground">
                  {window.resetsAt ? `Reset ${time(window.resetsAt)}` : "Reset not reported"}
                </span>
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
            {summary.oldestCheckedAt
              ? `Updated ${time(summary.oldestCheckedAt)}${summary.members.length > 1 ? " (oldest report)" : ""}. `
              : null}
            Click for usage details.
          </div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/** All connected accounts share the same deduplication and cache as the Limits page. */
export function SidebarWeeklyLimit() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const accounts = collectLimitAccounts(presentations);
  const notices = collectLimitNotices(presentations);
  return (
    <SidebarMenuItem className="shrink-0">
      <WeeklyLimitIndicator
        accounts={accounts}
        notices={notices}
        title="Weekly limit, all accounts"
        render={<SidebarMenuButton size="icon" />}
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
  const { presentation } = useEnvironmentPresentation(environmentId);
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
