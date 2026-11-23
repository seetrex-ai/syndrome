// The viewer's presentation state that survives a reload (tasks/plans/
// phase2-g.md D6): the view (quarter turns) and the layer gap, in
// localStorage inside try/catch like model-store.ts. Neither goes in the URL:
// the link carries the shot, not how it is looked at (D8).
import { GAP_MAX, GAP_MIN, GAP_STEP, VIEWS, type View } from "./projection";

const KEYS = {
  view: "syndrome.spacetime.view", // i18n-exempt: localStorage key
  gap: "syndrome.spacetime.gap", // i18n-exempt: localStorage key
} as const;
// The literal keys, not `string`: tests/intent/path-routing.test.ts reads the
// type of every storage key and requires the `syndrome.` prefix (one origin,
// seequant.app, is shared with the brand site and the other apps).
type Key = (typeof KEYS)[keyof typeof KEYS];

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: Key): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: Key, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // The choice lives in the session only.
  }
}

export function isView(value: unknown): value is View {
  return (VIEWS as readonly unknown[]).includes(value);
}

/** A gap on the slider's grid: GAP_MIN + k·GAP_STEP within [GAP_MIN, GAP_MAX]. */
export function isGap(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value < GAP_MIN || value > GAP_MAX) return false;
  const steps = (value - GAP_MIN) / GAP_STEP;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** The stored view, or null when none, unknown or unreadable. */
export function readStoredView(): View | null {
  const value = Number(read(KEYS.view));
  return isView(value) ? value : null;
}

export function storeView(view: View): void {
  write(KEYS.view, String(view));
}

/** The stored gap, or null when none, off the grid or unreadable. */
export function readStoredGap(): number | null {
  const raw = read(KEYS.gap);
  if (raw === null) return null;
  const value = Number(raw);
  return isGap(value) ? value : null;
}

export function storeGap(gap: number): void {
  write(KEYS.gap, String(gap));
}
