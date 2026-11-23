// The main-thread side of the Worker protocol (tasks/plans/ui.md D3, D6, R2):
// one Worker per mount, terminated on unmount; messages with a foreign runId
// are dropped; createWorker is injectable so tests drive the hook with a fake.
//
// Runs. The MAIN run (grid + the user's p) starts on mount and, on a laptop,
// finishes in well under a second. A change of p while a run is going re-aims
// its user lanes with setUserP; a change after the run is done starts a USER
// run (user lanes only, probabilities: []) so Λ at the new p is always
// simulated. The live points are the main run's grid lanes plus the current
// user lanes, restricted to the grid's p and the current p (a lane of an
// earlier p is gone, as the Worker's own replacement would have made it).
//
// Invariant (tests/intent/chart-conventions: test_intent_current_p_always_sampled):
// the current p always has a lane or a run that will give it one. A setUserP
// posted while the Worker is finishing its last turn is never read (the run's
// done is already on its way), so the hook does not trust the message it sent:
// when the run that owns the user lanes reports done, it checks the LAST
// progress it saw and starts a user run if the current p is not in it. The same
// check decides, after a change of p, whether a run is needed at all.
//
// A p the main run already sampled is never sampled again: a
// user run re-aimed at it would start a lane from zero and hide the main run's
// lane (50 000 shots behind 100). The main run's lanes are the visible ones;
// the user run is stopped instead, and `live` keeps, of two points with the
// same (d, p), the one with more shots.
//
// Model (tasks/plans/phase2.md D10). Every run samples one noise model, named
// in its start; a change of `model` starts a new run (it is a dependency of
// the start effect, like `distances` and `probabilities`, which come from the
// model's base) on the SAME Worker: sim.worker.ts stops the run that is going
// when a start arrives, so cancellation never needs terminate(). The Worker is
// created once per mount: re-creating it per run
// asked the network for the Worker's hashed URL on every model change, and a
// tab whose build had been superseded by a new service worker got the SPA
// fallback (text/html) instead, the Worker failed and the chart silently
// stopped refining. If the Worker still fails (onerror: its script gone or
// broken), the hook reports `lost` and the base curves stay.
//
// Generation. The runs state belongs to ONE main run,
// its `generation`: the runId allocated on the render that changes any input
// of the start effect (model, grid, Worker factory, budgets), before the
// effect runs. The hook reports nothing of another generation, and a Worker
// message builds on nothing of another generation. Keyed by MODEL instead, a
// quick A → B → A (back before B's Worker reported) made the new A run inherit
// the old A run's "finished", its elapsed time and its 5 000 live shots: the
// panel read "finished" for the whole new run. Keyed by generation, the render
// that switches the base shows an idle state (the old model's live points are
// not pooled into the new base: a p both grids share, like 0.03, would mix
// two decoders for one render) and so does the render that returns.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_BUDGET_MS,
  DEFAULT_TARGET_BATCH_MS,
  BROWSER_STOP_RULE,
  MAX_SEED_BASE,
  normalizeP,
  setUserPMessage,
  startMessage,
  stopMessage,
  type LivePoint,
  type MainToWorker,
  type NoiseKind,
  type WorkerToMain,
} from "../../worker/protocol";
import { BASELINE } from "./baseline";

/** What the hook needs from a Worker; the real one satisfies it structurally. */
export interface WorkerLike {
  postMessage(message: MainToWorker): void;
  terminate(): void;
  onmessage: ((event: { readonly data: WorkerToMain }) => void) | null;
  /** Fired when the Worker's script cannot be loaded or throws at top level. */
  onerror: ((event: { readonly message?: string }) => void) | null;
}

/** null when the environment has no Worker (tests under jsdom, old browsers). */
export type CreateWorker = () => WorkerLike | null;

export interface SimulationState {
  readonly live: readonly LivePoint[];
  /**
   * null until the CURRENT generation's main run is done, then its elapsed
   * time; any change of a start input (model, grid, budgets) resets it to
   * null with the new generation.
   */
  readonly elapsedMs: number | null;
  /** true while a user-only run (after the main run) is going. */
  readonly userRunning: boolean;
  readonly error: string | null;
  /** true when createWorker returned null. */
  readonly unavailable: boolean;
  /**
   * true once the Worker itself failed (onerror): its script is gone or broken,
   * typically a tab whose build a newer service worker has superseded. No run
   * will report again until the page reloads; the base curves stay.
   */
  readonly lost: boolean;
}

export interface SimulationOptions {
  readonly createWorker?: CreateWorker;
  /** The noise model every run samples; a change starts a new run. */
  readonly model?: NoiseKind;
  /** Stable arrays: a new array identity starts a new run. */
  readonly distances?: readonly number[];
  readonly probabilities?: readonly number[];
  readonly budgetMs?: number;
  readonly targetBatchMs?: number;
}

interface Runs {
  /** The main run (its runId) the state below belongs to; 0 before any run. */
  readonly generation: number;
  readonly main: readonly LivePoint[];
  readonly user: readonly LivePoint[];
  readonly elapsedMs: number | null;
  readonly userRunning: boolean;
  readonly error: string | null;
  readonly unavailable: boolean;
}

const IDLE: Runs = Object.freeze({
  generation: 0,
  main: [],
  user: [],
  elapsedMs: null,
  userRunning: false,
  error: null,
  unavailable: false,
});

/** The real Worker; Vite splits the module into its own asset (D6). */
export function createSimulationWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  const worker = new Worker(
    new URL("../../worker/sim.worker.ts", import.meta.url), // i18n-exempt: Worker module URL
    { type: "module" }, // i18n-exempt: Worker option, not text
  );
  // MessageEvent has `data`; the narrower WorkerLike is what this file reads.
  return worker as unknown as WorkerLike;
}

/** Fresh base seed per run: pointSeed's domain is [0, 2⁵²) (ui.md R11). */
export function freshSeedBase(): number {
  return Math.floor(Math.random() * MAX_SEED_BASE);
}

let nextRunId = 1;

/** A main run's identity: its runId and the start inputs it was allocated for. */
interface Generation {
  readonly id: number;
  readonly inputs: readonly unknown[];
}

function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

export function useSimulation(
  rawUserP: number,
  options: SimulationOptions = {},
): SimulationState {
  const {
    createWorker = createSimulationWorker,
    model = BASELINE.noise,
    distances = BASELINE.distances,
    probabilities = BASELINE.probabilities,
    budgetMs = DEFAULT_BUDGET_MS,
    targetBatchMs = DEFAULT_TARGET_BATCH_MS,
  } = options;
  // Lanes are keyed at the seed's resolution on both sides (protocol.ts).
  const userP = normalizeP(rawUserP);
  const [runs, setRuns] = useState<Runs>(IDLE);
  // The main run's identity, allocated on the render that changes an input of
  // the start effect (React's "adjusting state when a prop changes"): every
  // execution of the effect below is one generation, known before it runs.
  const inputs = [
    createWorker,
    model,
    distances,
    probabilities,
    budgetMs,
    targetBatchMs,
  ];
  const [generation, setGeneration] = useState<Generation>(() => ({
    id: nextRunId++,
    inputs,
  }));
  if (!sameInputs(generation.inputs, inputs)) {
    setGeneration({ id: nextRunId++, inputs });
  }
  const mainRunId = generation.id;
  /** The state to build on: what this generation's runs reported, or nothing. */
  const own = useCallback(
    (prev: Runs): Runs =>
      prev.generation === mainRunId ? prev : { ...IDLE, generation: mainRunId },
    [mainRunId],
  );
  const workerRef = useRef<WorkerLike | null>(null);
  const mainRunRef = useRef(0);
  /** The run that owns the user lanes: the main run until it is done. */
  const userRunRef = useRef(0);
  const mainDoneRef = useRef(false);
  const userDoneRef = useRef(true);
  /** runId of the user run we told to stop (its elapsedMs is not news). */
  const stoppedRunRef = useRef(-1);
  const userPRef = useRef(userP);
  /** The last progress of each run, as the Worker reported it: what HAS a lane. */
  const mainPointsRef = useRef<readonly LivePoint[]>([]);
  const userPointsRef = useRef<readonly LivePoint[]>([]);

  /** true when the main run's last progress has a lane for p. */
  const mainHasLane = useCallback(
    (p: number): boolean => mainPointsRef.current.some((pt) => pt.p === p),
    [],
  );

  /**
   * true when p has a live lane in the last progress of a run that is not
   * superseded. A user lane counts only once it STOPPED (by its rule or by the
   * budget): a lane stopped by the budget had its share of it (user lanes sample
   * first), the interval drawn is the one it earned, and a fresh run for the
   * same p would start from zero shots and spend another whole budget on a point
   * not pooled with the first (decided and tested, not resampled).
   * A lane cut by our own stop (stopReason still null, a handful of shots) is
   * NOT a lane: returning to its p must sample it again, or the status would
   * read "finished" over a point frozen at 100 shots.
   */
  const hasLane = useCallback(
    (p: number): boolean =>
      mainHasLane(p) ||
      (userRunRef.current !== mainRunRef.current &&
        userPointsRef.current.some(
          (pt) => pt.p === p && pt.stopReason !== null,
        )),
    [mainHasLane],
  );

  const startUserRun = useCallback(
    (worker: WorkerLike, p: number): void => {
      const runId = nextRunId++;
      userRunRef.current = runId;
      userDoneRef.current = false;
      userPointsRef.current = [];
      // The run is going from its start, not from its first progress: the
      // status reads "simulating" in between.
      // A new run also clears the error of the run it replaces.
      setRuns((prev) => ({
        ...own(prev),
        user: [],
        userRunning: true,
        error: null,
      }));
      worker.postMessage(
        startMessage({
          runId,
          model,
          distances,
          probabilities: [],
          userP: p,
          seedBase: freshSeedBase(),
          rule: BROWSER_STOP_RULE,
          budgetMs,
          targetBatchMs,
        }),
      );
    },
    [own, model, distances, budgetMs, targetBatchMs],
  );

  // Declared first: on mount it records userP before the start effect reads it.
  useEffect(() => {
    userPRef.current = userP;
    const worker = workerRef.current;
    if (worker === null) return;
    const userRunGoing =
      userRunRef.current === mainRunRef.current
        ? !mainDoneRef.current
        : !userDoneRef.current;
    if (userRunGoing) {
      if (userRunRef.current !== mainRunRef.current && mainHasLane(userP)) {
        // The main run already sampled this p: its lane is the visible one.
        // The user run now samples a p nobody looks at: stop it. Its done
        // finds the current p covered and starts nothing.
        stoppedRunRef.current = userRunRef.current;
        worker.postMessage(stopMessage(userRunRef.current));
        return;
      }
      // Re-aim the going run. If the Worker never reads this (its done is in
      // flight), the done handler below starts a user run for this p.
      worker.postMessage(setUserPMessage(userRunRef.current, userP));
      return;
    }
    // No run going: a p that already has a lane (the grid, or the lanes of the
    // last run) needs nothing; any other p gets a user-only run.
    if (hasLane(userP)) return;
    startUserRun(worker, userP);
  }, [userP, hasLane, mainHasLane, startUserRun]);

  // The Worker: one per mount, reused by every run (see the header). Declared
  // before the start effect so the first start finds it in workerRef. Its
  // failure (onerror) outlives any run: `lost` is set on whatever generation is
  // current, and a start posted afterwards is never answered.
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    if (worker === null) return;
    worker.onerror = () => setLost(true);
    return () => {
      worker.onerror = null;
      worker.onmessage = null;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [createWorker]);

  useEffect(() => {
    const worker = workerRef.current;
    if (worker === null) {
      // Reported from a task, like a Worker message would be (no setState in
      // the effect body: react-hooks/set-state-in-effect).
      const timer = setTimeout(
        () => setRuns({ ...IDLE, generation: mainRunId, unavailable: true }),
        0,
      );
      return () => clearTimeout(timer);
    }
    const runId = mainRunId;
    mainRunRef.current = runId;
    userRunRef.current = runId;
    mainDoneRef.current = false;
    userDoneRef.current = true;
    mainPointsRef.current = [];
    userPointsRef.current = [];
    worker.onmessage = ({ data }) => {
      const isMain = data.runId === mainRunRef.current;
      const isUser = data.runId === userRunRef.current && !isMain;
      if (!isMain && !isUser) return;
      if (data.type === "progress") {
        if (isMain) mainPointsRef.current = data.points;
        else userPointsRef.current = data.points;
        setRuns((prev) =>
          isMain
            ? { ...own(prev), main: data.points }
            : { ...own(prev), user: data.points, userRunning: true },
        );
      } else if (data.type === "done") {
        if (isMain) mainDoneRef.current = true;
        else userDoneRef.current = true;
        // The elapsed time of a run we stopped ourselves says nothing useful
        // ("finished in 0 s"): keep the previous figure.
        const stopped = data.runId === stoppedRunRef.current;
        setRuns((prev) => {
          const base = own(prev);
          return {
            ...base,
            elapsedMs: stopped ? base.elapsedMs : data.elapsedMs,
            userRunning: isMain ? base.userRunning : false,
          };
        });
        // The run that owned the user lanes is over. A setUserP it never read
        // left the current p without a lane: give it its own run now.
        if (data.runId === userRunRef.current && !hasLane(userPRef.current)) {
          startUserRun(worker, userPRef.current);
        }
      } else {
        // An error ends the run like a done does: the next p
        // starts a run instead of re-aiming a run that is no longer there.
        if (isMain) mainDoneRef.current = true;
        else userDoneRef.current = true;
        setRuns((prev) => {
          const base = own(prev);
          return {
            ...base,
            error: data.message,
            userRunning: isMain ? base.userRunning : false,
          };
        });
      }
    };
    worker.postMessage(
      startMessage({
        runId,
        model,
        distances,
        probabilities,
        userP: userPRef.current,
        seedBase: freshSeedBase(),
        rule: BROWSER_STOP_RULE,
        budgetMs,
        targetBatchMs,
      }),
    );
    return () => {
      // The next start (or the Worker's termination on unmount) ends the run
      // that is going: sim.worker.ts queues a stop for it when a start arrives.
      worker.onmessage = null;
    };
  }, [
    createWorker,
    own,
    mainRunId,
    model,
    distances,
    probabilities,
    budgetMs,
    targetBatchMs,
    hasLane,
    startUserRun,
  ]);

  // What this generation's runs reported; another generation's state is not news.
  const current = runs.generation === mainRunId ? runs : IDLE;

  const live = useMemo(() => {
    // One point per (d, p); of two, the one with more shots (a user lane
    // never outranks a main lane with 50 000 shots behind it).
    const byKey = new Map<string, LivePoint>();
    const keep = (pt: LivePoint): void => {
      const key = `${pt.d}:${pt.p}`;
      const prev = byKey.get(key);
      if (prev === undefined || pt.shots > prev.shots) byKey.set(key, pt);
    };
    for (const pt of current.user) {
      if (pt.p === userP) keep(pt);
    }
    for (const pt of current.main) {
      if (probabilities.includes(pt.p) || pt.p === userP) keep(pt);
    }
    return [...byKey.values()];
  }, [current.main, current.user, userP, probabilities]);

  return {
    live,
    elapsedMs: current.elapsedMs,
    userRunning: current.userRunning,
    error: current.error,
    unavailable: current.unavailable,
    lost,
  };
}
