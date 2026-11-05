import { useState, type ReactElement, type ReactNode } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Touch opens readable details; a mouse keeps the existing hover and click action. */
export function UsageIndicatorDetails({
  label,
  render,
  glyph,
  children,
  actionLabel,
  desktopHint,
  onActivate,
  onOpen,
  wide = false,
}: {
  readonly label: string;
  readonly render: ReactElement;
  readonly glyph: ReactNode;
  readonly children: ReactNode;
  readonly actionLabel: string;
  readonly desktopHint: string;
  readonly onActivate: () => void;
  readonly onOpen?: () => void;
  readonly wide?: boolean;
}) {
  const touch = useMediaQuery("(hover: none), (pointer: coarse)");
  const [open, setOpen] = useState(false);

  if (touch) {
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) onOpen?.();
        }}
      >
        <PopoverTrigger render={render} aria-label={label}>
          {glyph}
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          width="md"
          className={wide ? "w-[36rem]" : undefined}
          padding="compact"
          tooltipStyle
          scrollable
          initialFocus={false}
        >
          <div className="flex flex-col gap-3 text-left">
            {children}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onActivate();
                }}
              >
                {actionLabel}
              </Button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    );
  }

  return (
    <Tooltip
      onOpenChange={(next) => {
        if (next) onOpen?.();
      }}
    >
      <TooltipTrigger render={render} aria-label={label} onClick={onActivate}>
        {glyph}
      </TooltipTrigger>
      <TooltipPopup side="top" className={wide ? "max-w-[calc(100vw-2rem)]" : undefined}>
        <div
          className={cn(
            "flex max-w-[calc(100vw-3rem)] flex-col gap-2 text-left",
            wide ? "w-[34rem]" : "w-72",
          )}
        >
          {children}
          <div className="text-muted-foreground">{desktopHint}</div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
