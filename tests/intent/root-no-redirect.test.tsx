// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "../../src/locales";
import { FakeWorker } from "../helpers/fake-worker";

/**
 * test_intent_root_never_redirects_by_language
 *
 * INTENCIÓN: `/syndrome/` (la URL inglesa y x-default) nunca redirige en el cliente, ni por
 *   la elección guardada ni por el idioma del navegador (tasks/plans/syndrome-es-url.md D5):
 *   quien tiene «es» ve la app en español EN `/syndrome/`, con `<html lang="es">` y el
 *   título español, sin que cambie la URL ni crezca el historial. Se arranca la app de
 *   verdad (`src/main.tsx`, con su i18n, su App y su sincronización de `lang` y título), y
 *   se vigila cualquier forma de redirigir: `history.replaceState`/`pushState`, y una
 *   navegación (`location.replace`/`assign`/`href`, que jsdom no ejecuta y anuncia en su
 *   consola virtual como «Not implemented: navigation to another Document»).
 * CONTEXTO: Google desaconseja redirigir por idioma (la x-default debe responder a todos);
 *   Umami toma la URL inicial antes que la app, así que una redirección daría páginas vistas
 *   mal atribuidas o dobles; `location.replace` costaría una carga en cada arranque de la PWA
 *   (`start_url` = `/syndrome/`).
 * EXPIRA SI: se decide redirigir por idioma (y entonces se rehace D5 con la
 *   analítica y la x-default).
 */

const ES_TITLE = (LOCALES.es as { meta: { title: string } }).meta.title;
const EN_TITLE = (LOCALES.en as { meta: { title: string } }).meta.title;

// The roots main.tsx creates, unmounted after each test: a booted app left
// mounted keeps React's scheduler busy past the jsdom teardown, and on a slow
// runner that work then throws "window is not defined" as an unhandled error
// (CI run 39398798991, 2026-10-20).
const roots: { unmount(): void }[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.doUnmock("react-dom/client");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

async function bootAtRoot() {
  window.history.replaceState(null, "", "/syndrome/?utm_source=x#panel-grid");
  const length = window.history.length;
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal(
    "Worker",
    class extends FakeWorker {
      constructor() {
        super();
      }
    },
  );
  const replace = vi.spyOn(window.history, "replaceState");
  const push = vi.spyOn(window.history, "pushState");
  // jsdom does not navigate to another document; it reports the attempt as a
  // "Not implemented: navigation to another Document" jsdomError on its
  // virtual console (Vitest exposes the JSDOM instance as `jsdom`), which is
  // not forwarded to the test's console. Listened to directly.
  const navigations: string[] = [];
  const onJsdomError = (error: Error) => {
    if (/navigation/i.test(error.message)) navigations.push(error.message);
  };
  const virtualConsole = (globalThis as unknown as { jsdom: JsdomLike }).jsdom
    .virtualConsole;
  virtualConsole.on("jsdomError", onJsdomError);
  vi.resetModules();
  vi.doMock("react-dom/client", async (importOriginal) => {
    const client = await importOriginal<typeof import("react-dom/client")>();
    return {
      ...client,
      createRoot: (...args: Parameters<typeof client.createRoot>) => {
        const root = client.createRoot(...args);
        roots.push(root);
        return root;
      },
    };
  });
  try {
    await act(async () => {
      await import("../../src/main");
    });
    await act(async () => {});
  } finally {
    virtualConsole.off("jsdomError", onJsdomError);
  }
  return { replace, push, navigations, length };
}

interface JsdomLike {
  readonly virtualConsole: {
    on(event: "jsdomError", listener: (error: Error) => void): void;
    off(event: "jsdomError", listener: (error: Error) => void): void;
  };
}

describe("test_intent_root_never_redirects_by_language", () => {
  it.each([
    ["the stored choice", "es", ["en-US", "en"]],
    ["the browser language", undefined, ["es-ES", "es"]],
  ] as const)(
    "Spanish by %s: /syndrome/ shows Spanish and stays /syndrome/",
    async (_why, stored, browser) => {
      localStorage.clear();
      if (stored !== undefined)
        localStorage.setItem("syndrome.language", stored);
      vi.spyOn(navigator, "languages", "get").mockReturnValue([...browser]);
      vi.spyOn(navigator, "language", "get").mockReturnValue(browser[0]);

      const { replace, push, navigations, length } = await bootAtRoot();

      expect(document.documentElement.lang).toBe("es");
      expect(document.title).toBe(ES_TITLE);
      expect(window.location.pathname).toBe("/syndrome/");
      expect(window.location.search).toBe("?utm_source=x");
      expect(window.location.hash).toBe("#panel-grid");
      expect(window.history.length).toBe(length);
      expect(replace).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(navigations).toEqual([]);
      // Detection stored nothing: only the selector stores.
      expect(localStorage.getItem("syndrome.language")).toBe(stored ?? null);
    },
  );
});

/**
 * test_intent_document_language_follows_the_selector
 *
 * INTENCIÓN: con la pestaña abierta, el selector de idioma cambia también `<html lang>` y
 *   `document.title` (`meta.title` del idioma elegido), ida y vuelta: `src/main.tsx` los
 *   sincroniza en cada `languageChanged` (tasks/plans/syndrome-es-url.md D5), no sólo al
 *   arrancar. Se arranca la app real y se pulsa el selector.
 * CONTEXTO: borrar `i18n.on("languageChanged", syncDocumentLanguage)`
 *   dejaba la suite verde; el lector de pantalla, la separación silábica y la pestaña se
 *   quedaban en el idioma del arranque.
 * EXPIRA SI: el cambio de idioma pasa a recargar la página (entonces el HTML de cada idioma
 *   ya trae su `lang` y su título).
 */
describe("test_intent_document_language_follows_the_selector", () => {
  it("English → Español → English: lang and title follow each choice", async () => {
    localStorage.clear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US", "en"]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    await bootAtRoot();
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe(EN_TITLE);

    for (const [code, label, title] of [
      ["es", "Español", ES_TITLE],
      ["en", "English", EN_TITLE],
    ] as const) {
      await act(async () => {
        // The brand bar's switch: a button "ES Español".
        fireEvent.click(
          screen.getByRole("button", { name: new RegExp(label) }),
        );
      });
      expect(document.documentElement.lang, code).toBe(code);
      expect(document.title, code).toBe(title);
    }
  });
});
