// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORM_SOURCES, type FormSource } from "../../src/analytics/events";
import {
  FORM_FALLBACK_EMAIL,
  FORM_PATHS,
  formPathProblem,
} from "../../src/analytics/forms";
import { taxonomyProblems } from "../../src/analytics/taxonomy";
import i18n from "../../src/i18n";
import { SUPPORTED_LANGUAGES, type Language } from "../../src/locales";
import { App } from "../../src/ui/App";
import { FormLinks } from "../../src/ui/footer/FormLinks";
import { fakeWorkerFactory } from "../helpers/fake-worker";

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  localStorage.clear();
  // Cleared without a fragment navigation: `location.hash = ""` queues a
  // popstate that lands after the App is mounted and the test has picked a
  // language, and Back/Forward handling (src/ui/language-url.ts) would then
  // re-detect the language of a state the app never reaches (Spanish at a
  // path that is not /syndrome/es/, nothing stored, an English browser).
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
});

const PREFIX = "data-umami-event";

/** The event and props a link's tracker attributes would send on click. */
function linkEvent(el: Element): {
  name: string;
  props: Record<string, string>;
} {
  const props: Record<string, string> = {};
  for (const attribute of el.attributes) {
    if (attribute.name.startsWith(`${PREFIX}-`)) {
      props[attribute.name.slice(PREFIX.length + 1)] = attribute.value;
    }
  }
  return { name: el.getAttribute(PREFIX) ?? "", props };
}

/** Every element carrying any tracker attribute, named or not. */
function trackedElements(): Element[] {
  return [...document.querySelectorAll("*")].filter((el) =>
    [...el.attributes].some((a) => a.name.startsWith(PREFIX)),
  );
}

/** The App with a finished challenge: footer links and end-of-challenge links. */
function renderSubmittedApp() {
  render(<App createWorker={fakeWorkerFactory().create} />);
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("challenge.start") }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("challenge.submit") }),
  );
  expect(
    document.querySelector(".panel--challenge")!.getAttribute("data-phase"),
  ).toBe("submitted");
}

const footerLinks = () => [
  ...document.querySelectorAll<HTMLAnchorElement>(".app__footer .form-links a"),
];
const challengeLinks = () => [
  ...document.querySelectorAll<HTMLAnchorElement>(".challenge__follow a"),
];

/**
 * test_intent_events_in_taxonomy (c, DOM)
 *
 * INTENCIÓN: los atributos `data-umami-event*` que la interfaz pinta son eventos de
 *   la taxonomía compartida: el contador los envía tal cual al hacer clic, sin pasar
 *   por el validador de `send`.
 * CONTEXTO: tasks/plans/analytics.md T-I3 (c), D5. Un atributo escrito a mano en JSX
 *   o un valor nuevo de `from` saldría del navegador sin validar.
 * EXPIRA SI: los enlaces dejan de contarse por atributos (D5) o la taxonomía deja de
 *   ser compartida.
 */
describe("test_intent_events_in_taxonomy (c, DOM)", () => {
  it("every tracker attribute in the App with a finished challenge passes the validator", () => {
    renderSubmittedApp();
    const tracked = trackedElements();
    expect(tracked.length).toBe(4);
    for (const el of tracked) {
      expect(el.tagName).toBe("A");
      const { name, props } = linkEvent(el);
      expect(
        taxonomyProblems(name, props),
        `${name} ${JSON.stringify(props)}`,
      ).toEqual([]);
    }
    const events = tracked.map(linkEvent);
    expect(events).toEqual(
      expect.arrayContaining([
        { name: "feedback_open", props: { from: "syndrome_footer" } },
        {
          name: "interest_open",
          props: { role: "other", from: "syndrome_footer" },
        },
        { name: "feedback_open", props: { from: "challenge_result" } },
        {
          name: "interest_open",
          props: { role: "other", from: "challenge_result" },
        },
      ]),
    );
  });
});

/**
 * test_intent_form_links_open_the_brand_forms
 *
 * INTENCIÓN: cada enlace del pie y del final del reto lleva a la página del idioma de la
 *   interfaz en el origen de marca con `role` (sólo interés), `lang` y `from`; una ruta a
 *   `null` (página no publicada) abre el correo a info@seequant.app con su asunto traducido.
 *   Misma pestaña, `rel="noopener"`, sin `target`.
 * CONTEXTO: tasks/plans/analytics.md D6–D8, T-I6. Un 404 en producción es peor que el
 *   correo; el contador sólo frena la navegación para enviar en la misma pestaña (D5).
 *   Las cuatro páginas se publicaron y midieron 200 el 2026-10-20: `FORM_PATHS` las fija.
 * EXPIRA SI: los formularios dejan de ser páginas propias de la web o cambian sus
 *   parámetros de consulta.
 */
describe("test_intent_form_links_open_the_brand_forms", () => {
  it("the tree's FORM_PATHS are null or /<lang>/<slug>/ of their own language", () => {
    for (const kind of ["interest", "feedback"] as const) {
      for (const lang of SUPPORTED_LANGUAGES) {
        const path = FORM_PATHS[kind][lang];
        if (path !== null) expect(formPathProblem(path, lang)).toBeNull();
      }
    }
  });

  // Injected as a parameter, never by editing the module (D6).
  const PATHS = {
    interest: { es: "/es/interes/", en: "/en/interest/" },
    feedback: { es: "/es/opinion/", en: "/en/feedback/" },
  } as const;
  const UNPUBLISHED = {
    interest: { es: null, en: null },
    feedback: { es: null, en: null },
  } as const;

  it("the tree links to the four pages measured 200 on 2026-10-20", () => {
    expect(FORM_PATHS).toEqual(PATHS);
  });

  it.each(SUPPORTED_LANGUAGES)(
    "with no published page, both links are mailto with their subject in %s",
    async (lang) => {
      await i18n.changeLanguage(lang);
      const t = i18n.getFixedT(lang);
      const mail = (key: string) =>
        `mailto:${FORM_FALLBACK_EMAIL}?subject=${encodeURIComponent(t(key))}`;
      expect(FORM_FALLBACK_EMAIL).toBe("info@seequant.app");
      const { container } = render(
        <FormLinks from="syndrome_footer" paths={UNPUBLISHED} />,
      );
      expect(
        [...container.querySelectorAll("a")].map((a) => a.getAttribute("href")),
      ).toEqual([
        mail("footer.mailSubject.feedback"),
        mail("footer.mailSubject.interest"),
      ]);
    },
  );

  it.each(SUPPORTED_LANGUAGES)(
    "in the App, footer and end-of-challenge links open the %s pages",
    async (lang) => {
      renderSubmittedApp();
      await act(async () => {
        await i18n.changeLanguage(lang);
      });
      const t = i18n.getFixedT(lang);
      for (const [links, from] of [
        [footerLinks(), "syndrome_footer"],
        [challengeLinks(), "challenge_result"],
      ] as const) {
        expect(links.map((a) => a.getAttribute("href"))).toEqual([
          `https://seequant.app${PATHS.feedback[lang]}?lang=${lang}&from=${from}`,
          `https://seequant.app${PATHS.interest[lang]}?role=other&lang=${lang}&from=${from}`,
        ]);
        expect(links.map((a) => a.textContent)).toEqual([
          t("footer.feedback"),
          t("footer.interest"),
        ]);
        for (const a of links) {
          expect(a.getAttribute("rel")).toBe("noopener");
          expect(a.hasAttribute("target")).toBe(false);
        }
      }
      expect(
        document.querySelector(".challenge__follow")!.textContent,
      ).toContain(t("challenge.followUp"));
    },
  );

  const cases: [Language, FormSource][] = SUPPORTED_LANGUAGES.flatMap((lang) =>
    FORM_SOURCES.map((from): [Language, FormSource] => [lang, from]),
  );

  it.each(cases)(
    "with published pages (%s, %s): the page of the UI language with role, lang and from",
    async (lang, from) => {
      await i18n.changeLanguage(lang);
      const { container } = render(<FormLinks from={from} paths={PATHS} />);
      const hrefs = [...container.querySelectorAll("a")].map((a) =>
        a.getAttribute("href"),
      );
      expect(hrefs).toEqual([
        `https://seequant.app${PATHS.feedback[lang]}?lang=${lang}&from=${from}`,
        `https://seequant.app${PATHS.interest[lang]}?role=other&lang=${lang}&from=${from}`,
      ]);
      for (const a of container.querySelectorAll("a")) {
        expect(a.getAttribute("rel")).toBe("noopener");
        expect(a.hasAttribute("target")).toBe(false);
      }
    },
  );

  it("a malformed or /syndrome/ path is refused, not linked", async () => {
    await i18n.changeLanguage("en");
    for (const bad of [
      "en/feedback/",
      "/syndrome/feedback/",
      "/es/feedback/",
    ]) {
      const paths = { ...PATHS, feedback: { ...PATHS.feedback, en: bad } };
      // React logs the render error it rethrows: silenced here.
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() =>
        render(<FormLinks from="syndrome_footer" paths={paths} />),
      ).toThrow(/form path/);
      cleanup();
    }
  });
});
