import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";

/** A touch hold sends the alternate follow-up once, consuming the following click. */
export function useTouchAlternateSubmit(enabled: boolean, onAlternate: (() => void) | undefined) {
  const press = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const consumeClick = useRef(false);
  const touch = useRef(false);
  const alternate = useStableCallback(() => onAlternate?.());
  const cancel = useStableCallback(() => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- A disabled action must cancel an outstanding pointer timer.
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);
  // oxlint-disable-next-line t3code/react-effect-budget -- Browser visibility and focus changes must cancel the pointer gesture and its timer.
  useEffect(() => {
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [cancel]);

  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      cancel();
      consumeClick.current = false;
      touch.current = event.pointerType === "touch";
      if (
        !enabled ||
        !onAlternate ||
        !touch.current ||
        event.button !== 0 ||
        event.isPrimary === false
      )
        return;
      press.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        timer: setTimeout(() => {
          press.current = null;
          consumeClick.current = true;
          alternate();
        }, 550),
      };
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const active = press.current;
      if (!active || active.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > 12) {
        consumeClick.current = true;
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu(event: MouseEvent<HTMLButtonElement>) {
      if (enabled && touch.current) event.preventDefault();
    },
    consume(event: MouseEvent<HTMLButtonElement>) {
      if (!consumeClick.current) return false;
      consumeClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
  };
}
