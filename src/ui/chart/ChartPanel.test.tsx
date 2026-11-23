// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRng,
  identity,
  independentNoise,
  ratioInterval,
  sampleNoise,
  weight,
  wilsonInterval,
} from "../../core";
import i18n from "../../i18n";
import type { LivePoint } from "../../worker/protocol";
import { fakeWorkerFactory } from "../../../tests/helpers/fake-worker";
import { drawnCentre } from "../../../tests/intent/svg-centre";
import type { NoiseKind } from "../model/noise-kinds";
import { createTraceContext, decodeTrace } from "../model/trace";
import { BASELINE, BASELINES } from "./baseline";
import { ChartPanel } from "./ChartPanel";
import { formatRatio } from "./format";

afterEach(cleanup);

export function livePoint(
  d: number,
  p: number,
  failures: number,
  shots: number,
  rate = 1000,
): LivePoint {
  const { low, high } = wilsonInterval(failures, shots);
  const estimate = shots === 0 ? 0 : failures / shots;
  return {
    d,
    p,
    shots,
    failures,
    failuresX: failures,
    failuresZ: 0,
    estimate,
    low,
    high,
    estimateX: estimate,
    lowX: low,
    highX: high,
    estimateZ: 0,
    lowZ: 0,
    highZ: 0,
    stopReason: null,
    upperBoundOnly: failures === 0,
    rate,
  };
}

function shotsOf(container: HTMLElement, d: number): number {
  return Number(
    container
      .querySelector(`.chart__stats tr[data-d="${d}"] [data-live-shots]`)!
      .getAttribute("data-live-shots"),
  );
}

function lambdaOf(container: HTMLElement, d: number): string {
  return container
    .querySelector(`[data-lambda-d="${d}"] dd`)!
    .getAttribute("data-lambda")!;
}

function status(container: HTMLElement): HTMLElement {
  return container.querySelector(".chart__status")!;
}

describe("ChartPanel with a fake Worker", () => {
  it("starts one run with the grid and the user's p, counts live shots as progress arrives", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.08} createWorker={factory.create} />,
    );
    expect(factory.instances).toHaveLength(1);
    const worker = factory.instances[0]!;
    const start = worker.starts[0]!;
    expect(start.userP).toBe(0.08);
    expect(start.distances).toEqual(BASELINE.distances);
    expect(start.probabilities).toEqual(BASELINE.probabilities);
    expect(start.seedBase).toBeLessThan(2 ** 52);
    expect(shotsOf(container, 3)).toBe(0);
    expect(status(container).textContent).toBe(i18n.t("chart.running"));

    worker.emit({
      type: "progress",
      runId: start.runId,
      points: [livePoint(3, 0.1, 10, 100), livePoint(3, 0.08, 5, 100)],
    });
    expect(shotsOf(container, 3)).toBe(200);
    worker.emit({
      type: "progress",
      runId: start.runId,
      points: [livePoint(3, 0.1, 30, 300), livePoint(3, 0.08, 12, 300)],
    });
    expect(shotsOf(container, 3)).toBe(600);
    expect(shotsOf(container, 5)).toBe(0);
  });

  it("shows Λ at the user's p once both points have a failure, undefined before", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.08} createWorker={factory.create} />,
    );
    const worker = factory.instances[0]!;
    const runId = worker.starts[0]!.runId;
    expect(lambdaOf(container, 3)).toBe("");
    expect(container.querySelector('[data-lambda-d="3"] dd')?.textContent).toBe(
      i18n.t("chart.lambda.undefined"),
    );
    worker.emit({
      type: "progress",
      runId,
      points: [livePoint(3, 0.08, 20, 1000), livePoint(5, 0.08, 0, 1000)],
    });
    expect(lambdaOf(container, 3)).toBe("");
    worker.emit({
      type: "progress",
      runId,
      points: [livePoint(3, 0.08, 20, 1000), livePoint(5, 0.08, 10, 1000)],
    });
    expect(Number(lambdaOf(container, 3))).toBeCloseTo(2, 12);
    expect(lambdaOf(container, 5)).toBe("");
  });

  it("with no progress at all, Λ at a grid p comes from the base counts", () => {
    // The base alone defines Λ(3 → 5) at p = 0.1 as
    // k(3, 0.1) / k(5, 0.1) with N equal: 22569 / 23430 in browser.json.
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.1} createWorker={factory.create} />,
    );
    const k = (d: number) =>
      BASELINE.points.find((pt) => pt.d === d && pt.p === 0.1)!.failures;
    expect(k(3)).toBe(22_569);
    expect(k(5)).toBe(23_430);
    expect(Number(lambdaOf(container, 3))).toBeCloseTo(22_569 / 23_430, 12);
    expect(Number(lambdaOf(container, 5))).toBeCloseTo(23_430 / 23_822, 12);
  });

  it("the visible Λ text carries ratioInterval's low and high, not the ratio twice", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.1} createWorker={factory.create} />,
    );
    const base = (d: number) =>
      BASELINE.points.find((pt) => pt.d === d && pt.p === 0.1)!;
    const expected = ratioInterval(
      base(3).failures,
      base(3).shots,
      base(5).failures,
      base(5).shots,
    )!;
    const text = container.querySelector(
      '[data-lambda-d="3"] dd',
    )!.textContent!;
    const numbers = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((s) =>
      Number(s.replace(",", ".")),
    );
    // "<ratio> (95 % interval <low> to <high>)": the 95 is the only other figure.
    const shown = numbers.filter((n) => n !== 95);
    expect(shown).toHaveLength(3);
    const [ratio, low, high] = shown as [number, number, number];
    expect(Math.abs(ratio - expected.ratio)).toBeLessThan(0.0051);
    expect(Math.abs(low - expected.low)).toBeLessThan(0.0051);
    expect(Math.abs(high - expected.high)).toBeLessThan(0.0051);
    expect(low).toBeLessThan(ratio);
    expect(ratio).toBeLessThan(high);
  });

  it("the shots/s shown for a curve is the rate of the lane at the user's p, not the fastest lane", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.1} createWorker={factory.create} />,
    );
    const worker = factory.instances[0]!;
    const main = worker.starts[0]!;
    worker.emit({
      type: "progress",
      runId: main.runId,
      points: [
        { ...livePoint(7, 0.1, 10, 100), rate: 400 },
        { ...livePoint(7, 0.03, 1, 100), rate: 9000 },
      ],
    });
    const cell = container.querySelector(
      '.chart__stats tr[data-d="7"] [data-rate]',
    )!;
    expect(cell.getAttribute("data-rate")).toBe("400");
  });

  it("the base line reports the shots per point: one figure for a uniform base, the range otherwise", () => {
    const factory = fakeWorkerFactory();
    const uniform = render(
      <ChartPanel p={0.1} createWorker={factory.create} />,
    );
    expect(uniform.container.querySelector(".chart__base")!.textContent).toBe(
      i18n.t("chart.base", { shots: 100_000 }),
    );
    uniform.unmount();
    // The validation rule may give a point more shots (≥ 100
    // failures AND ≥ 10⁵ shots, cap 10⁶); the text must not take points[0].
    const uneven = {
      ...BASELINE,
      points: BASELINE.points.map((pt, i) =>
        i === BASELINE.points.length - 1 ? { ...pt, shots: 250_000 } : pt,
      ),
    };
    const ranged = render(
      <ChartPanel p={0.1} createWorker={factory.create} baseline={uneven} />,
    );
    expect(ranged.container.querySelector(".chart__base")!.textContent).toBe(
      i18n.t("chart.baseRange", { min: 100_000, max: 250_000 }),
    );
  });

  it("a p within 10⁻⁶ of a grid value is that grid point: lanes, Λ and the start message", () => {
    // pointSeed rounds p·10⁶; 0.030000000000000002 is 0.03.
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.030000000000000002} createWorker={factory.create} />,
    );
    const worker = factory.instances[0]!;
    expect(worker.starts[0]!.userP).toBe(0.03);
    const k = (d: number) =>
      BASELINE.points.find((pt) => pt.d === d && pt.p === 0.03)!.failures;
    expect(Number(lambdaOf(container, 3))).toBeCloseTo(k(3) / k(5), 12);
    expect(
      container.querySelector(".chart__user-p")!.getAttribute("data-user-p"),
    ).toBe("0.03");
  });

  it("ignores a progress with a foreign runId", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.08} createWorker={factory.create} />,
    );
    const worker = factory.instances[0]!;
    const runId = worker.starts[0]!.runId;
    worker.emit({
      type: "progress",
      runId: runId + 1000,
      points: [livePoint(3, 0.08, 20, 1000)],
    });
    expect(shotsOf(container, 3)).toBe(0);
  });

  it("terminates the Worker on unmount; under StrictMode exactly one instance stays alive", () => {
    const factory = fakeWorkerFactory();
    const { unmount } = render(
      <StrictMode>
        <ChartPanel p={0.08} createWorker={factory.create} />
      </StrictMode>,
    );
    expect(factory.alive()).toHaveLength(1);
    unmount();
    expect(factory.alive()).toHaveLength(0);
    expect(factory.instances.length).toBeGreaterThanOrEqual(1);
  });

  it("re-aims the user lane with setUserP while the run goes; starts a user-only run after done", () => {
    const factory = fakeWorkerFactory();
    function Host() {
      const [p, setP] = useState(0.08);
      return (
        <>
          <button onClick={() => setP(0.12)} data-testid="to-012" />
          <button onClick={() => setP(0.1)} data-testid="to-01" />
          <button onClick={() => setP(0.06)} data-testid="to-006" />
          <ChartPanel p={p} createWorker={factory.create} />
        </>
      );
    }
    const { container, getByTestId } = render(<Host />);
    const worker = factory.instances[0]!;
    const main = worker.starts[0]!;
    act(() => getByTestId("to-012").click());
    expect(worker.posted.at(-1)).toEqual({
      type: "setUserP",
      runId: main.runId,
      p: 0.12,
    });
    // The user lane at 0.08 vanishes with the move: only p = 0.12 counts.
    worker.emit({
      type: "progress",
      runId: main.runId,
      points: [livePoint(3, 0.12, 30, 100), livePoint(3, 0.1, 10, 100)],
    });
    expect(shotsOf(container, 3)).toBe(200);
    worker.emit({ type: "done", runId: main.runId, elapsedMs: 400 });
    expect(status(container).getAttribute("data-done")).toBe("1");
    expect(status(container).textContent).toContain("0.4");

    // After done, a p on the grid needs no run; a p off the grid gets a user-only run.
    const before = worker.posted.length;
    act(() => getByTestId("to-01").click());
    expect(worker.posted).toHaveLength(before);
    act(() => getByTestId("to-006").click());
    const userRun = worker.starts.at(-1)!;
    expect(userRun.runId).not.toBe(main.runId);
    expect(userRun.probabilities).toEqual([]);
    expect(userRun.userP).toBe(0.06);
    worker.emit({
      type: "progress",
      runId: userRun.runId,
      points: [livePoint(3, 0.06, 5, 100), livePoint(5, 0.06, 2, 100)].map(
        (pt) => ({ ...pt, stopReason: "shots" as const }),
      ),
    });
    expect(status(container).textContent).toBe(i18n.t("chart.running"));
    expect(Number(lambdaOf(container, 3))).toBeCloseTo(2.5, 12);
    // The main run's grid lanes stay (p = 0.1 is on the grid), its stale 0.12 lane is gone.
    expect(shotsOf(container, 3)).toBe(200);
    worker.emit({ type: "done", runId: userRun.runId, elapsedMs: 700 });
    expect(status(container).getAttribute("data-done")).toBe("1");
    // The status reports the run that just finished, not the main run's 0.4 s.
    expect(status(container).textContent).toBe(
      i18n.t("chart.done", { seconds: "0.7" }),
    );
    expect(factory.instances).toHaveLength(1);
  });

  it("a p changed while the main run finishes (its setUserP never read) gets a user-only run on done", () => {
    // Reproduced in Chrome (2 of 60 tries). The Worker
    // posts done after its last turn and reads no more messages; the hook must
    // not trust the setUserP it sent, only the last progress it saw.
    const factory = fakeWorkerFactory();
    function Host() {
      const [p, setP] = useState(0.08);
      return (
        <>
          <button onClick={() => setP(0.12)} data-testid="to-012" />
          <ChartPanel p={p} createWorker={factory.create} />
        </>
      );
    }
    const { container, getByTestId } = render(<Host />);
    const worker = factory.instances[0]!;
    const main = worker.starts[0]!;
    worker.emit({
      type: "progress",
      runId: main.runId,
      points: [livePoint(3, 0.08, 5, 100), livePoint(3, 0.1, 10, 100)],
    });
    act(() => getByTestId("to-012").click());
    expect(worker.posted.at(-1)).toEqual({
      type: "setUserP",
      runId: main.runId,
      p: 0.12,
    });
    worker.emit({ type: "done", runId: main.runId, elapsedMs: 400 });
    expect(worker.starts).toHaveLength(2);
    const userRun = worker.starts[1]!;
    expect(userRun.runId).not.toBe(main.runId);
    expect(userRun.userP).toBe(0.12);
    expect(userRun.probabilities).toEqual([]);
    worker.emit({
      type: "progress",
      runId: userRun.runId,
      points: [livePoint(3, 0.12, 30, 100), livePoint(5, 0.12, 15, 100)].map(
        (pt) => ({ ...pt, stopReason: "shots" as const }),
      ),
    });
    expect(status(container).textContent).toBe(i18n.t("chart.running"));
    expect(Number(lambdaOf(container, 3))).toBeCloseTo(2, 12);
    worker.emit({ type: "done", runId: userRun.runId, elapsedMs: 700 });
    expect(status(container).textContent).toBe(
      i18n.t("chart.done", { seconds: "0.7" }),
    );
    // Nothing else was started: one Worker, two runs.
    expect(worker.starts).toHaveLength(2);
    expect(factory.instances).toHaveLength(1);
  });

  it("reports an error message and an unavailable Worker", async () => {
    const factory = fakeWorkerFactory();
    const errored = render(
      <ChartPanel p={0.08} createWorker={factory.create} />,
    );
    const worker = factory.instances[0]!;
    worker.emit({
      type: "error",
      runId: worker.starts[0]!.runId,
      message: "boom",
    });
    expect(status(errored.container).textContent).toBe(
      i18n.t("chart.error", { message: "boom" }),
    );
    errored.unmount();

    const none = render(<ChartPanel p={0.08} createWorker={() => null} />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(status(none.container).textContent).toBe(
      i18n.t("chart.unavailable"),
    );
  });

  it("a Worker whose script fails (onerror: the build superseded by a service worker update) says so in both locales and keeps the base curves", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.08} createWorker={factory.create} />,
    );
    const worker = factory.instances[0]!;
    const before = container.querySelectorAll(".curve--d3 .marker").length;
    expect(before).toBeGreaterThan(0);
    worker.fail();
    expect(status(container).textContent).toBe(i18n.t("chart.workerLost"));
    expect(i18n.t("chart.workerLost", { lng: "es" })).not.toBe(
      i18n.t("chart.workerLost", { lng: "en" }),
    );
    expect(container.querySelectorAll(".curve--d3 .marker").length).toBe(
      before,
    );
  });
});

describe("ChartPanel: noise model (phase 2)", () => {
  function Host({
    factory,
  }: {
    factory: ReturnType<typeof fakeWorkerFactory>;
  }) {
    const [model, setModel] = useState<NoiseKind>("independent");
    const [calls, setCalls] = useState(0);
    return (
      <>
        <span data-testid="calls">{calls}</span>
        <ChartPanel
          p={0.03}
          model={model}
          onModelChange={(next) => {
            setCalls((n) => n + 1);
            setModel(next);
          }}
          createWorker={factory.create}
        />
      </>
    );
  }
  const radio = (model: NoiseKind) =>
    screen.getByRole("radio", { name: i18n.t(`chart.modelSelect.${model}`) });

  it("renders a fieldset with one radio per model, the current one checked, and the start names the model", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel
        p={0.03}
        model="phenomenological"
        onModelChange={() => {}}
        createWorker={factory.create}
      />,
    );
    const fieldset = container.querySelector("fieldset.model-select")!;
    expect(fieldset.querySelector("legend")!.textContent).toBe(
      i18n.t("chart.modelSelect.label"),
    );
    expect(fieldset.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect((radio("phenomenological") as HTMLInputElement).checked).toBe(true);
    expect((radio("independent") as HTMLInputElement).checked).toBe(false);
    const start = factory.instances[0]!.starts[0]!;
    expect(start.model).toBe("phenomenological");
    expect(start.probabilities).toEqual(
      BASELINES.phenomenological.probabilities,
    );
    expect(
      container.querySelector(".chart__base")!.getAttribute("data-base-model"),
    ).toBe("phenomenological");
  });

  it("without a model it shows the phase 1 base and its label (tests of the phase 1 behaviour)", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.03} createWorker={factory.create} />,
    );
    expect(factory.instances[0]!.starts[0]!.model).toBe("independent");
    expect(container.querySelector(".chart__model")!.textContent).toBe(
      i18n.t("chart.model.independent"),
    );
  });

  it("the selector calls onModelChange; the new model swaps the label and the base and starts a new run with the model on the SAME Worker", () => {
    const factory = fakeWorkerFactory();
    const { container, getByTestId } = render(<Host factory={factory} />);
    const first = factory.instances[0]!;
    expect(first.starts[0]!.model).toBe("independent");
    expect(container.querySelector(".chart__model")!.textContent).toBe(
      i18n.t("chart.model.independent"),
    );
    // Live points of the first model at a p both grids share.
    first.emit({
      type: "progress",
      runId: first.starts[0]!.runId,
      points: [livePoint(3, 0.03, 10, 1000)],
    });
    expect(shotsOf(container, 3)).toBe(1000);

    fireEvent.click(radio("phenomenological"));
    expect(getByTestId("calls").textContent).toBe("1");
    expect((radio("phenomenological") as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector(".chart__model")!.textContent).toBe(
      i18n.t("chart.model.phenomenological"),
    );
    expect(
      container.querySelector(".chart__base")!.getAttribute("data-base-model"),
    ).toBe("phenomenological");
    // No new Worker (its hashed script would be requested again, and after a
    // service worker update an old tab gets text/html for it): a second start
    // on the same instance; sim.worker.ts stops the first run on receiving it.
    expect(first.terminated).toBe(false);
    expect(factory.instances).toHaveLength(1);
    expect(first.starts).toHaveLength(2);
    const start = first.starts[1]!;
    expect(start.model).toBe("phenomenological");
    expect(start.distances).toEqual(BASELINES.phenomenological.distances);
    expect(start.probabilities).toEqual(
      BASELINES.phenomenological.probabilities,
    );
    expect(start.userP).toBe(0.03);
    // The first model's live shots at p = 0.03 are not pooled into the new base.
    expect(shotsOf(container, 3)).toBe(0);
    expect(status(container).textContent).toBe(i18n.t("chart.running"));
    // The base markers are the new grid's.
    const ps = [...container.querySelectorAll(".curve--d3 .marker")].map((m) =>
      Number(m.getAttribute("data-p")),
    );
    expect(ps).toEqual(BASELINES.phenomenological.probabilities);
  });

  it("a done of the old model's run arriving late is ignored: the status stays running until the new run reports", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(<Host factory={factory} />);
    const first = factory.instances[0]!;
    const runId = first.starts[0]!.runId;
    first.emit({ type: "done", runId, elapsedMs: 400 });
    expect(status(container).getAttribute("data-done")).toBe("1");
    fireEvent.click(radio("phenomenological"));
    expect(status(container).getAttribute("data-done")).toBe("0");
    expect(status(container).textContent).toBe(i18n.t("chart.running"));
    const second = factory.alive()[0]!;
    // The new run reports its lanes (the user's p among them) and finishes.
    second.emit({
      type: "progress",
      runId: second.starts.at(-1)!.runId,
      points: [livePoint(3, 0.03, 5, 100)].map((pt) => ({
        ...pt,
        stopReason: "shots" as const,
      })),
    });
    second.emit({
      type: "done",
      runId: second.starts.at(-1)!.runId,
      elapsedMs: 900,
    });
    expect(status(container).textContent).toBe(
      i18n.t("chart.done", { seconds: "0.9" }),
    );
  });

  it("a quick A → B → A (back before B's Worker reports) is a fresh A run: no shots and no «finished» inherited from the first A run", () => {
    // The state is the RUN's, not the model's: the first A run's 5 000 shots
    // and its done belong to a run the Worker was told to stop.
    const factory = fakeWorkerFactory();
    const { container } = render(<Host factory={factory} />);
    const first = factory.instances[0]!;
    const firstRun = first.starts[0]!.runId;
    first.emit({
      type: "progress",
      runId: firstRun,
      points: [livePoint(3, 0.03, 50, 5000)].map((pt) => ({
        ...pt,
        stopReason: "shots" as const,
      })),
    });
    first.emit({ type: "done", runId: firstRun, elapsedMs: 400 });
    expect(shotsOf(container, 3)).toBe(5000);
    expect(status(container).getAttribute("data-done")).toBe("1");

    fireEvent.click(radio("phenomenological"));
    fireEvent.click(radio("independent"));
    expect(factory.instances).toHaveLength(1);
    const third = factory.alive()[0]!;
    expect(third.starts).toHaveLength(3);
    const thirdRun = third.starts[2]!;
    expect(thirdRun.model).toBe("independent");
    expect(thirdRun.runId).not.toBe(firstRun);
    expect(shotsOf(container, 3)).toBe(0);
    expect(status(container).getAttribute("data-done")).toBe("0");
    expect(status(container).textContent).toBe(i18n.t("chart.running"));

    third.emit({
      type: "progress",
      runId: thirdRun.runId,
      points: [livePoint(3, 0.03, 1, 100)],
    });
    expect(shotsOf(container, 3)).toBe(100);
    expect(status(container).getAttribute("data-done")).toBe("0");
    expect(status(container).textContent).toBe(i18n.t("chart.running"));
    third.emit({ type: "done", runId: thirdRun.runId, elapsedMs: 900 });
    expect(status(container).getAttribute("data-done")).toBe("1");
    expect(status(container).textContent).toBe(
      i18n.t("chart.done", { seconds: "0.9" }),
    );
  });

  it("A → B (B finishes) → A → B quickly: the second B run inherits nothing from the first B run", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(<Host factory={factory} />);
    const first = factory.instances[0]!;
    first.emit({ type: "done", runId: first.starts[0]!.runId, elapsedMs: 400 });

    fireEvent.click(radio("phenomenological"));
    // The same Worker carries every run: the first run's done at a p without a
    // lane started a user run before the click, so the B run is the LAST start.
    const second = factory.alive()[0]!;
    const secondRun = second.starts.at(-1)!.runId;
    second.emit({
      type: "progress",
      runId: secondRun,
      points: [livePoint(3, 0.03, 40, 4000)].map((pt) => ({
        ...pt,
        stopReason: "shots" as const,
      })),
    });
    second.emit({ type: "done", runId: secondRun, elapsedMs: 800 });
    expect(shotsOf(container, 3)).toBe(4000);
    expect(status(container).getAttribute("data-done")).toBe("1");

    fireEvent.click(radio("independent"));
    fireEvent.click(radio("phenomenological"));
    expect(factory.instances).toHaveLength(1);
    const fourth = factory.alive()[0]!;
    const fourthRun = fourth.starts.at(-1)!;
    expect(fourthRun.model).toBe("phenomenological");
    expect(fourthRun.runId).not.toBe(secondRun);
    expect(shotsOf(container, 3)).toBe(0);
    expect(status(container).getAttribute("data-done")).toBe("0");
    expect(status(container).textContent).toBe(i18n.t("chart.running"));

    fourth.emit({
      type: "progress",
      runId: fourthRun.runId,
      points: [livePoint(3, 0.03, 2, 200)],
    });
    expect(shotsOf(container, 3)).toBe(200);
    expect(status(container).getAttribute("data-done")).toBe("0");
    fourth.emit({ type: "done", runId: fourthRun.runId, elapsedMs: 1200 });
    expect(status(container).textContent).toBe(
      i18n.t("chart.done", { seconds: "1.2" }),
    );
  });

  it("the x axis ends at 20 % under the phase 1 model and at 5 % under the phenomenological one, stretched to a p beyond it", () => {
    const factory = fakeWorkerFactory();
    const ticks = (container: HTMLElement) =>
      [
        ...container.querySelectorAll(
          ".chart__axis--x text:not(.chart__axis-label)",
        ),
      ].map((el) => el.textContent);
    const independent = render(
      <ChartPanel p={0.03} createWorker={factory.create} />,
    );
    expect(ticks(independent.container)).toEqual([
      "0%",
      "5%",
      "10%",
      "15%",
      "20%",
    ]);
    independent.unmount();
    const narrow = render(
      <ChartPanel
        p={0.01}
        model="phenomenological"
        onModelChange={() => {}}
        createWorker={factory.create}
      />,
    );
    expect(ticks(narrow.container)).toEqual([
      "0%",
      "1%",
      "2%",
      "3%",
      "4%",
      "5%",
    ]);
    // Every base marker lies inside the plot: the DRAWN geometry (a circle's
    // cx, a rect's centre, a polygon's centroid), not the data-cx hook.
    const axis = narrow.container.querySelector(".chart__axis--x line")!;
    const right = Number(axis.getAttribute("x2"));
    const left = Number(axis.getAttribute("x1"));
    const dots = narrow.container.querySelectorAll(".marker__dot");
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      const { x } = drawnCentre(dot);
      expect(x).toBeLessThanOrEqual(right);
      expect(x).toBeGreaterThanOrEqual(left);
    }
    narrow.rerender(
      <ChartPanel
        p={0.08}
        model="phenomenological"
        onModelChange={() => {}}
        createWorker={factory.create}
      />,
    );
    expect(ticks(narrow.container).at(-1)).toBe("8%");
    expect(narrow.container.querySelector(".chart__user-p")).not.toBeNull();
  });

  it("shows the phenomenological explanation only under that model, and the chart ones under both", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(<Host factory={factory} />);
    const titles = () =>
      [...container.querySelectorAll(".panel--chart .explain__button")].map(
        (b) => b.textContent!.replace(/^\?/, ""),
      );
    const chart = ["threshold", "lambda", "logAxis", "upperBound"].map((id) =>
      i18n.t(`explain.${id}.title`),
    );
    expect(titles()).toEqual(chart);
    fireEvent.click(radio("phenomenological"));
    expect(titles()).toEqual([
      i18n.t("explain.phenomenological.title"),
      ...chart,
    ]);
  });
});

describe("ChartPanel", () => {
  it("at p = 0 Λ says there is no noise to compare, and the core agrees: no shot fails at p = 0", () => {
    // The claim of chart.lambda.noNoise as a predicate on the core (a physics sentence is measured, not read by eye):
    // independent noise at p = 0 draws the identity, whose verdict is 0.
    for (const d of [3, 5, 7]) {
      const ctx = createTraceContext(d);
      const error = identity(d * d);
      for (let seed = 0; seed < 50; seed++) {
        sampleNoise(independentNoise(0), createRng(seed), error);
        expect(weight(error)).toBe(0);
        expect(decodeTrace(ctx, error).verdict).toBe(0);
      }
    }
    const factory = fakeWorkerFactory();
    const { container, rerender } = render(
      <ChartPanel p={0} createWorker={factory.create} />,
    );
    for (const d of [3, 5]) {
      const dd = container.querySelector(`[data-lambda-d="${d}"] dd`)!;
      expect(dd.getAttribute("data-lambda")).toBe("");
      expect(dd.textContent).toBe(i18n.t("chart.lambda.noNoise"));
    }
    // Away from 0 the "not defined" text is back.
    rerender(<ChartPanel p={0.005} createWorker={factory.create} />);
    expect(container.querySelector('[data-lambda-d="3"] dd')!.textContent).toBe(
      i18n.t("chart.lambda.undefined"),
    );
  });

  it("an end of the Λ interval that rounds to 1 is shown with enough decimals, never as «1» nor «1.000»", () => {
    // Counts whose upper end rounds to 1.00 at two decimals but is below 1.
    const n = 100_000;
    const k3 = 10_000;
    let k5 = 0;
    let high = 0;
    for (let k = 10_000; k < 10_600 && k5 === 0; k++) {
      const r = ratioInterval(k3, n, k, n)!;
      if (Math.round(r.high * 100) === 100 && r.high < 1) {
        k5 = k;
        high = r.high;
      }
    }
    expect(k5).toBeGreaterThan(0);
    const baseline = {
      ...BASELINE,
      points: BASELINE.points.map((pt) => {
        if (pt.p !== 0.1 || pt.d === 7) return pt;
        const failures = pt.d === 3 ? k3 : k5;
        const { low, high: top } = wilsonInterval(failures, n);
        return {
          ...pt,
          shots: n,
          failures,
          estimate: failures / n,
          low,
          high: top,
          upperBoundOnly: false,
        };
      }),
    };
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={0.1} createWorker={factory.create} baseline={baseline} />,
    );
    const text = container.querySelector(
      '[data-lambda-d="3"] dd',
    )!.textContent!;
    // The shown end is formatRatio's, and whatever it is, it is not a 1.
    expect(text).toContain(formatRatio(high, "en"));
    expect(text).not.toMatch(/to 1(\.0+)?\)$/);
    expect(Number(/to ([\d.]+)\)$/.exec(text)![1])).toBeLessThan(1);
  });
});
