// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { decodeSpacetimeTrace } from "../../src/ui/model/spacetime-trace";
import { STEP_INTERVAL_MS } from "../../src/ui/steps/step-machine";
import { GAP_MAX } from "../../src/ui/spacetime/projection";
import { SpacetimePanel } from "../../src/ui/spacetime/SpacetimePanel";
import { VIEWER_LAST_STEP } from "../../src/ui/spacetime/viewer-steps";

// decodeSpacetimeTrace wrapped by a spy (the real function still runs).
vi.mock("../../src/ui/model/spacetime-trace", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../../src/ui/model/spacetime-trace")>();
  return { ...mod, decodeSpacetimeTrace: vi.fn(mod.decodeSpacetimeTrace) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

const button = (key: string): HTMLButtonElement => {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(".panel--spacetime button"),
  ].find((b) => b.textContent === i18n.t(key));
  if (found === undefined) throw new Error(`button ${key} not rendered`);
  return found;
};

function walkEverything() {
  for (let i = 0; i < VIEWER_LAST_STEP; i++)
    fireEvent.click(button("spacetime.next"));
  fireEvent.click(button("spacetime.prev"));
  fireEvent.click(button("spacetime.restart"));
  fireEvent.click(button("spacetime.play"));
  act(() => {
    vi.advanceTimersByTime(STEP_INTERVAL_MS * (VIEWER_LAST_STEP + 1));
  });
  fireEvent.click(screen.getByLabelText(i18n.t("spacetime.view.right")));
  const gap = document.querySelector(
    ".spacetime__gap input",
  ) as HTMLInputElement;
  fireEvent.change(gap, { target: { value: String(GAP_MAX) } });
}

/**
 * test_intent_viewer_trace_computed_once
 *
 * INTENCIÓN: el visor no vuelve a decodificar. Una historia se decodifica una vez en un
 *   `SpacetimeTrace` inmutable y los seis pasos (adelante, atrás, repetir, reproducir), la
 *   vista y la separación sólo eligen cómo se dibuja (tasks/plans/phase2-g.md D3, D6); como
 *   `test_intent_trace_computed_once` para el paso a paso 2D.
 * CONTEXTO: la proyección es derivada, la decodificación no; un `decodeSpacetimeTrace`
 *   dentro de un handler o del reductor enrojece aquí. Bajo `StrictMode` también.
 * EXPIRA SI: los pasos pasan a ser una animación continua del decodificador.
 */
describe("test_intent_viewer_trace_computed_once", () => {
  const spy = vi.mocked(decodeSpacetimeTrace);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(5 / 2 ** 53);
  });

  it("mount decodes once; a preset once more; walking, playing, view and gap decode nothing new", () => {
    spy.mockClear();
    render(<SpacetimePanel d={3} />);
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.click(button("spacetime.preset.both"));
    expect(spy).toHaveBeenCalledTimes(2);
    const shown = spy.mock.results[1]!.value;
    walkEverything();
    expect(
      document.querySelector(".panel--spacetime")?.getAttribute("data-step"),
    ).toBe(String(VIEWER_LAST_STEP));
    expect(
      document.querySelector(".panel--spacetime")?.getAttribute("data-view"),
    ).toBe("1");
    expect(spy).toHaveBeenCalledTimes(2);
    // The residual the verdict step draws is the one decoded once.
    expect(shown.verdict).toBe(0);
    expect(document.querySelector(".spacetime__verdict")?.textContent).toBe(
      i18n.t("grid.verdict.ok"),
    );
  });

  it("a copied link, a challenge link or a bad viewer link arriving by hashchange decode nothing new; a good viewer link decodes once", async () => {
    spy.mockClear();
    const { rerender } = render(
      <SpacetimePanel d={3} link="#v=f3.AAAAAAAAAAAAA" />,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await act(async () => {
      fireEvent.click(button("spacetime.copy"));
    });
    expect(spy).toHaveBeenCalledTimes(1);
    rerender(<SpacetimePanel d={3} link="#c=i3.gAA" />);
    expect(spy).toHaveBeenCalledTimes(1);
    rerender(<SpacetimePanel d={3} link="#v=f3.zzz" />);
    expect(spy).toHaveBeenCalledTimes(1);
    rerender(<SpacetimePanel d={3} link="#v=f3.gAAAAAAAAAAAA" />);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("holds under StrictMode: navigating adds no decode calls", () => {
    render(
      <StrictMode>
        <SpacetimePanel d={3} />
      </StrictMode>,
    );
    fireEvent.click(button("spacetime.preset.flip"));
    const afterPreset = spy.mock.calls.length;
    walkEverything();
    expect(spy.mock.calls.length).toBe(afterPreset);
  });
});

/**
 * test_intent_viewer_hooks_are_stable
 *
 * INTENCIÓN: el DOM del visor es el contrato del vídeo (`tools/video/`, tarea aparte) y de
 *   los tests: `section.panel--spacetime[data-step][data-view][data-gap][data-verdict]`,
 *   `svg[data-distance]`, `[data-layer]` por capa, `[data-edge="space|time"]`,
 *   `[data-defect]`, `[data-measured]`, `[data-flip]`, `[data-new]`, `[data-correction]`,
 *   `[data-residual]` y los botones con su nombre accesible (`spacetime.prev/next/play/
 *   pause/restart/newShot`, los tres `[data-preset]`). Un script fija el idioma con
 *   `localStorage["syndrome.language"]` y carga `#v=` para una tirada elegida
 *   (tasks/plans/phase2-g.md D8). **Dónde vive cada gancho:** el plano
 *   `[role="img"][data-layer=ℓ]` lleva las lecturas (`[data-plaquette][data-measured]`) y
 *   los cúbits en reposo (`[data-qubit][data-row][data-col][data-rest="1"]`, sin historia);
 *   la historia de la capa ℓ vive sólo en `[data-overlay] [data-layer=ℓ]`, en dos pasadas:
 *   primero los defectos de todas las capas, `[data-overlay] >
 *   [data-defects] > [data-layer=ℓ] > [data-defect]`; después, un grupo por capa
 *   `[data-overlay] > [data-layer=ℓ]` con `[data-flip]`,
 *   `[data-qubit][data-pauli][data-new][data-correction][data-residual]` y
 *   `[data-between=ℓ] [data-edge="space"|"time"][data-type="X"|"Z"]`. La lista de pasos es
 *   `.spacetime__steps [data-done="0"|"1"]` con `aria-current="step"` en el actual. Un cúbit
 *   del plano con `data-pauli="I"` fijo era un valor falso (el mismo cúbit decía `I` en el
 *   plano y `X` en el overlay).
 * CONTEXTO: no hay API de componente ni global en producción; los ganchos DOM son lo que
 *   Playwright usa de todos modos.
 * EXPIRA SI: el vídeo deja de depender del DOM.
 */
describe("test_intent_viewer_hooks_are_stable", () => {
  it("every hook of D8 exists in the rendered DOM on the last step of the preset with both mechanisms", () => {
    vi.useFakeTimers();
    render(<SpacetimePanel d={3} />);
    fireEvent.click(button("spacetime.preset.both"));
    for (let i = 0; i < VIEWER_LAST_STEP; i++)
      fireEvent.click(button("spacetime.next"));
    const panel = document.querySelector("section.panel--spacetime")!;
    for (const attribute of [
      "data-step",
      "data-view",
      "data-gap",
      "data-verdict",
      "data-from-link",
      "data-distance",
    ]) {
      expect(panel.getAttribute(attribute), attribute).not.toBeNull();
    }
    // A plane's qubit is at rest: no history attribute on it, ever.
    expect(
      panel.querySelector(
        '[role="img"] [data-pauli], [role="img"] [data-new], [role="img"] [data-correction], [role="img"] [data-residual], [role="img"] [data-defect], [role="img"] [data-flip], [role="img"] [data-edge]',
      ),
    ).toBeNull();
    expect(panel.querySelector("[data-overlay] [data-rest]")).toBeNull();
    for (const selector of [
      "svg[data-distance]",
      '[role="img"][data-layer]',
      "[data-overlay] [data-layer]",
      '[role="img"][data-layer] [data-plaquette][data-measured="1"]',
      '[role="img"][data-layer] [data-qubit][data-row][data-col][data-rest="1"]',
      '[data-overlay] > [data-layer] > [data-between] > [data-edge="space"][data-type="Z"]',
      '[data-overlay] > [data-layer] > [data-between] > [data-edge="time"][data-type="X"]',
      '[data-overlay] > [data-defects] > [data-layer] > [data-defect="1"][data-type][data-plaquette]',
      '[data-overlay] > [data-layer] > [data-flip="1"][data-type][data-plaquette]',
      '.spacetime__steps [data-done="1"][aria-current="step"]',
      '[data-overlay] [data-layer] [data-qubit][data-new="1"]',
      '[data-overlay] [data-layer] [data-qubit][data-pauli="X"]',
      '[data-overlay] [data-layer] [data-qubit]:not([data-correction="I"])',
      "[data-overlay] [data-layer] [data-qubit][data-residual]",
      '[data-preset="flip"]',
      '[data-preset="data"]',
      '[data-preset="both"]',
      "[data-layer-summary]",
      ".spacetime__verdict[data-verdict]",
    ]) {
      expect(panel.querySelector(selector), selector).not.toBeNull();
    }
    for (const key of [
      "spacetime.prev",
      "spacetime.play",
      "spacetime.next",
      "spacetime.restart",
      "spacetime.newShot",
      "spacetime.copy",
    ]) {
      expect(button(key)).toBeInstanceOf(HTMLButtonElement);
    }
    fireEvent.click(button("spacetime.play"));
    expect(button("spacetime.pause")).toBeInstanceOf(HTMLButtonElement);
    // One live region for the step text and the verdict; no second role="status".
    expect(panel.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(panel.querySelectorAll('[role="status"]')).toHaveLength(0);
  });
});
