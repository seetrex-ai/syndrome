// The only module that touches the Umami tracker (tasks/plans/analytics.md D1,
// D4). The tracker (vendor/umami/script.js, injected by the build only when a
// website ID exists) defines `window.umami` when it runs; without it (dev,
// previews, production before the account exists) every call is a no-op.
// tests/intent/analytics-taxonomy.test.ts checks that "umami" and
// "data-umami-event" appear in no other module under src/ but events.ts.
import type { EventProps } from "./taxonomy";

interface UmamiTracker {
  track(name: string, data?: EventProps): unknown;
}

function tracker(): UmamiTracker | undefined {
  const candidate = (globalThis as { umami?: Partial<UmamiTracker> }).umami;
  return typeof candidate?.track === "function"
    ? (candidate as UmamiTracker)
    : undefined;
}

/** Whether the tracker has loaded and can send. */
export function umamiLoaded(): boolean {
  return tracker() !== undefined;
}

/**
 * Sends one custom event if the tracker is loaded. The caller has already
 * validated it against the taxonomy. A tracker error never reaches the app:
 * analytics must not break a game.
 */
export function umamiTrack(name: string, props: EventProps): void {
  const umami = tracker();
  if (umami === undefined) return;
  try {
    // The tracker returns a promise and swallows network errors itself.
    void umami.track(name, props);
  } catch {
    // Ignore: counting less is better than breaking the page.
  }
}

/** Attributes for an `<a>` the tracker reports on click (the tracker sends them as-is). */
export type UmamiLinkAttributes = Readonly<Record<string, string>>;

/**
 * The `data-umami-event*` attributes for a link: the tracker listens for clicks
 * on such links, sends the event, then navigates (D5).
 */
export function umamiLinkAttributes(
  name: string,
  props: EventProps,
): UmamiLinkAttributes {
  const attributes: Record<string, string> = { "data-umami-event": name };
  for (const [key, value] of Object.entries(props)) {
    attributes[`data-umami-event-${key}`] = value;
  }
  return attributes;
}
