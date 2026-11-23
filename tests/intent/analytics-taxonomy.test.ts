import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHALLENGE_RESULTS,
  FORM_SOURCES,
  ROLES,
  SHARE_METHODS,
  feedbackLinkEvent,
  interestLinkEvent,
  send,
  trackAppLanguage,
  trackChallengeCompleted,
  trackChallengeShared,
  trackChartEngaged,
  trackLangSwitch,
  type LinkEventAttributes,
} from "../../src/analytics/events";
import {
  TAXONOMY,
  emittableEvents,
  taxonomyProblems,
  type EventProps,
} from "../../src/analytics/taxonomy";
import { DISTANCES } from "../../src/core";
import { SUPPORTED_LANGUAGES } from "../../src/locales";
import { NOISE_KINDS } from "../../src/ui/model/noise-kinds";
import { walk } from "./ui-sources";

const ROOT = process.cwd();
const EVENTS_JSON = join(ROOT, "src", "analytics", "events.json");

// The brand site's (seequant.app) taxonomy, version 1.0.0 of 2026-10-19
// (tasks/plans/analytics.md §0, measured again on 2026-10-19).
const PINNED_SHA256 =
  "0bc45ab26dc6a3c850c73d01ac03773c2a62143db4ac18cf03bef3cd7901f1ad";
const PINNED_VERSION = "1.0.0";

// The commit that adopts the version writes the docs/decisiones.md entry (version + sha256)
// and flips this to true in the same commit. While false, the test fails as
// soon as the entry exists, so the flip cannot be forgotten.
const DECISIONS_ENTRY_WRITTEN = true;
const DECISIONS = join(ROOT, "docs", "decisiones.md");

// The seven events of version 1.0.0 whose `emittedBy` lists syndrome.
const SYNDROME_EVENTS = [
  "lang_switch",
  "interest_open",
  "feedback_open",
  "chart_engaged",
  "challenge_completed",
  "challenge_shared",
  "app_language",
].sort();

/**
 * test_intent_taxonomy_copy_is_pinned
 *
 * INTENCIÓN: la taxonomía de eventos es un contrato compartido con la web de marca
 *   (un solo sitio de Umami): Syndrome guarda una copia byte a byte de
 *   la taxonomía de la web de marca (seequant.app) y la fija por sha256 y versión; cambiarla
 *   exige una versión nueva en la web y una línea nueva en `docs/decisiones.md`.
 * CONTEXTO: tasks/plans/analytics.md T-I1, D15. Un `npm run format`, un CRLF o una
 *   edición a mano dejarían a Syndrome validando contra otra taxonomía que la web
 *   sin que nadie lo viera.
 * EXPIRA SI: la taxonomía deja de ser compartida (Syndrome con su propio sitio de
 *   analítica) o se sirve por otra vía que una copia en el repo.
 */
describe("test_intent_taxonomy_copy_is_pinned", () => {
  const bytes = readFileSync(EVENTS_JSON);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  it("events.json is the pinned byte-for-byte copy", () => {
    expect(sha256).toBe(PINNED_SHA256);
    expect(bytes.includes(0x0d)).toBe(false);
  });

  it(`events.json is version ${PINNED_VERSION} and the validator reads it`, () => {
    const parsed = JSON.parse(bytes.toString("utf8")) as { version: string };
    expect(parsed.version).toBe(PINNED_VERSION);
    expect(TAXONOMY.version).toBe(PINNED_VERSION);
  });

  // The public tree ships without tasks/ and the decision log: skip only
  // there. In the full tree a missing docs/decisiones.md fails.
  const PUBLIC_TREE =
    !existsSync(DECISIONS) && !existsSync(join(ROOT, "tasks"));
  it.skipIf(PUBLIC_TREE)(
    "docs/decisiones.md records the version and the sha256 (active from the commit that adopts the version)",
    () => {
      const decisions = readFileSync(DECISIONS, "utf8");
      const entry = decisions
        .split(/\r?\n/)
        .find((line) => line.includes(PINNED_SHA256));
      if (!DECISIONS_ENTRY_WRITTEN) {
        expect(
          entry,
          "the entry exists: set DECISIONS_ENTRY_WRITTEN = true in this test",
        ).toBeUndefined();
        return;
      }
      expect(entry).toBeDefined();
      expect(entry).toContain("events.json");
      expect(entry).toContain(PINNED_VERSION);
    },
  );
});

// A fake tracker that records every event.
function fakeTracker() {
  const calls: { name: string; props: EventProps }[] = [];
  vi.stubGlobal("umami", {
    track: (name: string, props: EventProps) => {
      calls.push({ name, props: { ...props } });
    },
  });
  return calls;
}

// The event and props a link's data-umami-event* attributes send on click.
function linkPayload(attributes: LinkEventAttributes): {
  name: string;
  props: EventProps;
} {
  const prefix = "data-umami-event-";
  const props: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith(prefix)) props[key.slice(prefix.length)] = value;
    else expect(key).toBe("data-umami-event");
  }
  return { name: attributes["data-umami-event"] ?? "", props };
}

function enumOf(event: string, prop: string): readonly string[] {
  return TAXONOMY.events[event]?.props[prop] ?? [];
}

/**
 * test_intent_events_in_taxonomy
 *
 * INTENCIÓN: nada sale del navegador fuera de la taxonomía: cada evento que
 *   Syndrome puede emitir (todo el dominio de cada función de `events.ts`) es uno
 *   de los siete con `emittedBy ∋ syndrome`, `active`, con ≤ 2 propiedades
 *   declaradas y valores de su enum cerrado (nunca correo, texto libre, URL ni
 *   máscara de puzle); y el tracker sólo se toca desde `src/analytics`.
 * CONTEXTO: tasks/plans/analytics.md T-I3 (a, b), D1, D4. La parte DOM (c) está
 *   en tests/intent/analytics-links.test.tsx. Una tercera propiedad,
 *   un valor con la URL del reto o una llamada directa a `window.umami` desde un
 *   componente enviarían datos que la política de privacidad no declara.
 * EXPIRA SI: cambia la taxonomía (versión nueva: se revisan aquí los siete) o
 *   Syndrome deja de usar Umami.
 */
describe("test_intent_events_in_taxonomy", () => {
  let calls: { name: string; props: EventProps }[];
  beforeEach(() => {
    calls = fakeTracker();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("(a) every function over its whole domain sends only valid events, exactly the seven", () => {
    const links: { name: string; props: EventProps }[] = [];
    for (const model of NOISE_KINDS) trackChartEngaged(model);
    for (const d of DISTANCES) {
      for (const result of CHALLENGE_RESULTS)
        trackChallengeCompleted(d, result);
    }
    for (const method of SHARE_METHODS) trackChallengeShared(method);
    for (const lang of SUPPORTED_LANGUAGES) {
      trackLangSwitch(lang);
      trackAppLanguage(lang);
    }
    for (const from of FORM_SOURCES) {
      links.push(linkPayload(interestLinkEvent(from)));
      links.push(linkPayload(feedbackLinkEvent(from)));
    }

    const all = [...calls, ...links];
    const expectedCount =
      NOISE_KINDS.length +
      DISTANCES.length * CHALLENGE_RESULTS.length +
      SHARE_METHODS.length +
      2 * SUPPORTED_LANGUAGES.length +
      2 * FORM_SOURCES.length;
    expect(all).toHaveLength(expectedCount);
    for (const { name, props } of all) {
      expect(
        taxonomyProblems(name, props),
        `${name} ${JSON.stringify(props)}`,
      ).toEqual([]);
      for (const value of Object.values(props)) {
        expect(value).toMatch(/^[a-z0-9_]+$/);
      }
    }
    const names = [...new Set(all.map((call) => call.name))].sort();
    expect(names).toEqual(SYNDROME_EVENTS);
    expect([...emittableEvents()].sort()).toEqual(SYNDROME_EVENTS);
    // The click events go through attributes, never through track (D5).
    expect(calls.map((call) => call.name)).not.toContain("interest_open");
    expect(calls.map((call) => call.name)).not.toContain("feedback_open");
  });

  it("(a) each property sends every value of its taxonomy enum and nothing else", () => {
    expect([...NOISE_KINDS].sort()).toEqual(
      [...enumOf("chart_engaged", "model")].sort(),
    );
    expect(DISTANCES.map(String)).toEqual(enumOf("challenge_completed", "d"));
    expect([...CHALLENGE_RESULTS]).toEqual(
      enumOf("challenge_completed", "result"),
    );
    expect([...SHARE_METHODS]).toEqual(enumOf("challenge_shared", "method"));
    expect([...ROLES]).toEqual(enumOf("interest_open", "role"));
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(
      [...enumOf("lang_switch", "to")].sort(),
    );
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(
      [...enumOf("app_language", "lang")].sort(),
    );
    for (const from of FORM_SOURCES) {
      expect(enumOf("interest_open", "from")).toContain(from);
      expect(enumOf("feedback_open", "from")).toContain(from);
    }
    // The interest link carries role "other" (D7), the feedback link no role.
    expect(linkPayload(interestLinkEvent("syndrome_footer")).props).toEqual({
      role: "other",
      from: "syndrome_footer",
    });
    expect(linkPayload(feedbackLinkEvent("challenge_result")).props).toEqual({
      from: "challenge_result",
    });
  });

  it.each([
    [
      "an event the taxonomy does not know",
      "signup",
      { from: "syndrome_footer" },
    ],
    ["a reserved event", "interest_signup", { role: "other" }],
    [
      "an event only the web emits",
      "tool_open",
      { tool: "syndrome", from: "nav" },
    ],
    ["an email as a value", "feedback_open", { from: "ana@example.com" }],
    [
      "the challenge URL as a value",
      "challenge_shared",
      { method: "https://seequant.app/syndrome/#c=AAAA" },
    ],
    [
      "a third property",
      "challenge_completed",
      { d: "3", result: "valid", method: "link" },
    ],
    [
      "an undeclared property",
      "chart_engaged",
      { model: "independent", p: "0.05" },
    ],
    [
      "a number instead of the enum string",
      "challenge_completed",
      { d: 3 as unknown as string, result: "valid" },
    ],
  ])("(a) the validator rejects %s", (_label, name, props) => {
    expect(taxonomyProblems(name, props)).not.toEqual([]);
  });

  it("(a) each rule of the validator holds on its own (synthetic taxonomy)", () => {
    const declared = { a: ["1"], b: ["1"], c: ["1"] };
    const synthetic = {
      version: "0.0.0",
      rules: { maxProps: 2 },
      events: {
        ok: { emittedBy: ["syndrome"], status: "active", props: declared },
        reserved: {
          emittedBy: ["syndrome"],
          status: "reserved",
          props: declared,
        },
        web: { emittedBy: ["web"], status: "active", props: declared },
      },
    };
    expect(taxonomyProblems("ok", { a: "1", b: "1" }, synthetic)).toEqual([]);
    // Three declared properties with valid values: only maxProps stops them.
    expect(
      taxonomyProblems("ok", { a: "1", b: "1", c: "1" }, synthetic),
    ).toEqual([expect.stringMatching(/3 properties/)]);
    expect(taxonomyProblems("reserved", { a: "1" }, synthetic)).toEqual([
      expect.stringMatching(/reserved/),
    ]);
    expect(taxonomyProblems("web", { a: "1" }, synthetic)).toEqual([
      expect.stringMatching(/not emitted by syndrome/),
    ]);
    expect(taxonomyProblems("ok", { a: "2" }, synthetic)).toEqual([
      expect.stringMatching(/not in its enum/),
    ]);
    // Inherited names are not events or properties.
    expect(taxonomyProblems("toString", {}, synthetic)).not.toEqual([]);
    expect(taxonomyProblems("ok", { constructor: "1" }, synthetic)).not.toEqual(
      [],
    );
  });

  it("(b) the tracker and its attributes appear only in src/analytics/umami.ts and events.ts", () => {
    const allowed = new Set(
      ["umami.ts", "events.ts"].map((file) => join("src", "analytics", file)),
    );
    const offenders: string[] = [];
    const importsOfInternals: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      if (/\.test\.(ts|tsx)$/.test(rel)) continue;
      // The shared taxonomy names its own analytics product in a comment.
      if (rel === join("src", "analytics", "events.json")) continue;
      const text = readFileSync(file, "utf8");
      if (/umami/i.test(text) && !allowed.has(rel)) offenders.push(rel);
      if (!rel.startsWith(join("src", "analytics") + sep)) {
        // Outside src/analytics only the typed functions are reachable.
        for (const match of text.matchAll(
          /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
        )) {
          const [, names = "", source = ""] = match;
          if (/analytics\/(umami|taxonomy)$/.test(source)) {
            importsOfInternals.push(`${rel}: ${source}`);
          }
          if (/analytics\/events$/.test(source) && /\bsend\b/.test(names)) {
            importsOfInternals.push(`${rel}: send`);
          }
        }
        if (/from\s*["'][^"']*analytics\/(umami|taxonomy)["']/.test(text)) {
          importsOfInternals.push(`${rel}: default or namespace import`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect([...new Set(importsOfInternals)]).toEqual([]);
  });
});

/**
 * test_intent_send_rejects_outside_taxonomy
 *
 * INTENCIÓN: la validación contra la taxonomía es la última puerta antes del
 *   tracker: en desarrollo un evento fuera de ella lanza (el fallo se ve en la
 *   primera prueba), en producción se descarta en silencio (la analítica nunca
 *   rompe el juego); sin tracker no se hace nada.
 * CONTEXTO: tasks/plans/analytics.md T-I4, D4. Los tipos de `events.ts` impiden
 *   la mayoría de los errores, pero un `as`, un valor calculado o una taxonomía
 *   nueva los saltan; sin esta puerta saldrían tal cual.
 * EXPIRA SI: se cambia de política (p. ej. registrar en vez de lanzar en DEV).
 */
describe("test_intent_send_rejects_outside_taxonomy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const bad: [string, EventProps][] = [
    ["signup", { method: "link" }],
    ["challenge_shared", { method: "ana@example.com" }],
    ["challenge_shared", { method: "link", from: "syndrome_footer" }],
  ];

  it("throws in development and does not call track", () => {
    const calls = fakeTracker();
    expect(import.meta.env.DEV).toBe(true);
    for (const [name, props] of bad) {
      expect(() => send(name, props)).toThrow(/analytics/);
    }
    expect(calls).toEqual([]);
  });

  it("drops the event silently in production", () => {
    const calls = fakeTracker();
    vi.stubEnv("DEV", false);
    for (const [name, props] of bad) {
      expect(() => send(name, props)).not.toThrow();
    }
    expect(calls).toEqual([]);
    // A valid event still goes through.
    send("challenge_shared", { method: "image" });
    expect(calls).toEqual([
      { name: "challenge_shared", props: { method: "image" } },
    ]);
  });

  it("link attributes outside the taxonomy are dropped in production", () => {
    vi.stubEnv("DEV", false);
    expect(interestLinkEvent("ana@example.com" as "syndrome_footer")).toEqual(
      {},
    );
  });

  it("without the tracker a valid event neither throws nor does anything", () => {
    vi.stubGlobal("umami", undefined);
    expect(() => send("challenge_shared", { method: "link" })).not.toThrow();
    expect(() => trackLangSwitch("es")).not.toThrow();
  });

  it("a tracker that throws never reaches the app", () => {
    vi.stubGlobal("umami", {
      track: () => {
        throw new Error("network");
      },
    });
    expect(() => trackChallengeShared("link")).not.toThrow();
  });
});
