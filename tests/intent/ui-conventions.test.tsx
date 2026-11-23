// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pauliEquals,
  pauliFrom,
  qubitIndex,
  type Distance,
} from "../../src/core";
import i18n from "../../src/i18n";
import { UNIT } from "../../src/ui/grid/geometry";
import { Grid } from "../../src/ui/grid/Grid";
import { GridPanel } from "../../src/ui/grid/GridPanel";
import { LONG_PRESS_MS } from "../../src/ui/model/gesture";
import { createTraceContext, decodeTrace } from "../../src/ui/model/trace";
import { LAST_STEP, STEP_INTERVAL_MS } from "../../src/ui/steps/step-machine";
import { StepsPanel } from "../../src/ui/steps/StepsPanel";

// decodeTrace wrapped by a spy (the real function still runs): the steps test
// below counts how often the UI decodes.
vi.mock("../../src/ui/model/trace", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/ui/model/trace")>();
  return { ...mod, decodeTrace: vi.fn(mod.decodeTrace) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Host() {
  const [d, setD] = useState<Distance>(3);
  const [p, setP] = useState(0.1);
  return <GridPanel d={d} onDistanceChange={setD} p={p} onPChange={setP} />;
}

function qubit(container: HTMLElement, q: number): Element {
  const el = container.querySelector(`[data-qubit="${q}"]`);
  if (el === null) throw new Error(`qubit ${q} not rendered`);
  return el;
}

const down = { pointerId: 1, clientX: 0, clientY: 0, button: 0 };

/**
 * test_intent_click_toggles_once_under_strict_mode
 *
 * INTENCIÓN: un clic alterna exactamente un bit aunque React ejecute reductores y memos
 *   dos veces. El estado de la rejilla es un `Pauli` inmutable por convención: cada
 *   acción devuelve una copia (tasks/plans/ui.md D1).
 * CONTEXTO: React 19 invoca los reductores por duplicado bajo `StrictMode` en desarrollo.
 *   Si alguien «optimiza» el reductor con `state.error.x[q] ^= 1` in situ, el clic se
 *   anula a sí mismo en desarrollo y funciona en producción: el peor tipo de bug. Este
 *   test es su mutante (medido el 2026-10-17: rojo con la mutación, verde sin ella).
 * EXPIRA SI: React deja de doble-invocar en `StrictMode` (el test seguiría pasando y
 *   podría retirarse).
 */
describe("test_intent_click_toggles_once_under_strict_mode", () => {
  it("one click under StrictMode flips exactly one component once", () => {
    const { container } = render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    const q = qubitIndex(3, 1, 1);
    fireEvent.pointerDown(qubit(container, q), down);
    fireEvent.pointerUp(qubit(container, q), { pointerId: 1 });
    expect(qubit(container, q).getAttribute("data-pauli")).toBe("X");
    expect(container.querySelectorAll('[data-defect="1"]')).toHaveLength(2);
    fireEvent.pointerDown(qubit(container, q), down);
    fireEvent.pointerUp(qubit(container, q), { pointerId: 1, shiftKey: true });
    expect(qubit(container, q).getAttribute("data-pauli")).toBe("Y");
    expect(container.querySelectorAll('[data-defect="1"]')).toHaveLength(4);
  });

  it("the reducer runs twice per action under StrictMode (control: the hazard is real)", () => {
    // If this ever fails, the EXPIRA SI condition holds and the test above may go.
    let calls = 0;
    function Counter() {
      const [n, setN] = useState(0);
      return (
        <button
          onClick={() =>
            setN((prev) => {
              calls++;
              return prev + 1;
            })
          }
        >
          {n}
        </button>
      );
    }
    const { container } = render(
      <StrictMode>
        <Counter />
      </StrictMode>,
    );
    fireEvent.click(container.querySelector("button")!);
    expect(calls).toBe(2);
  });
});

/**
 * test_intent_gesture_never_blocks_scroll
 *
 * INTENCIÓN: la rejilla no roba el scroll en móvil. El `<svg>` declara un `touch-action`
 *   que permite desplazar y hacer zoom (nunca `none`), y una pulsación larga pendiente
 *   se cancela cuando el navegador se queda el gesto (`pointercancel`) o el dedo se
 *   desplaza más allá del umbral (tasks/plans/ui.md D2).
 * CONTEXTO: en el móvil la rejilla ocupa toda la vista; con `touch-action: none` la
 *   página no se podría desplazar tocando sobre ella, y sin `pointercancel` un scroll
 *   que empieza sobre un cúbit le pondría un error Z 400 ms después.
 * EXPIRA SI: la rejilla deja de ocupar el ancho del viewport (p. ej. un lienzo con zoom
 *   propio que gestione sus gestos).
 */
describe("test_intent_gesture_never_blocks_scroll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const trace = decodeTrace(createTraceContext(3), pauliFrom(9, [], []));

  it("the <svg> allows panning and zooming through touch-action", () => {
    const { container } = render(<Grid trace={trace} onToggleX={() => {}} />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    const touchAction = svg.style.touchAction;
    expect(touchAction).not.toBe("");
    expect(touchAction).not.toBe("none");
    expect(touchAction).toMatch(/pan-x|pan-y|manipulation|auto/);
  });

  it("no stylesheet of the UI sets touch-action: none", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "ui", "grid", "grid.css"),
      "utf8",
    );
    expect(css).not.toMatch(/touch-action\s*:\s*none/);
  });

  it("pointercancel aborts a pending long press", () => {
    const onToggleZ = vi.fn();
    const { container } = render(
      <Grid trace={trace} onToggleX={() => {}} onToggleZ={onToggleZ} />,
    );
    fireEvent.pointerDown(qubit(container, 4), down);
    fireEvent.pointerCancel(qubit(container, 4), { pointerId: 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 50);
    expect(onToggleZ).not.toHaveBeenCalled();
  });

  it("a finger that moves (scroll) aborts the press too", () => {
    const onToggleX = vi.fn();
    const onToggleZ = vi.fn();
    const { container } = render(
      <Grid trace={trace} onToggleX={onToggleX} onToggleZ={onToggleZ} />,
    );
    fireEvent.pointerDown(qubit(container, 4), down);
    fireEvent.pointerMove(qubit(container, 4), {
      pointerId: 1,
      clientX: 0,
      clientY: 30,
    });
    vi.advanceTimersByTime(LONG_PRESS_MS + 50);
    fireEvent.pointerUp(qubit(container, 4), { pointerId: 1 });
    expect(onToggleX).not.toHaveBeenCalled();
    expect(onToggleZ).not.toHaveBeenCalled();
  });
});

/**
 * test_intent_trace_computed_once
 *
 * INTENCIÓN: el paso a paso no vuelve a decodificar. Un error se decodifica una vez en
 *   un `ShotTrace` inmutable y los cinco pasos (adelante, atrás, repetir, reproducir)
 *   sólo eligen qué capas de ese mismo trace dibuja la rejilla (tasks/plans/ui.md D5).
 * CONTEXTO: el trace inmutable calculado una vez es lo que hace reproducible el modo
 *   reto de fase 2 (un puzle = una máscara de errores = un trace) y lo que garantiza que
 *   lo que el usuario ve en el paso «veredicto» es la misma corrección que vio en
 *   «emparejamiento». Si alguien recalcula en cada `next` (p. ej. `decodeTrace` dentro
 *   del handler o del reductor de pasos), este test enrojece (medido el 2026-10-17:
 *   rojo con la mutación, verde sin ella).
 * EXPIRA SI: los pasos pasan a ser animaciones continuas del decodificador (entonces
 *   decodificar por fotograma sería la decisión, con su propio test).
 */
describe("test_intent_trace_computed_once", () => {
  const spy = vi.mocked(decodeTrace);
  const button = (key: string): HTMLButtonElement => {
    const found = [
      ...document.querySelectorAll<HTMLButtonElement>(".panel--steps button"),
    ].find((b) => b.textContent === i18n.t(key));
    if (found === undefined) throw new Error(`button ${key} not rendered`);
    return found;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("walking the five steps forward, back, repeat and play decodes nothing new", () => {
    // The panel mounts on a random shot (seed 11 here), decoded once.
    vi.spyOn(Math, "random").mockReturnValue(11 / 2 ** 53);
    spy.mockClear();
    render(<StepsPanel d={3} p={0.1} />);
    expect(spy).toHaveBeenCalledTimes(1); // the mount shot
    vi.spyOn(Math, "random").mockReturnValue(7 / 2 ** 53);
    fireEvent.click(button("steps.newShot"));
    expect(spy).toHaveBeenCalledTimes(2); // the shot: once
    const shot = spy.mock.results[1]!.value;
    const errorOfShot = spy.mock.calls[1]![1];

    for (let i = 0; i < LAST_STEP; i++) fireEvent.click(button("steps.next"));
    fireEvent.click(button("steps.prev"));
    fireEvent.click(button("steps.restart"));
    fireEvent.click(button("steps.play"));
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS * (LAST_STEP + 1));
    });
    expect(
      document.querySelector(".panel--steps")?.getAttribute("data-step"),
    ).toBe(String(LAST_STEP));
    expect(spy).toHaveBeenCalledTimes(2);
    // Nothing re-decoded the same error either.
    expect(
      spy.mock.calls.filter(([, error]) => pauliEquals(error, errorOfShot)),
    ).toHaveLength(1);
    // The residual the verdict step draws is the one decoded once.
    expect(shot.verdict).toBe(0);
    expect(
      document.querySelectorAll(
        '.panel--steps [data-qubit]:not([data-pauli="I"])',
      ),
    ).toHaveLength(1);
  });

  it("holds under StrictMode: navigating the steps adds no decode calls", () => {
    vi.spyOn(Math, "random").mockReturnValue(7 / 2 ** 53);
    render(
      <StrictMode>
        <StepsPanel d={3} p={0.1} />
      </StrictMode>,
    );
    fireEvent.click(button("steps.newShot"));
    const afterShot = spy.mock.calls.length;
    for (let i = 0; i < LAST_STEP; i++) fireEvent.click(button("steps.next"));
    fireEvent.click(button("steps.prev"));
    fireEvent.click(button("steps.restart"));
    fireEvent.click(button("steps.play"));
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS * (LAST_STEP + 1));
    });
    expect(spy.mock.calls.length).toBe(afterShot);
  });
});

/**
 * test_intent_touch_target_on_phone
 *
 * INTENCIÓN: cada cúbit de la rejilla interactiva ofrece una diana táctil de ≥ 24 px CSS
 *   (medidos sobre los 328 px que deja el margen de 16 px de `.app` en 360 px)
 *   en la distancia mayor sobre una pantalla de 360 px (WCAG 2.5.8, mínimo), sin que las
 *   dianas de cúbits vecinos se solapen (diámetro < UNIT).
 * CONTEXTO: 2026-10-17: en d = 9 a 360 px la diana (el halo, r = 14
 *   unidades) medía 23 px. Mutante medido (2026-10-17): `HIT_RADIUS = 12` → rojo.
 * EXPIRA SI: la rejilla deja de escalar al ancho de la pantalla o d = 9 deja de ofrecerse.
 */
describe("test_intent_touch_target_on_phone", () => {
  it("d = 9 at 360 px: the largest circle of a qubit spans ≥ 24 px and less than the qubit spacing, and is painted", () => {
    const d = 9;
    const trace = decodeTrace(createTraceContext(d), pauliFrom(d * d, [], []));
    const { container } = render(<Grid trace={trace} onToggleX={() => {}} />);
    const viewBox = container
      .querySelector("svg")!
      .getAttribute("viewBox")!
      .split(" ")
      .map(Number);
    // A 360 px screen minus the 16 px gutters of .app (index.css): the grid is
    // 328 px wide, which is where 23 px were measured.
    const pxPerUnit = (360 - 2 * 16) / viewBox[2]!;
    const radii = [...qubit(container, 40).querySelectorAll("circle")].map(
      (c) => Number(c.getAttribute("r")),
    );
    const hit = Number(
      qubit(container, 40).querySelector(".qubit__hit")!.getAttribute("r"),
    );
    // The pointer target is the largest circle but for the focus ring, which
    // is a stroke outside it and paints nothing at rest.
    expect(Math.max(...radii)).toBeLessThanOrEqual(hit + 1);
    expect(2 * hit * pxPerUnit).toBeGreaterThanOrEqual(24);
    expect(2 * hit).toBeLessThan(UNIT);
    // A transparent fill is painted (receives the pointer); `none` is not.
    const css = readFileSync(
      join(process.cwd(), "src", "ui", "grid", "grid.css"),
      "utf8",
    );
    expect(css).toMatch(/\.qubit__hit \{[^}]*fill:\s*transparent/);
  });
});
