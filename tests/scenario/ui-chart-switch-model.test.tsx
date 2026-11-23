// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";
import { BASELINES } from "../../src/ui/chart/baseline";
import { MODEL_KEY } from "../../src/ui/model/model-store";
import {
  DEFAULT_P_BY_MODEL,
  type NoiseKind,
} from "../../src/ui/model/noise-kinds";
import {
  fakeWorkerFactory,
  type FakeWorkerFactory,
} from "../helpers/fake-worker";

// The chart is a lazy chunk of the App: loaded once here, so the findByRole
// below waits for a render, not for a cold import() (with
// the 1 s default it failed 1 run in 5 under load).
beforeAll(async () => {
  await import("../../src/ui/chart/ChartPanel");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const CHUNK_TIMEOUT = { timeout: 10_000 };
// Above both waits: with the 5 s default the 10 s above never applied.
const TEST_TIMEOUT = 25_000;

// The radio appears at the commit that resolves the lazy chart, but the Worker
// is created in a passive effect (useSimulation), which React flushes in a later
// task for a non-sync render: findByRole can return in between (1 run in 30
// under load, 2026-10-19). Wait for what the assertions need, the Worker.
async function waitForChart(factory: FakeWorkerFactory): Promise<void> {
  await screen.findByRole(
    "radio",
    { name: i18n.t("chart.modelSelect.independent") },
    CHUNK_TIMEOUT,
  );
  // Not the exact count: the assertion after it reports a second Worker.
  await waitFor(
    () => expect(factory.instances.length).toBeGreaterThan(0),
    CHUNK_TIMEOUT,
  );
}

/**
 * test_scenario_ui_chart_switch_model
 *
 * De extremo a extremo (tasks/plans/phase2.md D10): la App real con la gráfica
 * diferida y un Worker falso. Base independiente visible → clic en «fallos de medición» →
 * base fenomenológica (sus 8 p en los marcadores), etiqueta nueva, `p = 0,01` en el
 * deslizador y en la gráfica, `start` con `model: "phenomenological"` en un Worker nuevo
 * (el anterior terminado), Λ(3→5) y Λ(5→7) > 1 en la vista sólo con la base; el modelo
 * queda en `localStorage`; vuelta a independiente → `p = 0,05`, Λ > 1, `start` con
 * `model: "independent"`. Cruza D10 (selector, bases, defecto por modelo, persistencia),
 * el protocolo (modelo en el `start`) y el hook (reinicio por modelo).
 */

function lambdaOf(container: HTMLElement, d: number): number {
  return Number(
    container
      .querySelector(`[data-lambda-d="${d}"] dd`)!
      .getAttribute("data-lambda"),
  );
}

function markerPs(container: HTMLElement, d: number): number[] {
  return [...container.querySelectorAll(`.curve--d${d} .marker`)].map((m) =>
    Number(m.getAttribute("data-p")),
  );
}

describe("test_scenario_ui_chart_switch_model", () => {
  it(
    "independent base → phenomenological: new base, label, p = 0.01, start with the model, Λ > 1; back: p = 0.05, Λ > 1",
    async () => {
      const factory = fakeWorkerFactory();
      const { container } = render(<App createWorker={factory.create} />);
      const radio = (model: NoiseKind) =>
        screen.getByRole("radio", {
          name: i18n.t(`chart.modelSelect.${model}`),
        });
      const slider = () =>
        container.querySelector<HTMLInputElement>(
          '.panel--grid input[type="range"]',
        )!;
      const label = () => container.querySelector(".chart__model")!.textContent;
      const userP = () =>
        container.querySelector(".chart__user-p")!.getAttribute("data-user-p");

      await waitForChart(factory);
      // First view: the phase 1 base, p = 0.05, Λ > 1 from the base alone.
      expect(factory.instances).toHaveLength(1);
      const first = factory.instances[0]!;
      expect(first.starts[0]!.model).toBe("independent");
      expect(label()).toBe(i18n.t("chart.model.independent"));
      expect(markerPs(container, 3)).toEqual(
        BASELINES.independent.probabilities,
      );
      expect(userP()).toBe(String(DEFAULT_P_BY_MODEL.independent));
      expect(lambdaOf(container, 3)).toBeGreaterThan(1);
      expect(lambdaOf(container, 5)).toBeGreaterThan(1);

      fireEvent.click(radio("phenomenological"));
      expect(label()).toBe(i18n.t("chart.model.phenomenological"));
      expect(markerPs(container, 3)).toEqual(
        BASELINES.phenomenological.probabilities,
      );
      expect(slider().value).toBe(String(DEFAULT_P_BY_MODEL.phenomenological));
      expect(userP()).toBe(String(DEFAULT_P_BY_MODEL.phenomenological));
      // The same Worker, a second start.
      expect(first.terminated).toBe(false);
      expect(factory.instances).toHaveLength(1);
      const start = first.starts[1]!;
      expect(start.model).toBe("phenomenological");
      expect(start.userP).toBe(DEFAULT_P_BY_MODEL.phenomenological);
      expect(start.probabilities).toEqual(
        BASELINES.phenomenological.probabilities,
      );
      // Λ from the base at p = 0.01: 2089/1066 and 1066/363 (browser-phenomenological.json).
      expect(lambdaOf(container, 3)).toBeCloseTo(2089 / 1066, 12);
      expect(lambdaOf(container, 5)).toBeCloseTo(1066 / 363, 12);
      expect(localStorage.getItem(MODEL_KEY)).toBe("phenomenological");

      fireEvent.click(radio("independent"));
      expect(label()).toBe(i18n.t("chart.model.independent"));
      expect(slider().value).toBe(String(DEFAULT_P_BY_MODEL.independent));
      expect(factory.instances).toHaveLength(1);
      const third = first.starts[2]!;
      expect(third.model).toBe("independent");
      expect(third.userP).toBe(DEFAULT_P_BY_MODEL.independent);
      expect(lambdaOf(container, 3)).toBeCloseTo(7138 / 4935, 12);
      expect(lambdaOf(container, 5)).toBeCloseTo(4935 / 3146, 12);
      expect(localStorage.getItem(MODEL_KEY)).toBe("independent");
    },
    TEST_TIMEOUT,
  );

  it(
    "a stored model opens the App on that model with its default p",
    async () => {
      localStorage.setItem(MODEL_KEY, "phenomenological");
      const factory = fakeWorkerFactory();
      const { container } = render(<App createWorker={factory.create} />);
      await waitForChart(factory);
      expect(factory.instances).toHaveLength(1);
      expect(factory.instances[0]!.starts[0]!.model).toBe("phenomenological");
      expect(
        container.querySelector<HTMLInputElement>(
          '.panel--grid input[type="range"]',
        )!.value,
      ).toBe(String(DEFAULT_P_BY_MODEL.phenomenological));
      expect(container.querySelector(".chart__model")!.textContent).toBe(
        i18n.t("chart.model.phenomenological"),
      );
    },
    TEST_TIMEOUT,
  );
});
