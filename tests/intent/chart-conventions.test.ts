// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  edgeWeight,
  qubitWeight,
  rotatedSurfaceCode,
  wilsonInterval,
} from "../../src/core";
import i18n from "../../src/i18n";
import { LOCALES } from "../../src/locales";
import { App } from "../../src/ui/App";
import {
  BASELINE,
  BASELINE_POINT_COUNT,
  BASELINES,
} from "../../src/ui/chart/baseline";
import { Chart } from "../../src/ui/chart/Chart";
import { ChartPanel } from "../../src/ui/chart/ChartPanel";
import { claimedCentre, drawnCentre } from "./svg-centre";
import {
  DEFAULT_P_BY_MODEL,
  NOISE_KINDS,
  type NoiseKind,
} from "../../src/ui/model/noise-kinds";
import {
  lambdaAt,
  poolPoints,
  type CurvePoint,
} from "../../src/ui/chart/curves";
import {
  useSimulation,
  type WorkerLike,
} from "../../src/ui/chart/useSimulation";
import { MIN_WIDTH } from "../../src/ui/chart/useWidth";
import type {
  LivePoint,
  MainToWorker,
  WorkerToMain,
} from "../../src/worker/protocol";
import { fakeWorkerFactory } from "../helpers/fake-worker";

afterEach(cleanup);

// ChartPanel is imported statically above, so App's lazy import() of it is
// already in the module cache; the long timeout is the belt for a loaded
// machine (the 1 s default failed 1 run in 5).
const CHUNK_TIMEOUT = { timeout: 10_000 };

function curvePoint(
  d: number,
  p: number,
  failures: number,
  shots: number,
): CurvePoint {
  const { low, high } = wilsonInterval(failures, shots);
  return {
    d,
    p,
    shots,
    failures,
    estimate: shots === 0 ? 0 : failures / shots,
    low,
    high,
    upperBoundOnly: failures === 0,
    live: true,
    liveShots: shots,
    stopReason: null,
    rate: 0,
  };
}

/**
 * test_intent_zero_failures_is_upper_bound
 *
 * INTENCIÓN: un punto sin fallos se dibuja como cota superior abierta en `high`, nunca
 *   como 0 ni fuera del eje logarítmico (docs/spec.md §3 "Métrica del marcador").
 * CONTEXTO: en los primeros turnos del Worker casi todos los puntos de `userP` bajo
 *   tienen `k = 0`; con Wilson `low = 0` y `estimate = 0`, y `log(0)` no existe. Un
 *   «optimizador» que dibujara `estimate` con `k = 0` pondría el marcador en −∞ (NaN en
 *   el atributo, el navegador lo descarta en silencio) o en el suelo del eje, que se lee
 *   como «cero errores» y es falso. Mutante medido: dibujar `estimate` con `k = 0` →
 *   rojo (medido el 2026-10-17).
 * EXPIRA SI: el eje deja de ser logarítmico (no previsto: es la decisión central de la
 *   gráfica, tasks/plans/ui.md D4).
 */
/**
 * test_intent_markers_differ_by_distance
 *
 * INTENCIÓN: el marcador de cada curva tiene una forma propia además del color (círculo
 *   d = 3, cuadrado d = 5, triángulo d = 7), con el mismo gancho `.marker__dot` y el centro en
 *   `data-cx`/`data-cy` sea cual sea la forma; **la geometría dibujada está centrada en ese
 *   gancho** (cx/cy del círculo, centro del rect, centroide del polígono, a ≤ 0,5 px: un
 *   test que sólo lee el gancho no ve un triángulo dibujado 12 px más allá); el
 *   marcador abierto (cota) lleva la forma hueca de su distancia (`.marker__open`)
 *   con la flecha; y cada entrada de la leyenda muestra la misma forma sobre un segmento
 *   del color de la curva (`.chart__swatch-mark[data-shape]`: una barra de color
 *   sola no decía qué forma lleva cada curva).
 * CONTEXTO: tres curvas distinguidas sólo por el tono no se leían sin color.
 * EXPIRA SI: la gráfica pasa a Canvas o las curvas llevan etiqueta de texto propia.
 */
describe("test_intent_markers_differ_by_distance", () => {
  const SHAPES: Record<number, string> = {
    3: "circle/circle",
    5: "rect/square",
    7: "polygon/triangle",
  };
  const shapeOf = (el: Element) =>
    `${el.tagName.toLowerCase()}/${el.getAttribute("data-shape")}`;

  it("d = 3 circle, d = 5 square, d = 7 triangle, every one .marker__dot centred on data-cx/data-cy, and the drawn geometry on that centre", () => {
    const points = [3, 5, 7].flatMap((d) => [
      curvePoint(d, 0.05, 20, 2000),
      curvePoint(d, 0.1, 40, 2000),
    ]);
    const { container } = render(
      createElement(Chart, {
        points,
        distances: [3, 5, 7],
        userP: 0.05,
        model: "independent",
      }),
    );
    const tags = (d: number) =>
      [...container.querySelectorAll(`.curve--d${d} .marker__dot`)].map(
        shapeOf,
      );
    for (const d of [3, 5, 7]) expect(tags(d)).toEqual([SHAPES[d], SHAPES[d]]);
    // The same p lands on the same x for the three shapes.
    for (const p of [0.05, 0.1]) {
      const xs = [
        ...container.querySelectorAll(`.marker[data-p="${p}"] .marker__dot`),
      ].map((el) => el.getAttribute("data-cx"));
      expect(new Set(xs).size).toBe(1);
      expect(xs[0]).not.toMatch(/NaN|null/);
    }
    // Every mark is DRAWN where it claims to be (mutant: a triangle whose
    // vertices sit at cx + 12 keeps data-cx and goes red here).
    const dots = [...container.querySelectorAll(".marker__dot")];
    expect(dots).toHaveLength(6);
    for (const dot of dots) {
      const drawn = drawnCentre(dot);
      const claimed = claimedCentre(dot);
      expect(Math.abs(drawn.x - claimed.x), shapeOf(dot)).toBeLessThanOrEqual(
        0.5,
      );
      expect(Math.abs(drawn.y - claimed.y), shapeOf(dot)).toBeLessThanOrEqual(
        0.5,
      );
    }
  });

  it("an upper bound is the hollow shape of its distance, centred on its hooks, with the arrow under it", () => {
    const points = [3, 5, 7].flatMap((d) => [
      curvePoint(d, 0.02, 0, 2000),
      curvePoint(d, 0.1, 40, 2000),
    ]);
    const { container } = render(
      createElement(Chart, {
        points,
        distances: [3, 5, 7],
        userP: 0.05,
        model: "independent",
      }),
    );
    for (const d of [3, 5, 7]) {
      const open = container.querySelectorAll(
        `.curve--d${d} .marker--open .marker__open`,
      );
      expect(open, `d = ${d}`).toHaveLength(1);
      expect(shapeOf(open[0]!)).toBe(SHAPES[d]);
      expect(open[0]!.classList.contains("marker__dot")).toBe(false);
      const drawn = drawnCentre(open[0]!);
      const claimed = claimedCentre(open[0]!);
      expect(Math.abs(drawn.x - claimed.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(drawn.y - claimed.y)).toBeLessThanOrEqual(0.5);
      const arrow = open[0]!.parentElement!.querySelector(".marker__arrow")!;
      expect(arrow.getAttribute("d")!.startsWith(`M${claimed.x},`)).toBe(true);
    }
    // The hollow look is chart.css's `.marker__open { fill: none }`.
    const css = readFileSync(
      join(process.cwd(), "src", "ui", "chart", "chart.css"),
      "utf8",
    );
    expect(css).toMatch(/\.marker__open\s*\{[^}]*fill:\s*none/);
    expect(css).toMatch(/\.marker__open\s*\{[^}]*stroke:\s*var\(--curve\)/);
  });

  it("every legend item shows the shape of its curve on a segment in the curve's colour", () => {
    const points = [3, 5, 7].flatMap((d) => [
      curvePoint(d, 0.05, 20, 2000),
      curvePoint(d, 0.1, 40, 2000),
    ]);
    const { container } = render(
      createElement(Chart, {
        points,
        distances: [3, 5, 7],
        userP: 0.05,
        model: "independent",
      }),
    );
    const items = [...container.querySelectorAll(".chart__legend li")];
    expect(items).toHaveLength(3);
    for (const [i, d] of [3, 5, 7].entries()) {
      const li = items[i]!;
      expect(li.classList.contains(`curve--d${d}`)).toBe(true);
      const swatch = li.querySelector("svg.chart__swatch");
      expect(swatch, `legend d = ${d} has a swatch`).not.toBeNull();
      expect(swatch!.getAttribute("aria-hidden")).toBe("true");
      expect(swatch!.querySelector("line.chart__swatch-line")).not.toBeNull();
      const marks = swatch!.querySelectorAll(".chart__swatch-mark[data-shape]");
      expect(marks, `legend d = ${d} has one mark`).toHaveLength(1);
      // The legend's shape IS the plot's shape for that distance.
      const plotted = container.querySelector(`.curve--d${d} .marker__dot`)!;
      expect(shapeOf(marks[0]!)).toBe(shapeOf(plotted));
      expect(marks[0]!.getAttribute("data-shape")).toBe(
        plotted.getAttribute("data-shape"),
      );
      // Centred on the segment's midpoint.
      const drawn = drawnCentre(marks[0]!);
      const line = swatch!.querySelector("line")!;
      const midX =
        (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2;
      expect(Math.abs(drawn.x - midX)).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(drawn.y - Number(line.getAttribute("y1"))),
      ).toBeLessThanOrEqual(0.5);
      // The legend's marks are not the plot's: the hooks of the plot stay apart.
      expect(li.querySelector(".marker__dot")).toBeNull();
    }
    // The key is painted in the curve's colour, by the sheet (not inline).
    const css = readFileSync(
      join(process.cwd(), "src", "ui", "chart", "chart.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.chart__swatch-line\s*\{[^}]*stroke:\s*var\(--curve\)/,
    );
    expect(css).toMatch(/\.chart__swatch-mark\s*\{[^}]*fill:\s*var\(--curve\)/);
  });
});

describe("test_intent_zero_failures_is_upper_bound", () => {
  it("k = 0 → open marker at high with an arrow, no filled dot, no bar, every coordinate finite", () => {
    const points = [
      curvePoint(3, 0.05, 0, 200),
      curvePoint(3, 0.1, 20, 200),
      curvePoint(5, 0.05, 0, 50),
      curvePoint(5, 0.1, 10, 200),
    ];
    const { container } = render(
      createElement(Chart, {
        points,
        distances: [3, 5],
        userP: 0.05,
        model: "independent",
      }),
    );
    const bounds = [...container.querySelectorAll("[data-upper-bound]")];
    expect(bounds).toHaveLength(2);
    expect(container.querySelectorAll(".marker__dot")).toHaveLength(2);
    expect(container.querySelectorAll(".marker__bar")).toHaveLength(2);
    for (const bound of bounds) {
      // The open look is chart.css's `.marker__open { fill: none }`: without
      // the class the shape is filled and reads as a measured point.
      expect(bound.classList.contains("marker--open")).toBe(true);
      expect(bound.querySelector(".marker__open")).not.toBeNull();
      expect(bound.querySelector(".marker__dot")).toBeNull();
      expect(bound.querySelector(".marker__bar")).toBeNull();
      expect(bound.querySelector(".marker__arrow")).not.toBeNull();
    }
    for (const el of container.querySelectorAll(
      "circle, line, path, polyline, polygon, rect",
    )) {
      for (const attr of [
        "cx",
        "cy",
        "x1",
        "x2",
        "y1",
        "y2",
        "d",
        "points",
        "x",
        "y",
        "width",
        "height",
      ]) {
        const value = el.getAttribute(attr);
        if (value !== null) {
          expect(value, `${el.tagName} ${attr}`).not.toMatch(/NaN|Infinity/);
        }
      }
    }
    // The open circle sits where `high` lands, i.e. above (smaller y than)
    // the axis floor and below the 10 % point of the same curve.
    const svg = container.querySelector("svg")!;
    const floor = Number(
      svg.querySelector(".chart__axis--x line")!.getAttribute("y1"),
    );
    const open = drawnCentre(bounds[0]!.querySelector(".marker__open")!).y;
    const measured = Number(
      container.querySelector(".curve--d3 .marker__dot")!.getAttribute("cy"),
    );
    expect(open).toBeLessThan(floor);
    expect(open).toBeGreaterThan(measured);
  });

  it("a bound far below every measured point is drawn at its high, above the axis floor", () => {
    // 0 of 10⁵ shots (high ≈ 3.7·10⁻⁵) next to 10 % points: the axis reaches
    // down to the bound instead of clamping it onto the floor.
    const points = [
      curvePoint(7, 0.03, 0, 100_000),
      curvePoint(7, 0.1, 20, 200),
      curvePoint(3, 0.1, 40, 200),
    ];
    const { container } = render(
      createElement(Chart, {
        points,
        distances: [3, 7],
        userP: 0.1,
        model: "independent",
      }),
    );
    const svg = container.querySelector("svg")!;
    const floor = Number(
      svg.querySelector(".chart__axis--x line")!.getAttribute("y1"),
    );
    const open = drawnCentre(
      container.querySelector("[data-upper-bound] .marker__open")!,
    ).y;
    expect(open).toBeLessThan(floor - 10);
    // And the axis now has a tick at or below the bound's high.
    const ticks = [...svg.querySelectorAll(".chart__axis--y text")].map((el) =>
      Number(el.getAttribute("y")),
    );
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(open);
  });
});

/**
 * test_intent_chart_labels_noise_model
 *
 * INTENCIÓN: la gráfica dice siempre qué modelo de ruido muestra (docs/spec.md §4.9: «la
 *   gráfica debe etiquetar siempre qué modelo muestra»).
 * CONTEXTO: docs/spec.md §3: el umbral del modelo fenomenológico es ≈ 3 % (cruce medido
 *   2,2–2,9 % para estos tamaños) frente al ≈ 10,3 % del independiente, y el del
 *   despolarizante con decodificación X/Z independiente ≈ 15,5 %; una curva sin etiqueta
 *   se leería como «otro» umbral. La etiqueta viene de i18n en todos los idiomas y nombra
 *   el modelo: «independ…» en el de fase 1, «measurement» / «medici…» en el fenomenológico
 *   (fase 2: los fallos de medición son lo que lo distingue). Mutante: quitar la
 *   etiqueta del fenomenológico (pintar siempre la del independiente) → rojo.
 * EXPIRA SI: sólo existe un modelo para siempre (no previsto: fase 2 trajo el segundo).
 */
const MODEL_WORDS: Readonly<Record<NoiseKind, RegExp>> = {
  independent: /independ/i,
  phenomenological: /measurement|medici/i,
};

describe("test_intent_chart_labels_noise_model", () => {
  it.each(NOISE_KINDS)(
    "renders chart.model.%s in every language, in the caption and in the svg's name, and the text names the model",
    async (model) => {
      const points = [curvePoint(3, 0.1, 20, 200)];
      for (const lang of Object.keys(LOCALES)) {
        await i18n.changeLanguage(lang);
        const { container, unmount } = render(
          createElement(Chart, { points, distances: [3], userP: 0.1, model }),
        );
        const label = container.querySelector(".chart__model");
        expect(label?.textContent).toBe(i18n.t(`chart.model.${model}`));
        expect(label?.textContent).toMatch(MODEL_WORDS[model]);
        expect(label?.getAttribute("data-model")).toBe(model);
        // The <svg> is role="img": its accessible name must name the model too.
        const name = container.querySelector("svg")!.getAttribute("aria-label");
        expect(name).toContain(i18n.t(`chart.model.${model}`));
        unmount();
      }
      await i18n.changeLanguage("en");
    },
  );

  it("the two labels differ in every language, and the phenomenological one does not claim perfect measurements", () => {
    for (const lang of Object.keys(LOCALES)) {
      const independent = i18n.t("chart.model.independent", { lng: lang });
      const phenomenological = i18n.t("chart.model.phenomenological", {
        lng: lang,
      });
      expect(independent).not.toBe(phenomenological);
      expect(phenomenological).not.toMatch(
        /perfect measurements|mediciones perfectas/i,
      );
    }
  });
});

/**
 * test_intent_base_curves_match_core
 *
 * INTENCIÓN: lo que la app sirve como curva base describe ESTE núcleo, en cada modelo:
 *   los pesos de desempate muestreados (por índice de arista: cúbits en 2D, más los
 *   índices 3D 343, 511 y 1 088 en el fenomenológico), la geometría de d = 3 y 5, el
 *   modelo de ruido y los 24 puntos.
 * CONTEXTO: tasks/plans/ui.md D3 funde conteos base + vivos por `(d, p)`. Fundir dos
 *   decodificadores distintos (un `browser.json` viejo tras un cambio de pesos o de
 *   coloración, o la base de un modelo bajo la etiqueta del otro) sería mentir con
 *   intervalos estrechos. `validate.yml` regenera cada fichero byte a byte en CI; este
 *   test los contrasta en cada `npm test`, sin red.
 * EXPIRA SI: la app deja de incluir curvas precomputadas.
 */
describe("test_intent_base_curves_match_core", () => {
  it.each(NOISE_KINDS)(
    "%s: weights.sample[e] === edgeWeight(e) for every sampled edge index (qubitWeight below n)",
    (model) => {
      const entries = Object.entries(BASELINES[model].weightsSample);
      expect(entries.length).toBeGreaterThanOrEqual(8);
      for (const [e, w] of entries) {
        expect(w, `edge ${e}`).toBe(edgeWeight(Number(e)));
        if (Number(e) < 121)
          expect(w, `qubit ${e}`).toBe(qubitWeight(Number(e)));
      }
    },
  );

  it("the phenomenological base samples the 3D edge indices the spacetime graph uses", () => {
    const sampled = Object.keys(BASELINES.phenomenological.weightsSample);
    for (const e of ["343", "511", "1088"]) expect(sampled).toContain(e);
  });

  it.each(NOISE_KINDS)(
    "%s: geometry[d] equals the core's stabilizer table for every recorded d",
    (model) => {
      const recorded = Object.keys(BASELINES[model].geometry);
      expect(recorded).toContain("3");
      for (const key of recorded) {
        const expected = rotatedSurfaceCode(Number(key)).stabilizers.map(
          (s) => [s.type, s.row, s.col],
        );
        expect(BASELINES[model].geometry[key]).toEqual(expected);
      }
    },
  );

  it.each(NOISE_KINDS)(
    "%s: 24 points on d ∈ {3, 5, 7} × 8 p, under its own noise model (loadBaseline rejects the other)",
    (model) => {
      const base = BASELINES[model];
      expect(base.noise).toBe(model);
      expect(base.points).toHaveLength(BASELINE_POINT_COUNT);
      expect(base.distances).toEqual([3, 5, 7]);
      expect(base.probabilities).toHaveLength(8);
    },
  );

  it("BASELINE (the phase 1 constant) is the independent base", () => {
    expect(BASELINE).toBe(BASELINES.independent);
  });
});

/**
 * test_intent_pooling_only_identical_points
 *
 * INTENCIÓN: la fusión de conteos exige `(d, p)` idénticos; `userP` fuera de la malla
 *   nunca hereda conteos de un vecino, ni de un `p` a 10⁻⁸ de distancia.
 * CONTEXTO: tasks/plans/ui.md D3. Un «redondeo amable» (`p.toFixed(2)`) o una búsqueda
 *   del vecino más cercano fundiría 10⁵ tiradas validadas en p = 0,10 con las tiradas
 *   vivas en p = 0,095, un punto distinto de la curva. Mutante medido: fundir `userP`
 *   con el vecino más cercano → rojo (2026-10-17).
 * EXPIRA SI: se interpola entre puntos (decisión nueva con su test).
 */
describe("test_intent_pooling_only_identical_points", () => {
  it("a live point next to a base point stays alone; Λ at that p uses only live counts", () => {
    const base = BASELINE.points;
    const nearest = [
      curvePoint(3, 0.095, 40, 400),
      curvePoint(5, 0.095, 20, 400),
      curvePoint(3, 0.10000001, 40, 400),
    ];
    const pooled = poolPoints(base, nearest);
    expect(pooled).toHaveLength(base.length + nearest.length);
    const at010 = pooled.find((pt) => pt.d === 3 && pt.p === 0.1)!;
    expect(at010.shots).toBe(100_000);
    expect(at010.live).toBe(false);
    const at0095 = pooled.find((pt) => pt.d === 3 && pt.p === 0.095)!;
    expect(at0095.shots).toBe(400);
    const lambda = lambdaAt(pooled, 3, 0.095)!;
    expect(lambda.ratio).toBeCloseTo(2, 12);
    // Off the grid with no live point: nothing to show, never a neighbour's value.
    expect(lambdaAt(poolPoints(base, []), 3, 0.095)).toBeNull();
  });
});

/**
 * test_intent_default_p_below_crossing
 *
 * INTENCIÓN: la primera vista de cada modelo muestra Λ > 1 junto al lema («más cúbits,
 *   menos errores»): el `p` por defecto de cada modelo (`DEFAULT_P_BY_MODEL`) está por
 *   debajo del cruce de sus curvas.
 * CONTEXTO: cruces medidos en `docs/validacion.md` (núcleo: independiente (3, 5) en 0,0936
 *   y (5, 7) en 0,0956; fenomenológico (3, 5) en 0,0224, (3, 7) en 0,0250 y (5, 7) en
 *   0,0282); con `DEFAULT_P = 0,1` la primera vista decía Λ < 1 debajo del lema. Decisión
 *   del 2026-10-17: 0,05 en el modelo de fase 1 y 0,01 en el fenomenológico
 *   (tasks/plans/phase2.md D10). Se comprueba contra las curvas base de cada modelo
 *   (`browser*.json`): Λ(3→5) y Λ(5→7) en el `p` por defecto si está en la malla, y si no,
 *   en los DOS puntos de la malla que lo rodean (el inferior y el superior; sin superior,
 *   falla y lo dice), con el intervalo propagado entero por encima de 1. Sólo el vecino
 *   inferior dejaba pasar `0,095` midiendo en 0,09. Mutantes,
 *   fase 1: `0.1` → rojo (Λ(3→5) ≈ 0,96); `0.095` → rojo (en 0,1); `0.055` → verde (0,05
 *   y 0,07, ambos enteros > 1). Fenomenológico (medido 2026-10-17 sobre
 *   `browser-phenomenological.json`, N = 10⁵): `0.015` → verde (Λ(3→5) = 1,36 [1,30; 1,42],
 *   alternativa aceptable); `0.02` → verde por poco (Λ(3→5) = 1,09 [1,06; 1,13]: el plan
 *   lo esperaba rojo con la sonda de N = 2·10⁴; la base validada lo separa); `0.025` →
 *   rojo (Λ(3→5) = 0,91). El test protege «Λ > 1 entero», no un margen; 0,01 se elige por
 *   la claridad del mensaje (Λ ≈ 2 y ≈ 3), no porque el test lo exija.
 * EXPIRA SI: la gráfica explica el umbral en contexto (fase 2, ya lo hace) y la primera
 *   vista pasa a enseñar el cruce a propósito (decisión nueva).
 */
describe("test_intent_default_p_below_crossing", () => {
  it.each(NOISE_KINDS)(
    "%s: Λ(3→5) and Λ(5→7) at its default p (or at both grid points around it) are > 1, whole interval",
    (model) => {
      const defaultP = DEFAULT_P_BY_MODEL[model];
      const grid = BASELINES[model].probabilities;
      const around = grid.includes(defaultP)
        ? [defaultP]
        : [
            Math.max(...grid.filter((q) => q < defaultP)),
            Math.min(...grid.filter((q) => q > defaultP)),
          ];
      expect(
        around.every(Number.isFinite),
        `DEFAULT_P_BY_MODEL.${model} = ${defaultP} needs a grid point on each side (grid: ${grid.join(", ")})`,
      ).toBe(true);
      const points = poolPoints(BASELINES[model].points, []);
      for (const p of around) {
        const where =
          p === defaultP
            ? `p = ${p}`
            : `p = ${p}, a grid point next to the default ${defaultP}`;
        for (const d of [3, 5]) {
          const lambda = lambdaAt(points, d, p);
          expect(lambda, `Λ(${d}→${d + 2}) at ${where}`).not.toBeNull();
          expect(lambda!.low, `Λ(${d}→${d + 2}) at ${where}`).toBeGreaterThan(
            1,
          );
        }
      }
    },
  );
});

/**
 * test_intent_model_switch_resets_p
 *
 * INTENCIÓN: al cambiar de modelo en la gráfica, `p` pasa al valor por defecto del modelo
 *   nuevo (`DEFAULT_P_BY_MODEL`) una vez, y el deslizador sigue operativo después.
 * CONTEXTO: tasks/plans/phase2.md D10. El `p` es compartido (rejilla, paso a paso, gráfica)
 *   y los cruces de los dos modelos están a un factor 4 (≈ 0,095 frente a ≈ 0,025): quien
 *   cambia a fallos de medición con `p = 0,05` vería las tres curvas invertidas debajo del
 *   lema «más cúbits, menos errores», que es la razón de ser de `DEFAULT_P` en fase 1. Se
 *   mide sobre la `App` real (el estado vive ahí), con la gráfica diferida cargada y un
 *   Worker falso: el deslizador de la rejilla y el `data-user-p` de la gráfica. Mutante:
 *   cambiar de modelo sin tocar `p` → rojo.
 * EXPIRA SI: el modelo gana su propio `p` independiente del de la rejilla (otro estado).
 */
describe("test_intent_model_switch_resets_p", () => {
  it("to phenomenological → p = 0.01; slider to 0.03 stays; back to independent → p = 0.05", async () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      createElement(App, { createWorker: factory.create }),
    );
    const radio = (model: NoiseKind) =>
      screen.getByRole("radio", {
        name: i18n.t(`chart.modelSelect.${model}`),
      });
    const slider = () =>
      container.querySelector<HTMLInputElement>(
        '.panel--grid input[type="range"]',
      )!;
    const userP = () =>
      container.querySelector(".chart__user-p")!.getAttribute("data-user-p");
    // The chart chunk is lazy (preloaded in beforeAll): wait for its selector.
    await screen.findByRole(
      "radio",
      { name: i18n.t("chart.modelSelect.independent") },
      CHUNK_TIMEOUT,
    );
    expect(slider().value).toBe(String(DEFAULT_P_BY_MODEL.independent));
    expect(userP()).toBe(String(DEFAULT_P_BY_MODEL.independent));

    fireEvent.click(radio("phenomenological"));
    expect(slider().value).toBe(String(DEFAULT_P_BY_MODEL.phenomenological));
    expect(userP()).toBe(String(DEFAULT_P_BY_MODEL.phenomenological));
    expect((radio("phenomenological") as HTMLInputElement).checked).toBe(true);

    // The slider stays free: a change of p is not undone by the model.
    fireEvent.change(slider(), { target: { value: "0.03" } });
    expect(slider().value).toBe("0.03");
    expect(userP()).toBe("0.03");

    fireEvent.click(radio("independent"));
    expect(slider().value).toBe(String(DEFAULT_P_BY_MODEL.independent));
    expect(userP()).toBe(String(DEFAULT_P_BY_MODEL.independent));
  });
});

/**
 * test_intent_current_p_always_sampled
 *
 * INTENCIÓN: el `p` actual del usuario siempre tiene carril en el Worker, o un run que se
 *   lo va a dar; Λ en el `p` elegido nunca se queda «no definido» para siempre.
 * CONTEXTO: 2026-10-17. El Worker lee su buzón al principio de
 *   cada turno y publica `done` tras el último; un `setUserP` que llega después de esa
 *   lectura no lo lee nadie. El hook enviaba el mensaje y daba el `p` por cubierto: en
 *   Chrome (2 de 60 intentos) el `p` nuevo quedaba sin simular. La regla: el hook no se fía
 *   de lo que envió, sólo del último `progress` que vio; al recibir `done` del run que
 *   posee los carriles del usuario, si el `p` actual no está en él, arranca un run de
 *   usuario. Aquí un modelo del Worker distingue lo leído (un turno aplica el `setUserP`
 *   pendiente) de lo no leído (`finish` descarta el pendiente) y recorre las intercalaciones:
 *   cambio antes y después de `done`, leído y no leído, dos cambios seguidos, `p` de la
 *   malla y fuera, durante un run de usuario y entre su `start` y su primer turno. Mutante
 *   medido: quitar el relanzamiento en `done` → rojo en 4 de 9 secuencias (2026-10-17).
 * EXPIRA SI: el Worker confirma cada `setUserP` con un mensaje propio (otro protocolo) o
 *   el hook deja de reutilizar un run para el `p` del usuario.
 */
interface ModelRun {
  userP: number;
  readonly grid: readonly number[];
  /** A setUserP received and not yet read. */
  pending: number | null;
  /** The p of the last progress posted. */
  lanes: readonly number[];
  done: boolean;
}

function livePoint(
  d: number,
  p: number,
  shots = 100,
  stopReason: LivePoint["stopReason"] = null,
): LivePoint {
  const failures = Math.round(shots / 20);
  const { low, high } = wilsonInterval(failures, shots);
  return {
    d,
    p,
    shots,
    failures,
    failuresX: failures,
    failuresZ: 0,
    estimate: 0.05,
    low,
    high,
    estimateX: 0.05,
    lowX: low,
    highX: high,
    estimateZ: 0,
    lowZ: 0,
    highZ: 0,
    stopReason,
    upperBoundOnly: false,
    rate: 1000,
  };
}

/** The Worker's bookkeeping, nothing else: which p each run samples. */
class WorkerModel implements WorkerLike {
  onmessage: ((event: { readonly data: WorkerToMain }) => void) | null = null;
  onerror: ((event: { readonly message?: string }) => void) | null = null;
  readonly runs = new Map<number, ModelRun>();
  readonly starts: number[] = [];

  postMessage(message: MainToWorker): void {
    if (message.type === "start") {
      this.starts.push(message.runId);
      this.runs.set(message.runId, {
        userP: message.userP,
        grid: message.probabilities,
        pending: null,
        lanes: [],
        done: false,
      });
    } else if (message.type === "setUserP") {
      const run = this.runs.get(message.runId);
      if (run !== undefined && !run.done) run.pending = message.p;
    }
  }

  terminate(): void {}

  get current(): number {
    return this.starts.at(-1)!;
  }

  /** One turn of the current run: read the inbox, sample, post progress. */
  turn(): void {
    const run = this.runs.get(this.current)!;
    if (run.pending !== null) {
      run.userP = run.pending;
      run.pending = null;
    }
    run.lanes = [...new Set([run.userP, ...run.grid])];
    const points = run.lanes.flatMap((p) =>
      BASELINE.distances.map((d) => livePoint(d, p)),
    );
    const runId = this.current;
    act(() => this.onmessage?.({ data: { type: "progress", runId, points } }));
  }

  /** The current run ends without reading its inbox again: the race. */
  finish(): void {
    const run = this.runs.get(this.current)!;
    run.pending = null;
    run.done = true;
    const runId = this.current;
    act(() =>
      this.onmessage?.({ data: { type: "done", runId, elapsedMs: 10 } }),
    );
  }

  /** p has a lane in a finished run, or a going run will sample it. */
  covers(p: number): boolean {
    for (const run of this.runs.values()) {
      if (run.done ? run.lanes.includes(p) : (run.pending ?? run.userP) === p)
        return true;
      if (!run.done && run.grid.includes(p)) return true;
    }
    return false;
  }
}

type Step = { set: number } | "turn" | "finish";

const SEQUENCES: readonly [name: string, steps: readonly Step[]][] = [
  [
    "change read by the main run before done",
    [{ set: 0.12 }, "turn", "finish"],
  ],
  [
    "change NOT read: done right after it (the race)",
    ["turn", { set: 0.12 }, "finish"],
  ],
  ["change after done", ["turn", "finish", { set: 0.12 }]],
  [
    "two changes in a row, neither read",
    ["turn", { set: 0.12 }, { set: 0.06 }, "finish"],
  ],
  ["grid p, not read before done", ["turn", { set: 0.1 }, "finish"]],
  ["grid p after done", ["turn", "finish", { set: 0.1 }]],
  [
    "change during a user run, not read",
    ["turn", "finish", { set: 0.12 }, "turn", { set: 0.06 }, "finish"],
  ],
  [
    "back to a p the main run sampled",
    ["turn", "finish", { set: 0.12 }, "turn", "finish", { set: 0.08 }],
  ],
  [
    "change between a user run's start and its first turn, not read",
    ["turn", "finish", { set: 0.12 }, { set: 0.06 }, "finish"],
  ],
];

describe("test_intent_current_p_always_sampled", () => {
  it.each(SEQUENCES)("%s", (_name, steps) => {
    const model = new WorkerModel();
    const options = { createWorker: () => model };
    const { result, rerender } = renderHook(
      ({ p }: { p: number }) => useSimulation(p, options),
      { initialProps: { p: 0.08 } },
    );
    let p = 0.08;
    for (const step of steps) {
      if (step === "turn") model.turn();
      else if (step === "finish") model.finish();
      else {
        p = step.set;
        rerender({ p });
      }
      expect(model.covers(p), `after ${JSON.stringify(step)}`).toBe(true);
    }
    // Once the run that covers p posts a turn, the hook shows p's lanes.
    const covering = [...model.runs.values()].find(
      (run) => !run.done && (run.pending ?? run.userP) === p,
    );
    if (covering !== undefined) model.turn();
    expect(result.current.live.some((pt) => pt.p === p)).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("a change the Worker did read costs no extra run; one it did not costs exactly one", () => {
    // Stable options: a new createWorker identity would restart the Worker.
    const read = new WorkerModel();
    const readOptions = { createWorker: () => read };
    const a = renderHook(
      ({ p }: { p: number }) => useSimulation(p, readOptions),
      { initialProps: { p: 0.08 } },
    );
    a.rerender({ p: 0.12 });
    read.turn();
    read.finish();
    expect(read.starts).toHaveLength(1);

    const unread = new WorkerModel();
    const unreadOptions = { createWorker: () => unread };
    const b = renderHook(
      ({ p }: { p: number }) => useSimulation(p, unreadOptions),
      { initialProps: { p: 0.08 } },
    );
    unread.turn();
    b.rerender({ p: 0.12 });
    b.rerender({ p: 0.06 });
    unread.finish();
    expect(unread.starts).toHaveLength(2);
    expect(unread.runs.get(unread.current)!.userP).toBe(0.06);
    expect(unread.runs.get(unread.current)!.grid).toEqual([]);
  });
});

/** The main run's grid lanes plus its user lane, every one with `shots` shots. */
// The last progress before a natural done carries a stop reason on every lane
// (the Worker only reports done once each lane stopped or the budget ran out);
// a lane still at null is one cut by our own stop.
function mainProgress(
  userP: number,
  shots: number,
  stopReason: LivePoint["stopReason"] = "shots",
): LivePoint[] {
  const ps = [...new Set([userP, ...BASELINE.probabilities])];
  return ps.flatMap((p) =>
    BASELINE.distances.map((d) => livePoint(d, p, shots, stopReason)),
  );
}

function userProgress(
  p: number,
  shots: number,
  stopReason: LivePoint["stopReason"] = "shots",
): LivePoint[] {
  return BASELINE.distances.map((d) => livePoint(d, p, shots, stopReason));
}

/**
 * test_intent_sampled_p_never_resampled
 *
 * INTENCIÓN: un `p` que el run principal ya muestreó no se vuelve a muestrear: su carril
 *   (decenas de miles de tiradas) es el visible, y un run de usuario nunca lo tapa con uno
 *   recién nacido.
 * CONTEXTO: 2026-10-17. Con un run de usuario en marcha, volver a un `p` de
 *   la malla enviaba `setUserP`: el Worker creaba un carril desde cero, `live` lo prefería
 *   al del principal y `data-live-shots` de d = 3 caía de 50 000 a 100. Regla: si el último
 *   `progress` del principal cubre `p`, el run de usuario se para (`stop`) y no se re-apunta;
 *   ante dos puntos del mismo `(d, p)`, `live` se queda con el de más tiradas. Un carril
 *   cortado por presupuesto (`stopReason: "budget"`) cuenta como carril: tuvo su parte del
 *   presupuesto (los carriles del usuario muestrean primero) y un run nuevo empezaría de
 *   cero sin fundirse con él. Mutantes medidos: quitar la comprobación `mainHasLane` en el
 *   efecto → rojo; `live` se queda con el primero → rojo; `hasLane` ignora los carriles
 *   «budget» → rojo (2026-10-17).
 * EXPIRA SI: los runs funden sus tiradas entre sí (entonces re-muestrear sumaría, no
 *   taparía).
 */
describe("test_intent_sampled_p_never_resampled", () => {
  it("main done at 50 000 → user run at 0.12 → back to 0.1: no setUserP, the user run is stopped, 50 000 stays", () => {
    const factory = fakeWorkerFactory();
    const options = { createWorker: factory.create };
    const { result, rerender } = renderHook(
      ({ p }: { p: number }) => useSimulation(p, options),
      { initialProps: { p: 0.1 } },
    );
    const worker = factory.instances[0]!;
    const mainId = worker.starts[0]!.runId;
    worker.emit({
      type: "progress",
      runId: mainId,
      points: mainProgress(0.1, 50_000),
    });
    worker.emit({ type: "done", runId: mainId, elapsedMs: 800 });

    rerender({ p: 0.12 });
    expect(worker.starts).toHaveLength(2);
    const userId = worker.starts[1]!.runId;
    worker.emit({
      type: "progress",
      runId: userId,
      points: userProgress(0.12, 100),
    });
    expect(result.current.userRunning).toBe(true);

    const before = worker.posted.length;
    rerender({ p: 0.1 });
    const after = worker.posted.slice(before);
    expect(after.some((m) => m.type === "setUserP")).toBe(false);
    expect(after).toContainEqual({ type: "stop", runId: userId });
    expect(worker.starts).toHaveLength(2);
    const at3 = result.current.live.filter((pt) => pt.d === 3 && pt.p === 0.1);
    expect(at3).toHaveLength(1);
    expect(at3[0]!.shots).toBe(50_000);

    // Its done finds 0.1 covered: nothing starts, the status settles.
    worker.emit({ type: "done", runId: userId, elapsedMs: 50 });
    expect(worker.starts).toHaveLength(2);
    expect(result.current.userRunning).toBe(false);
  });

  it("a user lane cut by our stop (stopReason null) is not a lane: returning to its p starts a run, and the stopped run's elapsed time is not shown", () => {
    const factory = fakeWorkerFactory();
    const options = { createWorker: factory.create };
    const { result, rerender } = renderHook(
      ({ p }: { p: number }) => useSimulation(p, options),
      { initialProps: { p: 0.1 } },
    );
    const worker = factory.instances[0]!;
    const mainId = worker.starts[0]!.runId;
    worker.emit({
      type: "progress",
      runId: mainId,
      points: mainProgress(0.1, 50_000),
    });
    worker.emit({ type: "done", runId: mainId, elapsedMs: 800 });
    rerender({ p: 0.12 });
    const userId = worker.starts[1]!.runId;
    worker.emit({
      type: "progress",
      runId: userId,
      points: userProgress(0.12, 100, null),
    });
    rerender({ p: 0.1 });
    expect(worker.posted).toContainEqual({ type: "stop", runId: userId });
    worker.emit({ type: "done", runId: userId, elapsedMs: 5 });
    // "finished in 0 s" would be the stopped run talking.
    expect(result.current.elapsedMs).toBe(800);
    // 0.12 only has 100 shots with stopReason null: sample it again.
    rerender({ p: 0.12 });
    expect(worker.starts).toHaveLength(3);
    expect(worker.starts[2]!.userP).toBe(0.12);
    expect(result.current.userRunning).toBe(true);
  });

  it("the panel's counter keeps the main run's shots after the detour", () => {
    const factory = fakeWorkerFactory();
    const { container, rerender } = render(
      createElement(ChartPanel, { p: 0.1, createWorker: factory.create }),
    );
    const worker = factory.instances[0]!;
    const mainId = worker.starts[0]!.runId;
    const main = mainProgress(0.1, 50_000);
    worker.emit({ type: "progress", runId: mainId, points: main });
    worker.emit({ type: "done", runId: mainId, elapsedMs: 800 });
    const shots3 = () =>
      Number(
        container
          .querySelector('.chart__stats tr[data-d="3"] [data-live-shots]')!
          .getAttribute("data-live-shots"),
      );
    const expected = main
      .filter((pt) => pt.d === 3)
      .reduce((sum, pt) => sum + pt.shots, 0);
    expect(shots3()).toBe(expected);
    rerender(
      createElement(ChartPanel, { p: 0.12, createWorker: factory.create }),
    );
    const userId = worker.starts[1]!.runId;
    worker.emit({
      type: "progress",
      runId: userId,
      points: userProgress(0.12, 100),
    });
    rerender(
      createElement(ChartPanel, { p: 0.1, createWorker: factory.create }),
    );
    expect(shots3()).toBe(expected);
  });

  it("a p off the grid during a user run re-aims that run (setUserP), no new start", () => {
    const factory = fakeWorkerFactory();
    const options = { createWorker: factory.create };
    const { rerender } = renderHook(
      ({ p }: { p: number }) => useSimulation(p, options),
      { initialProps: { p: 0.1 } },
    );
    const worker = factory.instances[0]!;
    const mainId = worker.starts[0]!.runId;
    worker.emit({
      type: "progress",
      runId: mainId,
      points: mainProgress(0.1, 50_000),
    });
    worker.emit({ type: "done", runId: mainId, elapsedMs: 800 });
    rerender({ p: 0.12 });
    const userId = worker.starts[1]!.runId;
    worker.emit({
      type: "progress",
      runId: userId,
      points: userProgress(0.12, 100),
    });
    const before = worker.posted.length;
    rerender({ p: 0.125 });
    expect(worker.posted.slice(before)).toEqual([
      { type: "setUserP", runId: userId, p: 0.125 },
    ]);
    expect(worker.starts).toHaveLength(2);
  });

  it("of two live points with the same (d, p), live keeps the one with more shots", () => {
    const factory = fakeWorkerFactory();
    const options = { createWorker: factory.create };
    const { result, rerender } = renderHook(
      ({ p }: { p: number }) => useSimulation(p, options),
      { initialProps: { p: 0.1 } },
    );
    const worker = factory.instances[0]!;
    const mainId = worker.starts[0]!.runId;
    worker.emit({
      type: "progress",
      runId: mainId,
      points: mainProgress(0.1, 50_000),
    });
    worker.emit({ type: "done", runId: mainId, elapsedMs: 800 });
    rerender({ p: 0.12 });
    const userId = worker.starts[1]!.runId;
    worker.emit({
      type: "progress",
      runId: userId,
      points: userProgress(0.12, 100),
    });
    // A late progress of the main run that also carries 0.12 (any order).
    worker.emit({
      type: "progress",
      runId: mainId,
      points: mainProgress(0.12, 50_000),
    });
    const at12 = result.current.live.filter((pt) => pt.p === 0.12);
    expect(at12).toHaveLength(BASELINE.distances.length);
    for (const pt of at12) expect(pt.shots).toBe(50_000);
  });

  it("a user lane stopped by the budget is a lane; returning to its p starts nothing", () => {
    const factory = fakeWorkerFactory();
    const options = { createWorker: factory.create };
    const { rerender } = renderHook(
      ({ p }: { p: number }) => useSimulation(p, options),
      { initialProps: { p: 0.08 } },
    );
    const worker = factory.instances[0]!;
    const mainId = worker.starts[0]!.runId;
    const cut = [
      ...userProgress(0.08, 100).map((pt) => ({
        ...pt,
        stopReason: "budget" as const,
      })),
      ...mainProgress(0.1, 50_000).filter((pt) => pt.p !== 0.08),
    ];
    worker.emit({ type: "progress", runId: mainId, points: cut });
    worker.emit({ type: "done", runId: mainId, elapsedMs: 60_000 });
    rerender({ p: 0.12 });
    expect(worker.starts).toHaveLength(2);
    const userId = worker.starts[1]!.runId;
    worker.emit({
      type: "progress",
      runId: userId,
      points: userProgress(0.12, 100),
    });
    worker.emit({ type: "done", runId: userId, elapsedMs: 50 });
    const before = worker.posted.length;
    rerender({ p: 0.08 });
    expect(worker.posted.slice(before)).toEqual([]);
    expect(worker.starts).toHaveLength(2);
  });
});

/**
 * test_intent_run_error_ends_the_run
 *
 * INTENCIÓN: un `error` del Worker cierra el run como lo haría `done`: el siguiente `p`
 *   arranca un run nuevo en vez de re-apuntar (`setUserP`) un run que ya no existe.
 * CONTEXTO: 2026-10-17. Con el run principal en `error`, `mainDoneRef` seguía
 *   en falso: cada cambio de `p` enviaba `setUserP` a un run muerto y la gráfica no volvía a
 *   simular nunca. Mutante medido: no marcar el run como acabado en `error` → rojo
 *   (2026-10-17).
 * EXPIRA SI: el Worker reinicia solo tras un error (otro protocolo).
 */
describe("test_intent_run_error_ends_the_run", () => {
  it("main run error → change of p → a new start; user run error → the same", () => {
    const factory = fakeWorkerFactory();
    const options = { createWorker: factory.create };
    const { result, rerender } = renderHook(
      ({ p }: { p: number }) => useSimulation(p, options),
      { initialProps: { p: 0.1 } },
    );
    const worker = factory.instances[0]!;
    const mainId = worker.starts[0]!.runId;
    worker.emit({ type: "error", runId: mainId, message: "boom" });
    expect(result.current.error).toBe("boom");
    rerender({ p: 0.12 });
    expect(worker.starts).toHaveLength(2);
    expect(worker.starts[1]!.userP).toBe(0.12);
    expect(worker.posted.some((m) => m.type === "setUserP")).toBe(false);

    const userId = worker.starts[1]!.runId;
    worker.emit({ type: "error", runId: userId, message: "again" });
    expect(result.current.userRunning).toBe(false);
    rerender({ p: 0.13 });
    expect(worker.starts).toHaveLength(3);
    expect(worker.starts[2]!.userP).toBe(0.13);

    // Once the replacement run is going, the old error is gone.
    expect(result.current.error).toBeNull();
    const thirdId = worker.starts[2]!.runId;
    worker.emit({
      type: "progress",
      runId: thirdId,
      points: userProgress(0.13, 100),
    });
    worker.emit({ type: "done", runId: thirdId, elapsedMs: 300 });
    expect(result.current.error).toBeNull();
    expect(result.current.elapsedMs).toBe(300);
  });
});

/**
 * test_intent_status_running_from_start
 *
 * INTENCIÓN: el estado dice «simulando» desde el `start` de un run de usuario, no desde su
 *   primer `progress`.
 * CONTEXTO: 2026-10-17. Entre el `start` y el primer `progress` (un turno)
 *   `userRunning` seguía en falso y el estado decía «terminada en X s» con un run recién
 *   lanzado. Mutante medido: `userRunning: true` sólo en `progress` → rojo (2026-10-17).
 * EXPIRA SI: el estado deja de distinguir «simulando» de «terminada».
 */
describe("test_intent_status_running_from_start", () => {
  it("done → change of p → chart.running before any progress → done again → chart.done", () => {
    const factory = fakeWorkerFactory();
    const { container, rerender } = render(
      createElement(ChartPanel, { p: 0.1, createWorker: factory.create }),
    );
    const worker = factory.instances[0]!;
    const mainId = worker.starts[0]!.runId;
    const status = () => container.querySelector(".chart__status")!.textContent;
    expect(status()).toBe(i18n.t("chart.running"));
    worker.emit({
      type: "progress",
      runId: mainId,
      points: mainProgress(0.1, 1000),
    });
    worker.emit({ type: "done", runId: mainId, elapsedMs: 800 });
    expect(status()).toBe(i18n.t("chart.done", { seconds: "0.8" }));
    rerender(
      createElement(ChartPanel, { p: 0.12, createWorker: factory.create }),
    );
    expect(worker.starts).toHaveLength(2);
    expect(status()).toBe(i18n.t("chart.running"));
    const userId = worker.starts[1]!.runId;
    worker.emit({
      type: "progress",
      runId: userId,
      points: userProgress(0.12, 100),
    });
    expect(status()).toBe(i18n.t("chart.running"));
    worker.emit({ type: "done", runId: userId, elapsedMs: 200 });
    expect(status()).toBe(i18n.t("chart.done", { seconds: "0.2" }));
  });
});

/**
 * test_intent_chart_title_once
 *
 * INTENCIÓN: el título de la gráfica se lee en el encabezado del panel; el nombre accesible
 *   del `<svg>` lleva los ejes y el modelo y nunca antepone el título (el eje Y ya empieza
 *   por él).
 * CONTEXTO: 2026-10-17. `chart.svgLabel` empezaba por `{{title}}:` y el eje
 *   Y empieza por el mismo texto: «Logical error rate: Logical error rate P_L against…».
 *   Mutante medido: devolver `{{title}}` a `svgLabel` → rojo (2026-10-17).
 * EXPIRA SI: el panel deja de tener encabezado propio.
 */
describe("test_intent_chart_title_once", () => {
  it("in every language the heading is the title and the svg's name never repeats it", async () => {
    for (const lang of Object.keys(LOCALES)) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = render(
        createElement(ChartPanel, { p: 0.1, createWorker: () => null }),
      );
      const title = i18n.t("chart.title");
      const heading = container.querySelector("h2")!.textContent ?? "";
      const name = container.querySelector("svg")!.getAttribute("aria-label")!;
      const count = (s: string) => s.split(title).length - 1;
      expect(heading).toBe(title);
      // Once at most: the y axis label itself begins with the title; a second
      // occurrence is the old `{{title}}:` prefix.
      expect(count(name), `${lang}: ${name}`).toBeLessThanOrEqual(1);
      expect(name, `${lang}: unfilled placeholder`).not.toContain("{{");
      expect(name).toContain(i18n.t("chart.axis.p"));
      unmount();
    }
    await i18n.changeLanguage("en");
  });
});

/**
 * test_intent_y_title_clear_of_ticks
 *
 * INTENCIÓN: el título vertical del eje Y no se cruza con las etiquetas de sus marcas, ni
 *   con la más larga que el eje puede mostrar («0,0001 %», el suelo Y_FLOOR = 10⁻⁶).
 * CONTEXTO: 2026-10-17: con `left: 64` y el título en x = 14, «0.001 %»
 *   (≈ 44 px a 12 px) se solapaba con el título en escritorio. jsdom no mide texto: las
 *   cajas se estiman con anchos por glifo CONSERVADORES (dígito 0,6 em, «%» 0,95 em, resto
 *   0,35 em; el título ocupa [x − 0,8 em, x + 0,25 em] tras girar −90°), más anchos que
 *   cualquier fuente del sistema a esa talla. Mutante medido: `left: 64` → rojo
 *   (2026-10-17).
 * EXPIRA SI: el título del eje Y deja de ser vertical o se mueve fuera del SVG.
 */
describe("test_intent_y_title_clear_of_ticks", () => {
  const css = readFileSync(
    join(process.cwd(), "src", "ui", "chart", "chart.css"),
    "utf8",
  );
  const fontSize = Number(
    /\.chart__svg \{[^}]*font-size:\s*(\d+)px/.exec(css)?.[1],
  );
  const width = (text: string): number =>
    [...text].reduce(
      (sum, ch) =>
        sum + (/\d/.test(ch) ? 0.6 : ch === "%" ? 0.95 : 0.35) * fontSize,
      0,
    );

  it("every y tick label starts to the right of the title's box, in every language, down to Y_FLOOR", async () => {
    expect(fontSize).toBeGreaterThan(0);
    const points = [
      curvePoint(7, 0.03, 0, 1_000_000),
      curvePoint(7, 0.15, 60, 200),
      curvePoint(3, 0.15, 80, 200),
    ];
    for (const lang of Object.keys(LOCALES)) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = render(
        createElement(Chart, {
          points,
          distances: [3, 7],
          userP: 0.1,
          model: "independent",
        }),
      );
      const title = container.querySelector(
        ".chart__axis--y .chart__axis-label",
      )!;
      const tx = Number(
        /translate\(([\d.]+) /.exec(title.getAttribute("transform")!)![1],
      );
      const titleRight = tx + 0.25 * fontSize;
      const labels = [
        ...container.querySelectorAll(
          ".chart__axis--y text:not(.chart__axis-label)",
        ),
      ];
      expect(labels.length).toBeGreaterThanOrEqual(3);
      const longest = labels.reduce((a, b) =>
        width(b.textContent ?? "") > width(a.textContent ?? "") ? b : a,
      );
      expect(longest.textContent!.replace(/\s/g, "")).toMatch(/0[.,]0001%/);
      for (const label of labels) {
        const left =
          Number(label.getAttribute("x")) - width(label.textContent!);
        expect(left, `${lang} "${label.textContent}"`).toBeGreaterThan(
          titleRight,
        );
      }
      unmount();
    }
    await i18n.changeLanguage("en");
  });
});

/**
 * test_intent_chart_text_contrast
 *
 * INTENCIÓN: el texto pintado con el color de una curva (la tabla de tiradas) contrasta
 *   ≥ 4,5:1 con el fondo en los dos temas (WCAG 1.4.3); los trazos tienen su propio
 *   umbral (3:1, WCAG 1.4.11) y su propia variable.
 * CONTEXTO: 2026-10-17: `.chart__stats th` tomaba el color del trazo, y
 *   en claro d = 3 daba 3,58:1 y d = 5 4,37:1. El CSS anota los ratios; este test los
 *   mide desde el fichero para que una paleta nueva no los deje escritos y falsos.
 * EXPIRA SI: la tabla deja de colorear texto con el color de la curva.
 */
describe("test_intent_chart_text_contrast", () => {
  const css = readFileSync(
    join(process.cwd(), "src", "ui", "chart", "chart.css"),
    "utf8",
  );
  const luminance = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const channel = (c: number): number => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(n >> 16) +
      0.7152 * channel((n >> 8) & 255) +
      0.0722 * channel(n & 255)
    );
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  // The canvas the curves and their text sit on: the two sides of --bg in
  // src/index.css (design.md D2: a palette that is not pure white or Chrome's
  // dark canvas must be measured against what is painted, not against
  // literals copied once).
  const bg = /--bg:\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i.exec(
    readFileSync(join(process.cwd(), "src", "index.css"), "utf8"),
  );
  if (bg === null)
    throw new Error("--bg as light-dark(#hex, #hex) in index.css");
  const LIGHT_BG = bg[1]!;
  const DARK_BG = bg[2]!;
  // The stats table sits on the panel, a card painted with --surface from
  // 640 px (the text tokens were pinned against
  // --bg only and painted at 4.1–4.4 on the card).
  const surface =
    /--surface:\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i.exec(
      readFileSync(join(process.cwd(), "src", "index.css"), "utf8"),
    );
  if (surface === null)
    throw new Error("--surface as light-dark(#hex, #hex) in index.css");
  const LIGHT_SURFACE = surface[1]!;
  const DARK_SURFACE = surface[2]!;

  it.each([3, 5, 7])(
    "--curve-%i-text reaches 4.5:1 on --bg and on --surface in both themes",
    (d) => {
      const match = new RegExp(
        `--curve-${d}-text:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`,
        "i",
      ).exec(css);
      expect(match, `--curve-${d}-text in chart.css`).not.toBeNull();
      const [, light, dark] = match!;
      expect(contrast(light!, LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark!, DARK_BG)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light!, LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark!, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([3, 5, 7])(
    "--curve-%i (the stroke) reaches 3:1 in both themes",
    (d) => {
      const match = new RegExp(
        `--curve-${d}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`,
        "i",
      ).exec(css);
      expect(match, `--curve-${d} in chart.css`).not.toBeNull();
      const [, light, dark] = match!;
      expect(contrast(light!, LIGHT_BG)).toBeGreaterThanOrEqual(3);
      expect(contrast(dark!, DARK_BG)).toBeGreaterThanOrEqual(3);
    },
  );

  it("the LAST color rule that applies to .chart__stats th is the text variable", () => {
    // Every rule whose selector list names the cell, in source order; the
    // cascade takes the last one (same specificity), so a later override in
    // the stroke's colour would win silently.
    const colors: string[] = [];
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selectors, body] of stripped.matchAll(
      /([^{}]+)\{([^}]*)\}/g,
    )) {
      const names = selectors!.split(",").map((s) => s.trim());
      if (!names.includes(".chart__stats th")) continue;
      for (const [, value] of body!.matchAll(/(?:^|;)\s*color:\s*([^;]+)/g)) {
        colors.push(value!.trim());
      }
    }
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.at(-1)).toBe("var(--curve-text)");
  });
});

/**
 * test_intent_chart_legible_on_phone
 *
 * INTENCIÓN: los rótulos de la gráfica miden ≥ 11 px efectivos en toda figura de ≥ 288 px
 *   (un viewport de 320 px con márgenes de 16): el `viewBox` toma el ancho CSS de la figura
 *   (`useWidth`), de modo que una unidad SVG es un píxel y el `font-size` de chart.css es
 *   el tamaño real; el eje x conserva ≥ 200 px de recorrido desde 320 px (184 px a 288);
 *   por debajo de 288 px el `viewBox` se fija en `MIN_WIDTH` y la figura entera se encoge
 *   en vez de estrujar el eje; «d = 3» en la tabla no se parte en dos líneas; y
 *   desmontar la gráfica desconecta su `ResizeObserver`.
 * CONTEXTO: con un `viewBox` fijo de 640 unidades los 12 px se
 *   quedaban en ≈ 6,75 px a 360 px, y «d = 3» se partía en la tabla a 360 px. Después,
 *   a 288 px el mínimo de 320 dejaba los rótulos en 10,8 px (`MIN_WIDTH` bajó a
 *   288), y la desconexión no se comprobaba. Mutantes medidos (2026-10-17): `viewBox` fijo
 *   en 640 → rojo; `white-space: nowrap` fuera de `.chart__stats th` → rojo;
 *   `Math.round(w)` sin mínimo → rojo (caso de 240 px); limpieza del efecto sin
 *   `disconnect` → rojo.
 * EXPIRA SI: la gráfica deja de ser un SVG escalado al ancho (p. ej. un canvas con texto HTML).
 */
describe("test_intent_chart_legible_on_phone", () => {
  afterEach(() => vi.unstubAllGlobals());
  const MIN_EFFECTIVE_PX = 11;
  const css = readFileSync(
    join(process.cwd(), "src", "ui", "chart", "chart.css"),
    "utf8",
  );
  const fontSize = Number(
    /\.chart__svg \{[^}]*font-size:\s*(\d+)px/.exec(css)?.[1],
  );

  /** Reports `width` for whatever it observes, at once; counts disconnects. */
  function stubResizeObserver(width: number) {
    const counter = { disconnects: 0 };
    class FakeResizeObserver {
      readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {
        counter.disconnects++;
      }
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    return counter;
  }

  const points = [
    curvePoint(3, 0.1, 2000, 10_000),
    curvePoint(7, 0.03, 0, 100_000),
  ];
  const viewBoxWidth = (container: HTMLElement) =>
    Number(
      container.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[2],
    );

  it.each([
    [288, 184],
    [320, 200],
    [360, 200],
    [390, 200],
    [640, 200],
    [1280, 200],
  ])(
    "at %i CSS px wide the labels keep ≥ 11 effective px and the x axis ≥ %i px; unmount disconnects the observer",
    (cssWidth, minAxisPx) => {
      expect(fontSize).toBeGreaterThan(0);
      const observer = stubResizeObserver(cssWidth);
      const { container, unmount } = render(
        createElement(Chart, {
          points,
          distances: [3, 7],
          userP: 0.1,
          model: "independent",
        }),
      );
      const scale = cssWidth / viewBoxWidth(container);
      expect(fontSize * scale).toBeGreaterThanOrEqual(MIN_EFFECTIVE_PX);
      const axis = container.querySelector(".chart__axis--x line")!;
      const span =
        (Number(axis.getAttribute("x2")) - Number(axis.getAttribute("x1"))) *
        scale;
      expect(span).toBeGreaterThanOrEqual(minAxisPx);
      expect(observer.disconnects).toBe(0);
      unmount();
      expect(observer.disconnects).toBe(1);
    },
  );

  it("below MIN_WIDTH the viewBox is clamped at MIN_WIDTH: the figure shrinks whole instead of squeezing the axis", () => {
    expect(MIN_WIDTH).toBe(288);
    stubResizeObserver(240);
    const { container } = render(
      createElement(Chart, {
        points,
        distances: [3, 7],
        userP: 0.1,
        model: "independent",
      }),
    );
    expect(viewBoxWidth(container)).toBe(MIN_WIDTH);
  });

  it("the distance label of the stats table never wraps", () => {
    expect(css).toMatch(/\.chart__stats th \{[^}]*white-space:\s*nowrap/);
  });
});
