// @vitest-environment jsdom
// The hook's state belongs to a generation of the main run, allocated on the
// render that changes ANY input of the start effect, not only the model
// (with `distances` or `budgetMs` out of the inputs
// the Worker restarted with the same runId and inherited the old `elapsedMs`,
// and no test of the branch saw it). Adapted from an independent probe.
//
// The Worker is ONE per mount: a new generation
// posts a new start on the same instance (sim.worker.ts stops the run that is
// going); re-creating it asked the network for the Worker's hashed URL on every
// model change, which a tab superseded by a new service worker no longer gets.
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, useLayoutEffect, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeWorkerFactory } from "../../../tests/helpers/fake-worker";
import type { NoiseKind } from "../../worker/protocol";
import { BASELINES } from "./baseline";
import { livePoint } from "./ChartPanel.test";
import { useSimulation, type SimulationState } from "./useSimulation";

afterEach(cleanup);

interface Props {
  readonly p: number;
  readonly model: NoiseKind;
  readonly factory: ReturnType<typeof fakeWorkerFactory>;
  readonly distances?: readonly number[];
  readonly budgetMs?: number;
  readonly log: SimulationState[];
}

function Probe({ p, model, factory, distances, budgetMs, log }: Props) {
  const state = useSimulation(p, {
    createWorker: factory.create,
    model,
    distances: distances ?? BASELINES[model].distances,
    probabilities: BASELINES[model].probabilities,
    ...(budgetMs === undefined ? {} : { budgetMs }),
  });
  useLayoutEffect(() => {
    log.push(state);
  });
  return null;
}

const shots = (s: SimulationState) =>
  s.live.reduce((total, pt) => total + pt.shots, 0);
const finished = (pts: ReturnType<typeof livePoint>[]) =>
  pts.map((pt) => ({ ...pt, stopReason: "shots" as const }));

describe("useSimulation: a generation per start input, one Worker per mount", () => {
  for (const strict of [false, true]) {
    const wrap = (el: ReactElement) =>
      strict ? <StrictMode>{el}</StrictMode> : el;

    it(`${strict ? "StrictMode" : "plain"}: a change of distances or budget starts a new run (new runId, clean clock, no inherited shots) on the SAME Worker; unmount leaves 0 Workers`, () => {
      const factory = fakeWorkerFactory();
      const log: SimulationState[] = [];
      const props = { p: 0.03, factory, log, model: "independent" as const };
      const r = render(wrap(<Probe {...props} />));
      expect(factory.alive()).toHaveLength(1);
      const w = factory.alive()[0]!;
      const run1 = w.starts[0]!.runId;
      act(() => {
        w.emit({
          type: "progress",
          runId: run1,
          points: finished([livePoint(3, 0.03, 9, 900)]),
        });
        w.emit({ type: "done", runId: run1, elapsedMs: 300 });
      });
      expect(log.at(-1)!.elapsedMs).toBe(300);
      expect(shots(log.at(-1)!)).toBe(900);

      // A new array identity for `distances` is a new generation: a second
      // start on the same Worker, no instance created, none terminated.
      const narrower = [3, 5];
      const created = factory.instances.length;
      r.rerender(wrap(<Probe {...props} distances={narrower} />));
      expect(factory.instances.length).toBe(created);
      expect(w.terminated).toBe(false);
      expect(w.starts).toHaveLength(2);
      const run2 = w.starts[1]!.runId;
      expect(run2).not.toBe(run1);
      expect(w.starts[1]!.distances).toEqual(narrower);
      expect(log.at(-1)!.elapsedMs).toBeNull();
      expect(shots(log.at(-1)!)).toBe(0);
      // A late message of the stopped run is not news.
      w.emit({ type: "done", runId: run1, elapsedMs: 999 });
      expect(log.at(-1)!.elapsedMs).toBeNull();
      act(() => {
        w.emit({
          type: "progress",
          runId: run2,
          points: finished([livePoint(3, 0.03, 7, 700)]),
        });
        w.emit({ type: "done", runId: run2, elapsedMs: 301 });
      });
      expect(log.at(-1)!.elapsedMs).toBe(301);
      expect(shots(log.at(-1)!)).toBe(700);

      // So is a new budget.
      r.rerender(
        wrap(<Probe {...props} distances={narrower} budgetMs={1234} />),
      );
      expect(factory.instances.length).toBe(created);
      expect(w.starts).toHaveLength(3);
      expect(w.starts[2]!.budgetMs).toBe(1234);
      expect(w.starts[2]!.runId).not.toBe(run2);
      expect(log.at(-1)!.elapsedMs).toBeNull();
      expect(shots(log.at(-1)!)).toBe(0);

      // The same identities are the same generation: no new start.
      r.rerender(
        wrap(<Probe {...props} distances={narrower} budgetMs={1234} />),
      );
      expect(w.starts).toHaveLength(3);

      r.unmount();
      expect(factory.alive()).toHaveLength(0);
    });
  }

  it("a new createWorker is a new Worker: the old one is terminated, the new one gets the start", () => {
    const first = fakeWorkerFactory();
    const second = fakeWorkerFactory();
    const log: SimulationState[] = [];
    const r = render(
      <Probe p={0.03} model="independent" factory={first} log={log} />,
    );
    expect(first.alive()).toHaveLength(1);
    r.rerender(
      <Probe p={0.03} model="independent" factory={second} log={log} />,
    );
    expect(first.alive()).toHaveLength(0);
    expect(second.alive()).toHaveLength(1);
    expect(second.alive()[0]!.starts).toHaveLength(1);
  });

  it("the Worker's own failure (onerror) is reported as `lost`, whatever run was going, and stays through later generations", () => {
    const factory = fakeWorkerFactory();
    const log: SimulationState[] = [];
    const props = { p: 0.03, factory, log, model: "independent" as const };
    const r = render(<Probe {...props} />);
    const w = factory.alive()[0]!;
    expect(log.at(-1)!.lost).toBe(false);
    w.fail();
    expect(log.at(-1)!.lost).toBe(true);
    expect(log.at(-1)!.error).toBeNull();
    // A new generation posts its start into the void: still lost.
    r.rerender(<Probe {...props} distances={[3, 5]} />);
    expect(log.at(-1)!.lost).toBe(true);
    r.unmount();
    expect(factory.alive()).toHaveLength(0);
  });
});
