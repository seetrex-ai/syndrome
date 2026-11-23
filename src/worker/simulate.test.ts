import { describe, expect, it } from "vitest";
import {
  estimatePoint,
  INDEPENDENT_MODEL,
  PHENOMENOLOGICAL_MODEL,
  pointSeed,
  rotatedSurfaceCode,
} from "../core/index";
import {
  BROWSER_STOP_RULE,
  setUserPMessage,
  stopMessage,
  type LivePoint,
  type MainToWorker,
  type NoiseKind,
  type ProgressMessage,
  type StartMessage,
  type WorkerToMain,
} from "./protocol";
import {
  FIRST_BATCH,
  MAX_TURNS,
  runSimulation,
  type SimulationClock,
} from "./simulate";

// The grid of the chart (docs/validacion/browser.json) and a user p off the grid.
const GRID_P = [0.03, 0.05, 0.07, 0.09, 0.1, 0.11, 0.13, 0.15];
const DISTANCES = [3, 5, 7];

/** A clock that advances stepMs on every reading; yield is a microtask. */
function fakeClock(stepMs: number): SimulationClock & { readings: number } {
  const clock = {
    readings: 0,
    now() {
      clock.readings++;
      return clock.readings * stepMs;
    },
    yield: () => Promise.resolve(),
  };
  return clock;
}

function request(overrides: Partial<StartMessage> = {}): StartMessage {
  return {
    type: "start",
    runId: 7,
    model: "independent",
    distances: DISTANCES,
    probabilities: GRID_P,
    userP: 0.08,
    seedBase: 20261017,
    rule: BROWSER_STOP_RULE,
    budgetMs: 60_000,
    targetBatchMs: 5,
    ...overrides,
  };
}

interface Harness {
  readonly messages: WorkerToMain[];
  readonly progress: ProgressMessage[];
  readonly post: (m: WorkerToMain) => void;
  readonly inbox: () => MainToWorker[];
  /** Enqueue a message to be read at the start of the next turn. */
  readonly send: (m: MainToWorker) => void;
  /** Runs `script(progressIndex)` after every progress message. */
  onProgress?: (index: number) => void;
}

function harness(): Harness {
  const messages: WorkerToMain[] = [];
  const progress: ProgressMessage[] = [];
  const queue: MainToWorker[] = [];
  const h: Harness = {
    messages,
    progress,
    post: (m) => {
      messages.push(m);
      if (m.type === "progress") {
        progress.push(m);
        h.onProgress?.(progress.length - 1);
      }
    },
    inbox: () => queue.splice(0),
    send: (m) => {
      queue.push(m);
    },
  };
  return h;
}

const key = (pt: LivePoint) => `${pt.d}@${pt.p}`;

describe("runSimulation: round-robin turns", () => {
  it("the first progress has every lane with one batch (0 < shots ≤ FIRST_BATCH), user lanes first, then p outer and d inner", async () => {
    const h = harness();
    h.onProgress = (i) => {
      if (i === 0) h.send(stopMessage(7));
    };
    await runSimulation(request(), h.post, h.inbox, fakeClock(1));
    expect(h.progress).toHaveLength(1);
    const points = h.progress[0]!.points;
    expect(points).toHaveLength(27);
    for (const pt of points) {
      expect(pt.shots).toBeGreaterThan(0);
      expect(pt.shots).toBeLessThanOrEqual(FIRST_BATCH);
    }
    const expectedOrder = [
      ...DISTANCES.map((d) => `${d}@0.08`),
      ...GRID_P.flatMap((p) => DISTANCES.map((d) => `${d}@${p}`)),
    ];
    expect(points.map(key)).toEqual(expectedOrder);
    expect(h.messages.at(-1)?.type).toBe("done");
  });

  it("every progress carries all lanes and the grid's shots never decrease between turns", async () => {
    const h = harness();
    h.onProgress = (i) => {
      if (i === 4) h.send(stopMessage(7));
    };
    await runSimulation(request(), h.post, h.inbox, fakeClock(1));
    expect(h.progress).toHaveLength(5);
    for (let i = 1; i < h.progress.length; i++) {
      const prev = new Map(h.progress[i - 1]!.points.map((p) => [key(p), p]));
      for (const pt of h.progress[i]!.points) {
        expect(pt.shots).toBeGreaterThanOrEqual(prev.get(key(pt))!.shots);
      }
    }
  });

  it("rate > 0 for every lane after its first batch", async () => {
    const h = harness();
    h.onProgress = (i) => {
      if (i === 0) h.send(stopMessage(7));
    };
    await runSimulation(request(), h.post, h.inbox, fakeClock(1));
    for (const pt of h.progress[0]!.points) {
      expect(pt.rate).toBeGreaterThan(0);
    }
  });

  it("with userP on the grid the lane is shared: 24 lanes, the user's three first, no (d, p) twice", async () => {
    const h = harness();
    h.onProgress = (i) => {
      if (i === 0) h.send(stopMessage(7));
    };
    await runSimulation(request({ userP: 0.1 }), h.post, h.inbox, fakeClock(1));
    const keys = h.progress[0]!.points.map(key);
    expect(keys).toHaveLength(24);
    expect(new Set(keys).size).toBe(24);
    expect(keys.slice(0, 3)).toEqual(["3@0.1", "5@0.1", "7@0.1"]);
  });

  it("a userP within 10⁻⁶ of a grid p IS the grid lane: lanes are keyed at the seed's resolution", async () => {
    // pointSeed rounds p·10⁶: 0.030000000000000002 and 0.03 share a seed, so a
    // second lane would be the same shots twice under two keys.
    const h = harness();
    h.onProgress = (i) => {
      if (i === 0) h.send(setUserPMessage(7, 0.05 + 1e-17));
      if (i === 1) h.send(stopMessage(7));
    };
    await runSimulation(
      request({ probabilities: [0.03, 0.05], userP: 0.030000000000000002 }),
      h.post,
      h.inbox,
      fakeClock(1),
    );
    const first = h.progress[0]!.points;
    expect(first).toHaveLength(6);
    expect(first.slice(0, 3).map(key)).toEqual(["3@0.03", "5@0.03", "7@0.03"]);
    const second = h.progress[1]!.points;
    expect(second).toHaveLength(6);
    expect(second.slice(0, 3).map(key)).toEqual(["3@0.05", "5@0.05", "7@0.05"]);
    // The re-aimed user lanes are the grid's own: their shots carried over.
    for (const pt of second.slice(0, 3)) {
      expect(pt.shots).toBeGreaterThan(FIRST_BATCH);
    }
  });
});

describe("runSimulation: turn bound (every loop ends in an Error, never a hang)", () => {
  it("a clock that never advances with lanes that never stop errors out after maxTurns turns, no done", async () => {
    const h = harness();
    const stuck: SimulationClock = {
      now: () => 0,
      yield: () => Promise.resolve(),
    };
    await runSimulation(
      request({
        probabilities: [],
        distances: [3],
        rule: { minFailures: 1e9, minShots: 1e9, maxShots: 1e9 },
      }),
      h.post,
      h.inbox,
      stuck,
      { maxTurns: 3 },
    );
    expect(h.progress).toHaveLength(3);
    const last = h.messages.at(-1)!;
    if (last.type !== "error")
      throw new Error(`expected error, got ${last.type}`);
    expect(last.message).toMatch(/exceeded 3 turns/);
    expect(h.messages.filter((m) => m.type === "done")).toHaveLength(0);
  });

  it("the default bound is reached in minutes, not days: 10⁶ ≤ MAX_TURNS ≤ 10⁷", () => {
    // A turn is ≥ MIN_BATCH shots (≥ 100 µs at d = 3): 10⁷ turns ≈ 17 min of a
    // stuck clock before the error; ×1000 would be a silent hang.
    expect(MAX_TURNS).toBeGreaterThanOrEqual(1_000_000);
    expect(MAX_TURNS).toBeLessThanOrEqual(10_000_000);
  });
});

describe("runSimulation: messages", () => {
  it("setUserP replaces the three user lanes and keeps the grid's progress", async () => {
    const h = harness();
    h.onProgress = (i) => {
      if (i === 1) h.send(setUserPMessage(7, 0.12));
      if (i === 2) h.send(stopMessage(7));
    };
    await runSimulation(request(), h.post, h.inbox, fakeClock(1));
    expect(h.progress).toHaveLength(3);
    const before = h.progress[1]!.points;
    const after = h.progress[2]!.points;
    expect(after.slice(0, 3).map(key)).toEqual(["3@0.12", "5@0.12", "7@0.12"]);
    expect(after.map(key)).not.toContain("3@0.08");
    // Fresh lanes: one batch each. The grid: strictly more shots than before.
    for (const pt of after.slice(0, 3)) {
      expect(pt.shots).toBeLessThanOrEqual(FIRST_BATCH);
    }
    const prev = new Map(before.map((p) => [key(p), p]));
    for (const pt of after.slice(3)) {
      expect(pt.shots).toBeGreaterThan(prev.get(key(pt))!.shots);
    }
  });

  it("stop → done with no further progress; elapsedMs follows the clock", async () => {
    const h = harness();
    const clock = fakeClock(2);
    h.onProgress = (i) => {
      if (i === 2) h.send(stopMessage(7));
    };
    await runSimulation(request(), h.post, h.inbox, clock);
    const types = h.messages.map((m) => m.type);
    expect(types).toEqual(["progress", "progress", "progress", "done"]);
    const done = h.messages.at(-1)!;
    if (done.type !== "done") throw new Error("expected done");
    expect(done.runId).toBe(7);
    expect(done.elapsedMs % 2).toBe(0);
    expect(done.elapsedMs).toBeGreaterThan(0);
  });

  it("ignores messages with a foreign runId", async () => {
    const h = harness();
    h.onProgress = (i) => {
      if (i === 0) h.send(stopMessage(8));
      if (i === 0) h.send(setUserPMessage(8, 0.2));
      if (i === 1) h.send(stopMessage(7));
    };
    await runSimulation(request(), h.post, h.inbox, fakeClock(1));
    expect(h.progress).toHaveLength(2);
    expect(h.progress[1]!.points[0]!.p).toBe(0.08);
  });

  it("a bad request posts an error message instead of throwing", async () => {
    const h = harness();
    await runSimulation(
      request({ seedBase: 2 ** 52 }),
      h.post,
      h.inbox,
      fakeClock(1),
    );
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]!.type).toBe("error");
    const h2 = harness();
    await runSimulation(
      request({ distances: [] }),
      h2.post,
      h2.inbox,
      fakeClock(1),
    );
    expect(h2.messages[0]!.type).toBe("error");
  });
});

describe("runSimulation: noise model (tasks/plans/phase2.md D10)", () => {
  // A lane is the core's own point estimate under the model the start names:
  // the same seed, the same rule, the same tally when the lane stops.
  const lanePoints = async (model: NoiseKind): Promise<LivePoint[]> => {
    const h = harness();
    await runSimulation(
      request({ model, probabilities: [0.03], userP: 0.03, distances: [3, 5] }),
      h.post,
      h.inbox,
      fakeClock(1),
    );
    expect(h.messages.at(-1)!.type).toBe("done");
    return [...h.progress.at(-1)!.points];
  };

  it("with model independent every lane is estimatePoint under INDEPENDENT_MODEL (the phase 1 behaviour)", async () => {
    const points = await lanePoints("independent");
    expect(points.map(key)).toEqual(["3@0.03", "5@0.03"]);
    for (const pt of points) {
      const expected = estimatePoint(
        rotatedSurfaceCode(pt.d),
        pt.p,
        pointSeed(20261017, pt.d, pt.p),
        BROWSER_STOP_RULE,
        INDEPENDENT_MODEL,
      );
      expect(pt.shots).toBe(expected.shots);
      expect(pt.failures).toBe(expected.failures);
      expect(pt.failuresX).toBe(expected.failuresX);
      expect(pt.failuresZ).toBe(expected.failuresZ);
    }
  });

  it("with model phenomenological every lane is estimatePoint under PHENOMENOLOGICAL_MODEL, and the rate differs from the phase 1 one", async () => {
    const points = await lanePoints("phenomenological");
    expect(points.map(key)).toEqual(["3@0.03", "5@0.03"]);
    for (const pt of points) {
      const expected = estimatePoint(
        rotatedSurfaceCode(pt.d),
        pt.p,
        pointSeed(20261017, pt.d, pt.p),
        BROWSER_STOP_RULE,
        PHENOMENOLOGICAL_MODEL,
      );
      expect(pt.shots).toBe(expected.shots);
      expect(pt.failures).toBe(expected.failures);
      expect(pt.failuresX).toBe(expected.failuresX);
      expect(pt.failuresZ).toBe(expected.failuresZ);
    }
    // d = 3 at p = 0.03: ≈ 0.144 with measurement failures (browser-
    // phenomenological.json) against ≈ 0.029 with perfect measurements.
    const d3 = points.find((pt) => pt.d === 3)!;
    expect(d3.estimate).toBeGreaterThan(0.1);
    const independent = await lanePoints("independent");
    expect(independent.find((pt) => pt.d === 3)!.estimate).toBeLessThan(0.05);
  });

  it("a start without a known model posts an error, no progress", async () => {
    const h = harness();
    await runSimulation(
      request({ model: "depolarizing" as NoiseKind }),
      h.post,
      h.inbox,
      fakeClock(1),
    );
    expect(h.messages).toHaveLength(1);
    expect(h.messages[0]!.type).toBe("error");
  });
});

describe("runSimulation: stop rule and budget", () => {
  it("at the budget every lane still sampling ends with stopReason budget, then done", async () => {
    const h = harness();
    // 10 ms per reading, budget 300 ms: a handful of turns, nothing converges.
    await runSimulation(
      request({ budgetMs: 300, probabilities: [0.03], distances: [5, 7] }),
      h.post,
      h.inbox,
      fakeClock(10),
    );
    const last = h.progress.at(-1)!;
    expect(h.messages.at(-1)!.type).toBe("done");
    expect(last.points.every((pt) => pt.stopReason !== null)).toBe(true);
    expect(last.points.some((pt) => pt.stopReason === "budget")).toBe(true);
    const done = h.messages.at(-1)!;
    if (done.type !== "done") throw new Error("expected done");
    expect(done.elapsedMs).toBeGreaterThanOrEqual(300);
  });

  it("with minShots = 1 000 and p = 0.15, every lane stops by shots or failures before the budget", async () => {
    const h = harness();
    await runSimulation(
      request({ probabilities: [0.15], userP: 0.15, distances: [3, 5] }),
      h.post,
      h.inbox,
      fakeClock(1),
    );
    const last = h.progress.at(-1)!;
    for (const pt of last.points) {
      expect(["shots", "failures"]).toContain(pt.stopReason);
      expect(pt.failures).toBeGreaterThanOrEqual(100);
      expect(pt.shots).toBeGreaterThanOrEqual(1000);
    }
    expect(h.messages.at(-1)!.type).toBe("done");
  });
});
