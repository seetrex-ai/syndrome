import { describe, expect, it } from "vitest";
import {
  BROWSER_STOP_RULE,
  type MainToWorker,
  type ProgressMessage,
  type StartMessage,
  type WorkerToMain,
} from "../../src/worker/protocol";
import {
  FIRST_BATCH,
  runSimulation,
  type SimulationClock,
} from "../../src/worker/simulate";

/**
 * test_scenario_worker_round_robin
 *
 * Flujo del Worker de principio a fin con una malla reducida y un reloj falso
 * (tasks/plans/ui.md D3, §4): ningún punto recibe su segundo lote antes de que todos
 * tengan el primero; un `progress` por turno con todos los carriles; `done` al agotar el
 * presupuesto, con `elapsedMs` coherente con el reloj y todo carril no convergido parado
 * por `"budget"`. Interacción de las decisiones «turnos round-robin», «lotes por tiempo»,
 * «un progress por turno» y «presupuesto con cota», que los unitarios de `simulate.test.ts`
 * miran una a una.
 */

// 1 ms per reading: a 100-shot batch reads as 100 000 shots/s, so batches grow to
// 500 and the fast lane (d = 3, p = 0.1) converges before the budget while the
// sparse one (d = 7, p = 0.03: ≈ 17 500 shots to 100 failures) does not.
const STEP_MS = 1;
const BUDGET_MS = 60;

function clock(): SimulationClock & { readings: number } {
  const c = {
    readings: 0,
    now() {
      c.readings++;
      return c.readings * STEP_MS;
    },
    yield: () => Promise.resolve(),
  };
  return c;
}

const REQUEST: StartMessage = {
  type: "start",
  runId: 1,
  model: "independent",
  distances: [3, 5, 7],
  probabilities: [0.03, 0.1],
  userP: 0.06,
  seedBase: 42,
  rule: BROWSER_STOP_RULE,
  budgetMs: BUDGET_MS,
  targetBatchMs: 5,
};

describe("test_scenario_worker_round_robin", () => {
  it("runs the reduced grid to the budget: round-robin, one progress per turn, done with budget stops", async () => {
    const messages: WorkerToMain[] = [];
    const c = clock();
    await runSimulation(
      REQUEST,
      (m) => messages.push(m),
      (): MainToWorker[] => [],
      c,
    );
    const progress = messages.filter(
      (m): m is ProgressMessage => m.type === "progress",
    );
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(messages.at(-1)!.type).toBe("done");
    expect(messages.filter((m) => m.type === "done")).toHaveLength(1);

    // Turn 1: every one of the 9 lanes has exactly one batch, nobody has a second.
    const first = progress[0]!.points;
    expect(first).toHaveLength(9);
    for (const pt of first) {
      expect(pt.shots).toBeGreaterThan(0);
      expect(pt.shots).toBeLessThanOrEqual(FIRST_BATCH);
    }
    expect(first.slice(0, 3).map((pt) => pt.p)).toEqual([0.06, 0.06, 0.06]);
    expect(first.slice(3).map((pt) => [pt.d, pt.p])).toEqual([
      [3, 0.03],
      [5, 0.03],
      [7, 0.03],
      [3, 0.1],
      [5, 0.1],
      [7, 0.1],
    ]);

    // Every turn carries every lane, in the same order, with non-decreasing shots.
    for (let i = 1; i < progress.length; i++) {
      const prev = progress[i - 1]!.points;
      const cur = progress[i]!.points;
      expect(cur.map((pt) => [pt.d, pt.p])).toEqual(
        prev.map((pt) => [pt.d, pt.p]),
      );
      cur.forEach((pt, j) => {
        expect(pt.shots).toBeGreaterThanOrEqual(prev[j]!.shots);
      });
    }

    // At the budget: no lane is still sampling; the ones the rule did not stop say "budget".
    const last = progress.at(-1)!.points;
    expect(last.every((pt) => pt.stopReason !== null)).toBe(true);
    const reasons = new Set(last.map((pt) => pt.stopReason));
    expect(reasons.has("budget")).toBe(true);
    // p = 0.1 at d = 3 converges fast (P_L ≈ 0.2: 100 failures in ≈ 1 000 shots);
    // d = 7, p = 0.03 cannot within the budget.
    expect(["shots", "failures"]).toContain(
      last.find((pt) => pt.d === 3 && pt.p === 0.1)!.stopReason,
    );
    expect(last.find((pt) => pt.d === 7 && pt.p === 0.03)!.stopReason).toBe(
      "budget",
    );

    // elapsedMs is the fake clock's: a multiple of STEP_MS, at least the budget.
    const done = messages.at(-1)!;
    if (done.type !== "done") throw new Error("expected done");
    expect(done.elapsedMs % STEP_MS).toBe(0);
    expect(done.elapsedMs).toBeGreaterThanOrEqual(BUDGET_MS);
    expect(done.elapsedMs).toBeLessThan(c.readings * STEP_MS + STEP_MS);
  });
});
