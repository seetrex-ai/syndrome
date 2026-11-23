// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BASELINE } from "../../src/ui/chart/baseline";
import { ChartPanel } from "../../src/ui/chart/ChartPanel";
import {
  BROWSER_STOP_RULE,
  stopMessage,
  type MainToWorker,
  type ProgressMessage,
  type StartMessage,
} from "../../src/worker/protocol";
import { runSimulation } from "../../src/worker/simulate";
import { fakeWorkerFactory } from "../helpers/fake-worker";

afterEach(cleanup);

/**
 * test_scenario_ui_live_refines_base
 *
 * De extremo a extremo (tasks/plans/ui.md §4): el núcleo simula de verdad en Node
 * (`runSimulation` con reloj falso sobre la malla real y el p del usuario), se graban
 * sus mensajes `progress` como fixture y un Worker falso se los reproduce al panel.
 * Lo que se ve: las curvas base (10⁵ tiradas por punto) están desde el primer render; la
 * `N` del punto (3, 0,10) pasa de 10⁵ a 10⁵ + N_vivas; el intervalo se estrecha; Λ en el
 * p del usuario muestra un valor con intervalo. Cruza D3 (fusión de conteos por (d, p)
 * idénticos), D4 (dibujo) y D6 (Worker inyectable).
 */

const USER_P = 0.12;
const TURNS = 6;
const recorded: ProgressMessage[] = [];

beforeAll(async () => {
  const request: StartMessage = {
    type: "start",
    runId: 99,
    model: BASELINE.noise,
    distances: BASELINE.distances,
    probabilities: BASELINE.probabilities,
    userP: USER_P,
    seedBase: 20261017,
    rule: BROWSER_STOP_RULE,
    budgetMs: 60_000,
    targetBatchMs: 5,
  };
  const queue: MainToWorker[] = [];
  let readings = 0;
  await runSimulation(
    request,
    (m) => {
      if (m.type === "progress") {
        recorded.push(m);
        if (recorded.length === TURNS) queue.push(stopMessage(99));
      }
    },
    () => queue.splice(0),
    { now: () => ++readings, yield: () => Promise.resolve() },
  );
  expect(recorded).toHaveLength(TURNS);
});

function pointData(container: HTMLElement, d: number, p: number) {
  const marker = container.querySelector(
    `.curve--d${d} .marker[data-p="${p}"]`,
  );
  if (marker === null) throw new Error(`no marker for d = ${d}, p = ${p}`);
  const bar = marker.querySelector(".marker__bar")!;
  return {
    live: marker.getAttribute("data-live"),
    barLength: Number(bar.getAttribute("y2")) - Number(bar.getAttribute("y1")),
  };
}

describe("test_scenario_ui_live_refines_base", () => {
  it("base curves at once, N grows by the live shots, the interval narrows, Λ appears at the user's p", () => {
    const factory = fakeWorkerFactory();
    const { container } = render(
      <ChartPanel p={USER_P} createWorker={factory.create} />,
    );
    const worker = factory.instances[0]!;
    const runId = worker.starts[0]!.runId;

    // Before any progress: 24 base markers, none live, no user point.
    expect(container.querySelectorAll(".marker__dot")).toHaveLength(24);
    expect(container.querySelectorAll('[data-live="1"]')).toHaveLength(0);
    const baseBar = pointData(container, 3, 0.1).barLength;
    expect(
      container
        .querySelector('[data-lambda-d="3"] dd')!
        .getAttribute("data-lambda"),
    ).toBe("");

    const replay = (message: ProgressMessage) =>
      worker.emit({ ...message, runId });

    replay(recorded[0]!);
    const liveAfter1 = recorded[0]!.points.find(
      (pt) => pt.d === 3 && pt.p === 0.1,
    )!;
    const shots3 = Number(
      container
        .querySelector('.chart__stats tr[data-d="3"] [data-live-shots]')!
        .getAttribute("data-live-shots"),
    );
    expect(shots3).toBe(
      recorded[0]!.points
        .filter((pt) => pt.d === 3)
        .reduce((sum, pt) => sum + pt.shots, 0),
    );
    expect(liveAfter1.shots).toBeGreaterThan(0);
    expect(pointData(container, 3, 0.1).live).toBe("1");

    replay(recorded[TURNS - 1]!);
    const liveLast = recorded[TURNS - 1]!.points.find(
      (pt) => pt.d === 3 && pt.p === 0.1,
    )!;
    expect(liveLast.shots).toBeGreaterThan(liveAfter1.shots);
    const base = BASELINE.points.find((pt) => pt.d === 3 && pt.p === 0.1)!;
    // The pooled point: N = 10⁵ + N_live, which the panel renders through the bar
    // (shorter than the base bar: more shots, narrower Wilson) and the counter.
    expect(base.shots).toBe(100_000);
    expect(pointData(container, 3, 0.1).barLength).toBeLessThan(baseBar);
    const totalLive3 = recorded[TURNS - 1]!.points.filter(
      (pt) => pt.d === 3,
    ).reduce((sum, pt) => sum + pt.shots, 0);
    expect(
      Number(
        container
          .querySelector('.chart__stats tr[data-d="3"] [data-live-shots]')!
          .getAttribute("data-live-shots"),
      ),
    ).toBe(totalLive3);

    // Λ at p = 0.12 (above threshold, P_L ≈ 0.3): both points have failures by now.
    const lambda = container.querySelector('[data-lambda-d="3"] dd')!;
    expect(Number(lambda.getAttribute("data-lambda"))).toBeGreaterThan(0);
    expect(lambda.textContent).not.toBe("");
    // 27 markers: 24 base (pooled) + the three user lanes, drawn live.
    expect(
      container.querySelectorAll(".marker__dot, [data-upper-bound]"),
    ).toHaveLength(27);
  });
});
