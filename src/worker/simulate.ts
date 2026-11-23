// The simulation loop of the Worker, written without the Worker (tasks/plans/
// ui.md D3): runSimulation takes the outgoing channel (post), the incoming
// queue (inbox) and the clock as arguments, so Node tests drive it with a spy, a
// scripted queue and a fake clock, and sim.worker.ts is only glue.
//
// Every lane samples the model the start names (phase2.md D10): the main
// thread restarts the run on a change of model, so a run has one model.
//
// One lane per (d, p): the user's p first (Λ appears early), then the grid with
// p outer and d inner, so the three curves grow together. A turn gives every
// lane still sampling one batch sized to targetBatchMs from the rate measured
// on its previous batch, posts ONE progress message with every lane, and yields
// to the event loop so setUserP / stop reach the inbox. Cancellation is
// cooperative (stop message) and the budget is a hard bound; the main thread
// keeps terminate() for the mount/unmount lifecycle only.

import {
  createPointSampler,
  estimate,
  INDEPENDENT_MODEL,
  PHENOMENOLOGICAL_MODEL,
  pointSeed,
  rotatedSurfaceCode,
  step,
  stop,
  type ModelSpec,
  type PointSampler,
  type RotatedSurfaceCode,
} from "../core/index";
import {
  normalizeP,
  type LivePoint,
  type MainToWorker,
  type NoiseKind,
  type StartMessage,
  type WorkerToMain,
} from "./protocol";

/** The core's ModelSpec for each model name of the protocol (phase2.md D10). */
const MODEL_SPECS: Readonly<Record<NoiseKind, ModelSpec>> = Object.freeze({
  independent: INDEPENDENT_MODEL,
  phenomenological: PHENOMENOLOGICAL_MODEL,
});

export interface SimulationClock {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Returns control to the event loop so queued messages reach the inbox. */
  yield(): Promise<void>;
}

export const REAL_CLOCK: SimulationClock = {
  now: () => performance.now(),
  yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

/** Shots of a lane's first batch, before any rate is known. */
export const FIRST_BATCH = 100;
/** Bounds of a batch whatever the measured rate (ui.md D3). */
export const MIN_BATCH = 50;
export const MAX_BATCH = 5_000;

// Every loop has a bound with an Error. A turn runs at
// least MIN_BATCH shots of one lane (≥ 100 µs at d = 3), so a 60 s budget is
// < 10⁶ turns; a clock that never advances would otherwise spin forever.
export const MAX_TURNS = 4_000_000;

export interface SimulationLimits {
  /** Turns before the run errors out; tests inject a small value, the Worker takes the default. */
  readonly maxTurns?: number;
}

interface Lane {
  readonly d: number;
  readonly p: number;
  readonly sampler: PointSampler;
  rate: number;
  nextBatch: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function checkRequest(req: StartMessage): ModelSpec {
  // probabilities may be empty: a user-only run (the main thread starts one
  // for a new p after the main run is done) has just the user lanes.
  if (req.distances.length === 0) {
    throw new RangeError("start needs at least one distance");
  }
  const model = Object.hasOwn(MODEL_SPECS, req.model)
    ? MODEL_SPECS[req.model]
    : undefined;
  if (model === undefined) {
    throw new RangeError(`unknown noise model ${String(req.model)}`);
  }
  if (!(req.budgetMs > 0) || !(req.targetBatchMs > 0)) {
    throw new RangeError(
      `budgetMs and targetBatchMs must be positive, got ${req.budgetMs}, ${req.targetBatchMs}`,
    );
  }
  return model;
}

/**
 * Runs one simulation until every lane stops, the budget expires or a stop
 * message arrives. Posts progress (one per turn), then done; any thrown error
 * is posted as an error message and the promise still resolves.
 */
export async function runSimulation(
  req: StartMessage,
  post: (message: WorkerToMain) => void,
  inbox: () => readonly MainToWorker[],
  clock: SimulationClock = REAL_CLOCK,
  limits: SimulationLimits = {},
): Promise<void> {
  const { runId } = req;
  const maxTurns = limits.maxTurns ?? MAX_TURNS;
  try {
    const model = checkRequest(req);
    const codes = new Map<number, RotatedSurfaceCode>();
    const codeOf = (d: number): RotatedSurfaceCode => {
      let code = codes.get(d);
      if (code === undefined) {
        code = rotatedSurfaceCode(d);
        codes.set(d, code);
      }
      return code;
    };
    const createLane = (d: number, p: number): Lane => ({
      d,
      p,
      sampler: createPointSampler(
        codeOf(d),
        p,
        pointSeed(req.seedBase, d, p),
        req.rule,
        model,
      ),
      rate: 0,
      nextBatch: FIRST_BATCH,
    });

    // Grid lanes: p outer, d inner. Every p is keyed at the seed's resolution
    // (normalizeP): a p within 10⁻⁶ of a grid value IS that grid lane.
    const grid: Lane[] = [];
    for (const p of req.probabilities) {
      for (const d of req.distances) {
        grid.push(createLane(d, normalizeP(p)));
      }
    }
    // User lanes: the grid lane itself when userP is on the grid (one sampler per
    // (d, p); two lanes with the same seed would be the same shots twice), a fresh
    // lane otherwise.
    const userLanes = (rawUserP: number): Lane[] => {
      const userP = normalizeP(rawUserP);
      return req.distances.map(
        (d) =>
          grid.find((lane) => lane.d === d && lane.p === userP) ??
          createLane(d, userP),
      );
    };
    let user = userLanes(req.userP);
    const ordered = (): Lane[] => [
      ...user,
      ...grid.filter((lane) => !user.includes(lane)),
    ];

    const runBatch = (lane: Lane): void => {
      const tally = lane.sampler.tally;
      const before = tally.shots;
      const t0 = clock.now();
      step(lane.sampler, lane.nextBatch);
      const dt = clock.now() - t0;
      const n = tally.shots - before;
      if (dt > 0 && n > 0) {
        lane.rate = n / (dt / 1000);
        lane.nextBatch = clamp(
          Math.round((lane.rate * req.targetBatchMs) / 1000),
          MIN_BATCH,
          MAX_BATCH,
        );
      }
    };

    const progress = (lanes: readonly Lane[]): void => {
      const points: LivePoint[] = lanes.map((lane) => ({
        ...estimate(lane.sampler),
        rate: lane.rate,
      }));
      post({ type: "progress", runId, points });
    };
    const done = (): void => {
      post({ type: "done", runId, elapsedMs: clock.now() - start });
    };

    const start = clock.now();
    for (let turn = 0; ; turn++) {
      if (turn >= maxTurns) {
        throw new Error(`simulation exceeded ${maxTurns} turns`);
      }
      for (const message of inbox()) {
        if (message.runId !== runId) continue;
        if (message.type === "stop") {
          done();
          return;
        }
        if (message.type === "setUserP") {
          user = userLanes(message.p);
        }
      }
      const lanes = ordered();
      const active = lanes.filter(
        (lane) => lane.sampler.tally.stopReason === null,
      );
      if (active.length === 0) {
        done();
        return;
      }
      if (clock.now() - start >= req.budgetMs) {
        for (const lane of active) stop(lane.sampler, "budget");
        progress(lanes);
        done();
        return;
      }
      for (const lane of active) runBatch(lane);
      progress(lanes);
      await clock.yield();
    }
  } catch (error) {
    post({
      type: "error",
      runId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
