// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n, { LANGUAGE_STORAGE_KEY } from "../../src/i18n";
import { App } from "../../src/ui/App";
import { MODEL_KEY } from "../../src/ui/model/model-store";
import { GAP_MAX } from "../../src/ui/spacetime/projection";
import { VIEWER_LAST_STEP } from "../../src/ui/spacetime/viewer-steps";
import { LAST_STEP } from "../../src/ui/steps/step-machine";
import { THEME_STORAGE_KEY } from "../../src/ui/theme/theme";
import { STORAGE_KEYS } from "../../tools/video/capture";
import { APP_HIDDEN, HOOKS, PANELS } from "../../tools/video/hooks";
import { hasKey, LANGS, t } from "../../tools/video/i18n";
import { SCENES } from "../../tools/video/scenes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const buttonIn = (root: Element, text: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text);

function press(root: Element, text: string): void {
  const button = buttonIn(root, text);
  if (button === undefined) throw new Error(`button "${text}" not rendered`);
  fireEvent.click(button);
}

/**
 * test_intent_video_hooks_exist
 *
 * INTENCIÓN: cada selector de `HOOKS` (raíz, mostrados, ocultos), cada selector de
 *   `APP_HIDDEN` y cada clave de `BUTTON` de tools/video/hooks.ts resuelve en el DOM
 *   renderizado de la app, en `en` y en `es`, sobre el último paso de cada recorrido y con
 *   la tirada 2D de la escena (`Math.random` fijo a su semilla): el script del vídeo nunca
 *   busca un gancho que la app no tenga, y una regla de ocultación nunca se queda obsoleta
 *   en silencio. Además, las claves de `localStorage` que el script fija son las constantes
 *   de la app (las tres exportadas, por igualdad; `view` y `gap`, que la app no exporta, por su
 *   efecto: `data-view`/`data-gap` del visor al montar con valores no por defecto), y sin
 *   Worker la gráfica dice `chart.unavailable` (sólo la base validada).
 * CONTEXTO: `test_intent_viewer_hooks_are_stable` sólo cubre el visor; el paso a paso y la
 *   gráfica entran aquí (tasks/plans/video.md T-V1). No hay API de componente en
 *   producción: los ganchos DOM son el contrato (phase2-g.md D8).
 * EXPIRA SI: el vídeo deja de depender del DOM.
 */
describe("test_intent_video_hooks_exist", () => {
  const steps = SCENES.find((s) => s.panel === "steps");
  if (steps === undefined || steps.panel !== "steps") {
    throw new Error("the scenes have no steps2d scene");
  }

  it("the localStorage keys the init script sets are the app's constants", () => {
    expect(STORAGE_KEYS.language).toBe(LANGUAGE_STORAGE_KEY);
    expect(STORAGE_KEYS.model).toBe(MODEL_KEY);
    expect(STORAGE_KEYS.theme).toBe(THEME_STORAGE_KEY);
  });

  for (const lang of LANGS) {
    it(`every hook and every button exists in the rendered app (${lang})`, async () => {
      await i18n.changeLanguage(lang);
      vi.spyOn(Math, "random").mockReturnValue(steps.seed2d / 2 ** 53);
      // The viewer's keys, as the init script writes them, with values that are
      // not the defaults (view 0, gap 1.75): the viewer must mount with them.
      window.localStorage.setItem(STORAGE_KEYS.view, "1");
      window.localStorage.setItem(STORAGE_KEYS.gap, String(GAP_MAX));
      const { container } = render(<App createWorker={() => null} />);
      for (const panel of PANELS) {
        await waitFor(() => {
          expect(
            container.querySelector(HOOKS[panel].root),
            panel,
          ).not.toBeNull();
        });
      }
      const mounted = container.querySelector(HOOKS.spacetime.root)!;
      expect(mounted.getAttribute("data-view")).toBe("1");
      expect(mounted.getAttribute("data-gap")).toBe(String(GAP_MAX));
      for (const selector of APP_HIDDEN) {
        expect(container.querySelector(selector), selector).not.toBeNull();
      }
      // Walk each panel to its last step on the scene's inputs.
      const viewer = container.querySelector(HOOKS.spacetime.root)!;
      press(viewer, t(lang, "spacetime.preset.both"));
      for (let i = 0; i < VIEWER_LAST_STEP; i++)
        press(viewer, t(lang, "spacetime.next"));
      const walkthrough = container.querySelector(HOOKS.steps.root)!;
      for (let i = 0; i < LAST_STEP; i++)
        press(walkthrough, t(lang, "steps.next"));
      await waitFor(() => {
        expect(
          container.querySelector(`${HOOKS.chart.root} .chart__status`)
            ?.textContent,
        ).toBe(t(lang, "chart.unavailable"));
      });
      for (const panel of PANELS) {
        const { root, ready, shown, hidden, buttons } = HOOKS[panel];
        const element = container.querySelector(root)!;
        for (const selector of [ready, ...shown, ...hidden]) {
          expect(
            element.querySelector(selector),
            `${panel}: ${selector}`,
          ).not.toBeNull();
        }
        for (const key of buttons) {
          expect(hasKey(lang, key), key).toBe(true);
          expect(
            buttonIn(element, t(lang, key)),
            `${panel}: button ${key}`,
          ).toBeDefined();
        }
      }
      expect(walkthrough.getAttribute("data-step")).toBe(String(LAST_STEP));
      expect(viewer.getAttribute("data-step")).toBe(String(VIEWER_LAST_STEP));
    });
  }
});
