import { Toolbar } from "@base-ui/react/toolbar";
import { type ProviderInstanceId } from "@t3tools/contracts";
import { remainingPercent, weeklyLimitWindow } from "@t3tools/shared/usageLimits";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { StarIcon } from "lucide-react";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { useNowMinute } from "../../hooks/useNowMinute";
import { formatGermanTimestamp } from "../../timestampFormat";
import { resetExpiringSoon } from "../usage/resetCreditExpiry";
import {
  isProviderInstancePickerReady,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";

function describeUnavailableInstance(entry: ProviderInstanceEntry): string {
  const label = entry.displayName;
  // An unavailable instance (a driver this build lacks or the policy leaves out) says why instead.
  if ((!entry.enabled && entry.isAvailable) || entry.status === "disabled") {
    return `${label}: Disabled in settings.`;
  }
  if (entry.status === "ready" && entry.isAvailable) {
    return label;
  }
  const kind =
    entry.status === "error" ? "Unavailable" : entry.status === "warning" ? "Limited" : "Not ready";
  const msg = entry.snapshot.message?.trim();
  return msg ? `${label}: ${kind}. ${msg}` : `${label}: ${kind}.`;
}

const PICKER_TOOLTIP_SIDE = "left" as const;
const PICKER_TOOLTIP_SIDE_OFFSET = 8;

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  onFocusSearch: () => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  showFavorites?: boolean;
  disabledInstanceIds?: ReadonlySet<ProviderInstanceId>;
  selectableUnavailableInstanceIds?: ReadonlySet<ProviderInstanceId>;
  getDisabledInstanceTooltip?: (entry: ProviderInstanceEntry) => string;
}) {
  const handleSelect = (instanceId: ProviderInstanceId | "favorites") => {
    props.onSelectInstance(instanceId);
  };
  const showFavorites = props.showFavorites ?? true;
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00.000Z`);
  const [hoveredInstanceId, setHoveredInstanceId] = useState<ProviderInstanceId | null>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const [selectedIndicatorTop, setSelectedIndicatorTop] = useState<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the selected provider item's DOM offset to position the selection indicator
  useLayoutEffect(() => {
    const content = sidebarContentRef.current;
    if (!content) {
      return;
    }
    const selectedItem = Array.from(
      content.querySelectorAll<HTMLElement>("[data-model-picker-provider]"),
    ).find((item) => item.dataset.modelPickerProvider === props.selectedInstanceId);
    if (!selectedItem) {
      setSelectedIndicatorTop(null);
      return;
    }
    setSelectedIndicatorTop(selectedItem.offsetTop + selectedItem.offsetHeight / 2 - 10);
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Adding, removing or reordering providers moves the selected item, so the indicator re-measures.
    props.instanceEntries,
    props.selectedInstanceId,
    showFavorites,
  ]);

  return (
    <Toolbar.Root
      className="w-14 shrink-0 overflow-hidden bg-muted/30"
      data-model-picker-sidebar="true"
      aria-label="Providers"
      orientation="vertical"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          props.onFocusSearch();
          return;
        }
      }}
    >
      <div className="h-full overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div ref={sidebarContentRef} className="relative flex min-h-full flex-col gap-1 p-1">
          {selectedIndicatorTop !== null ? (
            <div
              data-model-picker-selected-indicator="true"
              className="pointer-events-none absolute right-1 z-10 h-5 w-0.75 rounded-full bg-primary transition-[top] duration-200 ease-out"
              style={{ top: selectedIndicatorTop }}
            />
          ) : null}
          {showFavorites ? (
            <>
              <div className="relative w-full" data-model-picker-provider="favorites">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Toolbar.Button
                        className={cn(
                          "relative isolate flex h-9 w-full cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none",
                        )}
                        onClick={() => handleSelect("favorites")}
                        type="button"
                        aria-label="Favorites"
                        aria-pressed={props.selectedInstanceId === "favorites"}
                      >
                        <StarIcon className="size-5 fill-current shrink-0" aria-hidden />
                      </Toolbar.Button>
                    }
                  />
                  <TooltipPopup
                    side={PICKER_TOOLTIP_SIDE}
                    sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                    align="center"
                  >
                    Favorites
                  </TooltipPopup>
                </Tooltip>
              </div>
              <div className="border-b border-border/70" aria-hidden="true" />
            </>
          ) : null}

          {props.instanceEntries.map((entry) => {
            const isUnavailable = !isProviderInstancePickerReady(entry);
            const isContextDisabled = props.disabledInstanceIds?.has(entry.instanceId) ?? false;
            const unavailableSelectionIsReachable =
              props.selectableUnavailableInstanceIds?.has(entry.instanceId) ?? false;
            const isDisabled =
              (isUnavailable && !unavailableSelectionIsReachable) || isContextDisabled;
            const isSelected = props.selectedInstanceId === entry.instanceId;
            const isHovered = hoveredInstanceId === entry.instanceId;
            const showInstanceBadge = shouldShowInstanceBadge(entry, props.instanceEntries);
            const limits = entry.snapshot.usageLimits;
            const weekly = limits ? weeklyLimitWindow(limits) : null;
            const percent = weekly ? remainingPercent(weekly) : null;
            const credits = limits && !limits.unavailable ? limits.resetCredits : undefined;
            const expiringSoon =
              (credits?.availableCount ?? 0) > 0 && resetExpiringSoon(credits?.nextExpiresAt, now);
            const limitLabel =
              percent === null ? "Weekly limit unavailable" : `${percent}% remaining`;
            const creditsLabel = credits ? ` · ${credits.availableCount} banked resets` : "";

            const tooltip = isUnavailable
              ? describeUnavailableInstance(entry)
              : isContextDisabled
                ? (props.getDisabledInstanceTooltip?.(entry) ?? entry.displayName)
                : entry.displayName;

            const button = (
              <Toolbar.Button
                className={cn(
                  "relative isolate flex min-h-14 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md py-1.5 transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none",
                  isDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
                )}
                data-provider-accent-color={entry.accentColor}
                onClick={() => !isDisabled && handleSelect(entry.instanceId)}
                onMouseEnter={() => setHoveredInstanceId(entry.instanceId)}
                onMouseLeave={() =>
                  setHoveredInstanceId((current) => (current === entry.instanceId ? null : current))
                }
                onFocus={() => setHoveredInstanceId(entry.instanceId)}
                onBlur={() =>
                  setHoveredInstanceId((current) => (current === entry.instanceId ? null : current))
                }
                disabled={isDisabled}
                focusableWhenDisabled={!isDisabled}
                aria-pressed={isSelected}
                type="button"
                aria-label={isUnavailable || isContextDisabled ? tooltip : entry.displayName}
                aria-description={`${limitLabel}${creditsLabel}`}
              >
                <ProviderInstanceIcon
                  driverKind={entry.driverKind}
                  displayName={entry.displayName}
                  accentColor={entry.accentColor}
                  acpRegistryAgentId={entry.acpRegistryAgentId}
                  acpRegistryIconUrl={entry.acpRegistryIconUrl}
                  showBadge={showInstanceBadge}
                  className="size-6 z-30"
                  iconClassName="size-5"
                  indicatorBackground={
                    isHovered && !isDisabled
                      ? "var(--muted)"
                      : isSelected
                        ? "var(--background)"
                        : "color-mix(in oklab, var(--muted) 30%, transparent)"
                  }
                  {...(entry.accentColor ? { badgeClassName: "h-3 min-w-3 px-0.5 text-5xs" } : {})}
                />
                <span className="flex w-10 flex-col gap-0.5">
                  <span
                    className="flex items-center justify-center gap-0.5 text-3xs leading-none tabular-nums text-muted-foreground"
                    aria-hidden="true"
                  >
                    <span>{percent === null ? "?" : `${percent}%`}</span>
                    {credits && credits.availableCount > 0 ? (
                      <span className={cn(expiringSoon && "text-reset-expiry-foreground")}>
                        +{credits.availableCount}
                      </span>
                    ) : null}
                  </span>
                  <span
                    role={percent === null ? "img" : "meter"}
                    aria-label={`${entry.displayName}: ${limitLabel}${creditsLabel}`}
                    aria-valuemin={percent === null ? undefined : 0}
                    aria-valuemax={percent === null ? undefined : 100}
                    aria-valuenow={percent ?? undefined}
                    className="h-0.75 overflow-hidden rounded-full bg-foreground/10"
                  >
                    {percent !== null ? (
                      <span
                        className="block h-full rounded-full bg-muted-foreground"
                        style={{ width: `${percent}%` }}
                      />
                    ) : null}
                  </span>
                </span>
              </Toolbar.Button>
            );

            const trigger = isDisabled ? (
              <span className="relative block w-full">{button}</span>
            ) : (
              button
            );

            return (
              <div
                key={entry.instanceId}
                className="relative w-full"
                data-model-picker-provider={entry.instanceId}
              >
                <Tooltip>
                  <TooltipTrigger render={trigger} />
                  <TooltipPopup
                    side={PICKER_TOOLTIP_SIDE}
                    sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                    align="center"
                  >
                    {tooltip}
                    <div className="mt-1 text-muted-foreground">
                      {limitLabel}
                      {creditsLabel}
                    </div>
                    {credits && credits.availableCount > 0 ? (
                      <div
                        className={cn(
                          expiringSoon ? "text-reset-expiry-foreground" : "text-muted-foreground",
                        )}
                      >
                        Next banked reset expiry:{" "}
                        {credits.nextExpiresAt
                          ? `${formatGermanTimestamp(credits.nextExpiresAt)} (local time)`
                          : "not reported"}
                      </div>
                    ) : null}
                  </TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
    </Toolbar.Root>
  );
});
