// One typed function per analytics event (tasks/plans/analytics.md D4, D5).
// src/ui sees only these functions and the closed types below, never an event
// name or the tracker: names and values live here, once, outside the i18n scan
// of src/ui. Every event passes `send`, which validates it against the shared
// taxonomy (events.json): in development a violation throws, in production
// the event is dropped silently.
import type { Distance } from "../core";
import type { Language } from "../locales";
import type { NoiseKind } from "../worker/protocol";
import { taxonomyProblems, type EventProps } from "./taxonomy";
import {
  umamiLinkAttributes,
  umamiLoaded,
  umamiTrack,
  type UmamiLinkAttributes,
} from "./umami";

/** How a challenge ended (optimal = MWPM weight; wrong = rejected, timed out or given up). */
// The unions are spelled out, not derived from the arrays: the i18n test of
// src/ui exempts a literal by the alias it is declared as, and an alias of an
// indexed type ((typeof X)[number]) loses its name in the checker. The arrays
// are checked against the unions here and against events.json in
// tests/intent/analytics-taxonomy.test.ts.
export type ChallengeResult = "optimal" | "valid" | "wrong";
export const CHALLENGE_RESULTS = [
  "optimal",
  "valid",
  "wrong",
] as const satisfies readonly ChallengeResult[];

/** How a challenge was shared: the URL copied, or the PNG shared or downloaded. */
export type ShareMethod = "link" | "image";
export const SHARE_METHODS = [
  "link",
  "image",
] as const satisfies readonly ShareMethod[];

/** Where a form link sits in Syndrome. */
export type FormSource = "syndrome_footer" | "challenge_result";
export const FORM_SOURCES = [
  "syndrome_footer",
  "challenge_result",
] as const satisfies readonly FormSource[];

/** Profiles of the interest form; Syndrome sends "other" (D7). */
export const ROLES = [
  "teacher",
  "university",
  "company",
  "journalist",
  "other",
] as const;
export type Role = (typeof ROLES)[number];

/** The profile Syndrome's interest links carry: no selector, the form asks (D7). */
export const INTEREST_ROLE: Role = "other";

/** Attributes to spread on an `<a>` so the tracker reports its click. */
export type LinkEventAttributes = UmamiLinkAttributes;

// Event names: the seven of events.json whose `emittedBy` lists syndrome.
const CHART_ENGAGED = "chart_engaged";
const CHALLENGE_COMPLETED = "challenge_completed";
const CHALLENGE_SHARED = "challenge_shared";
const LANG_SWITCH = "lang_switch";
const APP_LANGUAGE = "app_language";
const INTEREST_OPEN = "interest_open";
const FEEDBACK_OPEN = "feedback_open";

// The taxonomy enumerates distances as strings.
const DISTANCE_VALUE: Readonly<Record<Distance, string>> = {
  3: "3",
  5: "5",
  7: "7",
  9: "9",
};

/** The event, or null (after throwing in development) when it breaks the taxonomy. */
function validated(name: string, props: EventProps): EventProps | null {
  const problems = taxonomyProblems(name, props);
  if (problems.length === 0) return props;
  if (import.meta.env.DEV) {
    throw new Error(`analytics: ${problems.join("; ")}`);
  }
  return null;
}

/**
 * Validates and sends one event. Exported for tests only: src/ui calls the typed
 * functions below (tests/intent/analytics-taxonomy.test.ts checks no module
 * outside src/analytics imports it).
 */
export function send(name: string, props: EventProps): void {
  const valid = validated(name, props);
  if (valid === null) return;
  umamiTrack(name, valid);
}

function linkEvent(name: string, props: EventProps): LinkEventAttributes {
  const valid = validated(name, props);
  return valid === null ? {} : umamiLinkAttributes(name, valid);
}

/** Whether the tracker is loaded (src/analytics/session.ts marks the session only then). */
export function trackerLoaded(): boolean {
  return umamiLoaded();
}

/** The chart was seen for 15 s with the tab visible (D12). */
export function trackChartEngaged(model: NoiseKind): void {
  send(CHART_ENGAGED, { model });
}

/** A challenge reached its verdict (D13). */
export function trackChallengeCompleted(
  d: Distance,
  result: ChallengeResult,
): void {
  send(CHALLENGE_COMPLETED, { d: DISTANCE_VALUE[d], result });
}

/** A share completed: link copied, or image shared or downloaded (D14). */
export function trackChallengeShared(method: ShareMethod): void {
  send(CHALLENGE_SHARED, { method });
}

/** The user picked another language in the selector. */
export function trackLangSwitch(to: Language): void {
  send(LANG_SWITCH, { to });
}

/** The language the session resolved; only src/analytics/session.ts calls it (D11). */
export function trackAppLanguage(lang: Language): void {
  send(APP_LANGUAGE, { lang });
}

/** Attributes for an interest-form link (role "other", D7). */
export function interestLinkEvent(from: FormSource): LinkEventAttributes {
  return linkEvent(INTEREST_OPEN, { role: INTEREST_ROLE, from });
}

/** Attributes for a feedback-form link. */
export function feedbackLinkEvent(from: FormSource): LinkEventAttributes {
  return linkEvent(FEEDBACK_OPEN, { from });
}
