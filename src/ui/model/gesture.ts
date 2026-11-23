// Click / long-press / Shift+click on a qubit (tasks/plans/ui.md D2), with
// Pointer Events and a 400 ms timer. Scrolling must keep working on a grid
// that fills a phone screen: the <svg> keeps `touch-action: pan-x pan-y
// pinch-zoom` (never `none`), a move beyond `slopPx` cancels the press and a
// `pointercancel` (the browser took the gesture to scroll) cancels it too.
//
// A release must end the press wherever it lands. Touch implicitly captures the
// pointer, so the qubit sees it; a mouse does not, and a release outside the
// qubit would leave the timer alive to fire a spurious Z. Three nets, from the
// browser's to ours: `setPointerCapture` when the element has it (jsdom lacks
// it, R1), a window `pointerup` / `pointercancel` listener while a press is
// pending, and `pointerleave` / `lostpointercapture` on the qubit itself.
// No getBBox: positions come from `clientX/Y`.

import type { KeyboardEvent, PointerEvent } from "react";
import { useCallback, useEffect, useRef } from "react";

export interface LongPressOptions {
  /** Short press or Enter/Space; `shift` is the modifier of the release / key. */
  readonly onShort: (q: number, shift: boolean) => void;
  /** The press lasted `delayMs` without moving. */
  readonly onLong: (q: number) => void;
  readonly delayMs?: number;
  readonly slopPx?: number;
  /**
   * A pending press is cancelled when this changes. The grid passes its
   * distance: a press started on qubit `q` of one grid must not fire into
   * the grid of another distance (the same `q` is another qubit there, or
   * none at all).
   */
  readonly resetKey?: unknown;
}

export const LONG_PRESS_MS = 400;
export const SLOP_PX = 8;

export interface QubitHandlers {
  readonly onPointerDown: (event: PointerEvent<Element>) => void;
  readonly onPointerMove: (event: PointerEvent<Element>) => void;
  readonly onPointerUp: (event: PointerEvent<Element>) => void;
  readonly onPointerCancel: (event: PointerEvent<Element>) => void;
  readonly onPointerLeave: (event: PointerEvent<Element>) => void;
  readonly onLostPointerCapture: (event: PointerEvent<Element>) => void;
  readonly onKeyDown: (event: KeyboardEvent<Element>) => void;
}

interface Pending {
  q: number;
  pointerId: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
  /** The timer fired: the release must not toggle again. */
  consumed: boolean;
  /** Window `pointerup` / `pointercancel` listener, removed with the press. */
  end: (event: globalThis.PointerEvent) => void;
}

/**
 * Returns `handlersFor(q)`: the pointer and keyboard handlers of one qubit.
 * Stable while the callbacks are (pass memoised ones).
 */
export function useLongPress({
  onShort,
  onLong,
  delayMs = LONG_PRESS_MS,
  slopPx = SLOP_PX,
  resetKey,
}: LongPressOptions): (q: number) => QubitHandlers {
  const pending = useRef<Pending | null>(null);

  const cancel = useCallback(() => {
    const p = pending.current;
    if (p !== null) {
      clearTimeout(p.timer);
      pending.current = null;
      window.removeEventListener("pointerup", p.end);
      window.removeEventListener("pointercancel", p.end);
    }
  }, []);

  // A press still pending at unmount must not fire into a dead component, and
  // one pending when `resetKey` changes must not fire into another grid.
  useEffect(() => cancel, [cancel, resetKey]);

  return useCallback(
    (q: number): QubitHandlers => {
      // Any end of this pointer's press, on this element or elsewhere.
      const cancelIf = (event: { pointerId: number }) => {
        const p = pending.current;
        if (p !== null && p.pointerId === event.pointerId) cancel();
      };
      return {
        onPointerDown: (event) => {
          // Main button only: the right button opens nothing (contextmenu is
          // suppressed by the grid) and must not toggle either.
          if (event.button !== 0) return;
          cancel();
          const entry: Pending = {
            q,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            consumed: false,
            timer: setTimeout(() => {
              if (pending.current !== entry) return;
              entry.consumed = true;
              onLong(q);
            }, delayMs),
            end: (windowEvent) => {
              if (pending.current === entry) cancelIf(windowEvent);
            },
          };
          pending.current = entry;
          // A release or cancel anywhere ends the press, captured or not.
          window.addEventListener("pointerup", entry.end);
          window.addEventListener("pointercancel", entry.end);
          // Optional: jsdom has no setPointerCapture (R1); the nets above cover it.
          (event.currentTarget as Partial<Element>).setPointerCapture?.(
            event.pointerId,
          );
        },
        onPointerMove: (event) => {
          const p = pending.current;
          if (p === null || p.pointerId !== event.pointerId) return;
          if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > slopPx) {
            cancel();
          }
        },
        onPointerUp: (event) => {
          const p = pending.current;
          if (p === null || p.pointerId !== event.pointerId) return;
          const fire = !p.consumed && p.q === q;
          cancel();
          if (fire) onShort(q, event.shiftKey);
        },
        onPointerCancel: cancelIf,
        onPointerLeave: cancelIf,
        onLostPointerCapture: (event) => {
          // The event bubbles: one raised for a child (<circle>) is not the
          // qubit losing its capture, and must not cancel a legitimate touch.
          if (event.target !== event.currentTarget) return;
          cancelIf(event);
        },
        onKeyDown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          // A held key auto-repeats keydown: one press, one toggle.
          if (event.repeat) return;
          onShort(q, event.shiftKey);
        },
      };
    },
    [cancel, onShort, onLong, delayMs, slopPx],
  );
}
