// The CSS pixel width of an element, kept current through ResizeObserver.
// The chart sizes its viewBox to this width so that one SVG unit is one CSS
// pixel and its 12 px labels are 12 px on every screen (with a fixed
// 640-unit viewBox they shrank to ≈ 6.75 px on a 360 px phone).
import { useLayoutEffect, useState, type RefObject } from "react";

/** Width before the first measurement, and for ever without ResizeObserver (jsdom). */
export const DEFAULT_WIDTH = 640;
/**
 * Narrower containers still get this many units: the margins need the room, so
 * below it the whole figure shrinks instead of squeezing the axis. 288 is the
 * figure on a 320 px viewport with 16 px gutters: there
 * the 12 px labels are 12 px and the x axis keeps 184 px.
 */
export const MIN_WIDTH = 288;

export function useWidth(ref: RefObject<Element | null>): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return undefined;
    const update = (w: number) => setWidth(Math.max(MIN_WIDTH, Math.round(w)));
    update(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) update(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
