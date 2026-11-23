// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n, { LANGUAGE_STORAGE_KEY } from "../../src/i18n";
import { App } from "../../src/ui/App";
import { LEVEL_P } from "../../src/ui/challenge/score";
import { drawPuzzle, encodePuzzle } from "../../src/ui/challenge/puzzle";
import { fakeWorkerFactory } from "../helpers/fake-worker";

/**
 * test_scenario_language_switch_keeps_the_puzzle
 *
 * Con la App real (tasks/plans/syndrome-es-url.md D6): se abre un reto compartido
 * (`/syndrome/?ref=x#c=<puzle>`), se empieza a jugar y se marca un cúbit; el selector pasa a
 * «Español»: la URL es `/syndrome/es/` con la MISMA consulta y el MISMO `#c=`, sin recargar
 * (el reto sigue en juego con el cúbit marcado y los mismos defectos, y el enlace para
 * compartir lleva el mismo puzle), sin entrada nueva en el historial
 * (`replaceState`, no `pushState`), con «es» guardado en `syndrome.language` y un solo
 * `lang_switch`. La vuelta a «English» deja `/syndrome/` con el mismo fragmento, guarda «en»
 * y suma el segundo `lang_switch`. Un ancla `#panel-grid` también se conserva.
 */

const SEED = 3;
const PUZZLE = encodePuzzle(drawPuzzle(3, LEVEL_P[3], () => SEED));
const HASH = `#c=${PUZZLE}`;

const panel = () => document.querySelector(".panel--challenge") as HTMLElement;
const attr = (selector: string, name: string) =>
  document.querySelector(selector)?.getAttribute(name);
// The switch lives in the brand bar since 2026-10-20: the
// other language is a button named "ES Español" / "EN English" there.
const languageRadio = (code: string) =>
  within(document.querySelector<HTMLElement>("header.site-header")!).getByRole(
    "button",
    { name: new RegExp(i18n.t(`language.${code}`)) },
  );
const shareUrl = () =>
  (
    screen.getByRole("textbox", {
      name: i18n.t("challenge.shareUrl"),
    }) as HTMLInputElement
  ).value;
const defects = () =>
  [...panel().querySelectorAll('[data-defect="1"]')].map(
    (el) =>
      `${el.getAttribute("data-type")}${el.getAttribute("data-plaquette")}`,
  );

function clickQubit(q: number) {
  const el = panel().querySelector(`[data-qubit="${q}"]`)!;
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
  });
  fireEvent.pointerUp(el, { pointerId: 1 });
}

let calls: { name: string; props: Record<string, string> }[] = [];
const switches = () => calls.filter((c) => c.name === "lang_switch");

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal("umami", {
    track: (name: string, props: Record<string, string>) => {
      calls.push({ name, props: { ...props } });
    },
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
});

/**
 * test_intent_shared_puzzle_link_is_language_neutral
 *
 * INTENCIÓN: el enlace para compartir un reto apunta siempre a la base neutra
 *   (`/syndrome/#c=…`), aunque el reto se juegue en `/syndrome/es/`: quien lo abre lo ve en su
 *   propio idioma (lo guardado o el del navegador), nunca en el de quien lo compartió.
 * CONTEXTO: la ruta fija el idioma (tasks/plans/syndrome-es-url.md D4), así que un enlace
 *   desde `/syndrome/es/` imponía el español; se decidió «cada uno con su idioma»
 *   (2026-10-20).
 * EXPIRA SI: se decide que el enlace lleve el idioma de quien comparte.
 */
describe("test_intent_shared_puzzle_link_is_language_neutral", () => {
  it("a puzzle started on /syndrome/es/ shares /syndrome/#c=…", async () => {
    window.history.replaceState(null, "", `/syndrome/es/${HASH}`);
    // What loading /syndrome/es/ leaves: the path detector runs at i18n init
    // (tests/intent/language-path.test.ts), not when App renders.
    await i18n.changeLanguage("es");
    render(<App createWorker={fakeWorkerFactory().create} />);
    expect(i18n.resolvedLanguage).toBe("es");
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("challenge.begin") }),
    );
    expect(shareUrl()).toBe(`${window.location.origin}/syndrome/${HASH}`);
  });
});

describe("test_scenario_language_switch_keeps_the_puzzle", () => {
  it("a shared puzzle in play: Español and back keep the URL's query and #c=, the game and the history", async () => {
    window.history.replaceState(null, "", `/syndrome/?ref=x${HASH}`);
    render(<App createWorker={fakeWorkerFactory().create} />);
    expect(i18n.resolvedLanguage).toBe("en");
    expect(attr(".panel--challenge", "data-phase")).toBe("ready");
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("challenge.begin") }),
    );
    expect(attr(".panel--challenge", "data-phase")).toBe("playing");
    clickQubit(0);
    expect(attr('.panel--challenge [data-qubit="0"]', "data-pauli")).toBe("X");
    const board = defects();
    expect(board.length).toBeGreaterThan(0);
    expect(shareUrl()).toBe(`${window.location.origin}/syndrome/${HASH}`);
    const length = window.history.length;

    await act(async () => {
      fireEvent.click(languageRadio("es"));
    });
    expect(i18n.resolvedLanguage).toBe("es");
    expect(window.location.pathname).toBe("/syndrome/es/");
    expect(window.location.search).toBe("?ref=x");
    expect(window.location.hash).toBe(HASH);
    expect(window.history.length).toBe(length);
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("es");
    expect(switches()).toEqual([{ name: "lang_switch", props: { to: "es" } }]);
    // The same game, not a reload: still playing, the mark kept, the same board.
    expect(attr(".panel--challenge", "data-phase")).toBe("playing");
    expect(attr('.panel--challenge [data-qubit="0"]', "data-pauli")).toBe("X");
    expect(defects()).toEqual(board);
    expect(shareUrl()).toBe(`${window.location.origin}/syndrome/${HASH}`);

    await act(async () => {
      fireEvent.click(languageRadio("en"));
    });
    expect(i18n.resolvedLanguage).toBe("en");
    expect(window.location.pathname).toBe("/syndrome/");
    expect(window.location.search).toBe("?ref=x");
    expect(window.location.hash).toBe(HASH);
    expect(window.history.length).toBe(length);
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(switches()).toEqual([
      { name: "lang_switch", props: { to: "es" } },
      { name: "lang_switch", props: { to: "en" } },
    ]);
    expect(attr(".panel--challenge", "data-phase")).toBe("playing");
    expect(attr('.panel--challenge [data-qubit="0"]', "data-pauli")).toBe("X");
    expect(defects()).toEqual(board);
  });

  it("an anchor (#panel-grid) is kept too", async () => {
    window.history.replaceState(null, "", "/syndrome/#panel-grid");
    render(<App createWorker={fakeWorkerFactory().create} />);
    const length = window.history.length;
    await act(async () => {
      fireEvent.click(languageRadio("es"));
    });
    expect(window.location.pathname).toBe("/syndrome/es/");
    expect(window.location.hash).toBe("#panel-grid");
    expect(window.history.length).toBe(length);
    await act(async () => {
      fireEvent.click(languageRadio("en"));
    });
    expect(window.location.pathname).toBe("/syndrome/");
    expect(window.location.hash).toBe("#panel-grid");
    expect(window.history.length).toBe(length);
  });
});

/**
 * test_scenario_back_shows_the_language_of_the_entry
 *
 * tasks/plans/syndrome-es-url.md D6: el selector reescribe sólo la entrada
 * actual del historial (`replaceState`), así que «Atrás» puede volver a una entrada de la
 * página del otro idioma. Se abre `/syndrome/es/` en español, un ancla añade una entrada
 * (`#panel-grid`), se elige «English» (la entrada pasa a `/syndrome/#panel-grid`) y se pulsa
 * «Atrás»: `/syndrome/es/` vuelve a verse en español, sin guardar nada (lo guardado sigue
 * siendo la elección «en») y sin otro `lang_switch`. «Adelante» vuelve a
 * `/syndrome/#panel-grid` en inglés, lo que mostraría cargarla (la elección guardada).
 */
describe("test_scenario_back_shows_the_language_of_the_entry", () => {
  const traverse = (step: () => void) =>
    act(
      () =>
        new Promise<void>((resolve) => {
          window.addEventListener("popstate", () => resolve(), { once: true });
          step();
        }),
    );

  it("/syndrome/es/ → #panel-grid → English → Back → Spanish → Forward → English", async () => {
    window.history.replaceState(null, "", "/syndrome/es/");
    await i18n.changeLanguage("es");
    render(<App createWorker={fakeWorkerFactory().create} />);
    window.history.pushState(null, "", "/syndrome/es/#panel-grid");
    await act(async () => {
      fireEvent.click(languageRadio("en"));
    });
    expect(window.location.pathname).toBe("/syndrome/");
    expect(i18n.resolvedLanguage).toBe("en");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");

    await traverse(() => window.history.back());
    expect(window.location.pathname).toBe("/syndrome/es/");
    expect(window.location.hash).toBe("");
    expect(i18n.resolvedLanguage).toBe("es");
    expect(
      document.querySelector(".lang-switch [aria-current]")?.textContent,
    ).toBe("ESEspañol");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");

    await traverse(() => window.history.forward());
    expect(window.location.pathname).toBe("/syndrome/");
    expect(window.location.hash).toBe("#panel-grid");
    expect(i18n.resolvedLanguage).toBe("en");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(switches()).toEqual([{ name: "lang_switch", props: { to: "en" } }]);
  });
});
