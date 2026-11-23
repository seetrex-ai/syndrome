// The shared analytics taxonomy (tasks/plans/analytics.md D4). `events.json`
// is a byte-for-byte copy of the brand site's (seequant.app) taxonomy, pinned by
// sha256 in tests/intent/analytics-taxonomy.test.ts; never edit or format it
// here. This module only reads it: the validator every event passes through
// before it leaves the browser.
import events from "./events.json";

/** The emitter name of this app in the taxonomy's `emittedBy` lists. */
export const EMITTER = "syndrome";

export interface TaxonomyEvent {
  readonly emittedBy: readonly string[];
  readonly status: string;
  readonly props: Readonly<Record<string, readonly string[]>>;
}

export interface Taxonomy {
  readonly version: string;
  readonly rules: { readonly maxProps: number };
  readonly events: Readonly<Record<string, TaxonomyEvent>>;
}

export const TAXONOMY: Taxonomy = events;

/** Event properties as the tracker receives them: closed-enum strings only. */
export type EventProps = Readonly<Record<string, string>>;

/**
 * Every reason why `name` with `props` may not be sent by `emitter`; empty when
 * it may. The event must exist, be `active`, list the emitter, carry at most
 * `maxProps` properties, each declared for the event and with a value from its
 * enum. No free text, URL or identifier can pass: every value is enumerated.
 */
export function taxonomyProblems(
  name: string,
  props: EventProps,
  taxonomy: Taxonomy = TAXONOMY,
  emitter: string = EMITTER,
): string[] {
  const event = Object.hasOwn(taxonomy.events, name)
    ? taxonomy.events[name]
    : undefined;
  if (event === undefined) return [`unknown event "${name}"`];
  const problems: string[] = [];
  if (event.status !== "active") {
    problems.push(`event "${name}" is ${event.status}, not active`);
  }
  if (!event.emittedBy.includes(emitter)) {
    problems.push(`event "${name}" is not emitted by ${emitter}`);
  }
  const entries = Object.entries(props);
  if (entries.length > taxonomy.rules.maxProps) {
    problems.push(
      `event "${name}" has ${entries.length} properties (max ${taxonomy.rules.maxProps})`,
    );
  }
  for (const [key, value] of entries) {
    const allowed = Object.hasOwn(event.props, key)
      ? event.props[key]
      : undefined;
    if (allowed === undefined) {
      problems.push(`property "${key}" is not declared for "${name}"`);
    } else if (typeof value !== "string" || !allowed.includes(value)) {
      problems.push(
        `value "${String(value)}" of "${name}.${key}" is not in its enum`,
      );
    }
  }
  return problems;
}

/** Names of the events this app may emit (active and listing the emitter). */
export function emittableEvents(
  taxonomy: Taxonomy = TAXONOMY,
  emitter: string = EMITTER,
): string[] {
  return Object.entries(taxonomy.events)
    .filter(
      ([, event]) =>
        event.status === "active" && event.emittedBy.includes(emitter),
    )
    .map(([name]) => name);
}
