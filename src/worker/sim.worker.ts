// Worker glue (tasks/plans/ui.md D3, R3): queue incoming messages, hand a
// start to runSimulation with postMessage as its channel. `self` is typed by a
// local assertion because tsconfig.app.json carries the DOM lib, not WebWorker.
import type { MainToWorker, WorkerToMain } from "./protocol";
import { runSimulation } from "./simulate";

interface WorkerScope {
  postMessage(message: WorkerToMain): void;
  onmessage: ((event: { data: MainToWorker }) => void) | null;
}

const scope = self as unknown as WorkerScope;
const post = (message: WorkerToMain): void => scope.postMessage(message);

// One queue per run: a start while a run is going stops that run (its own
// runId) and gives the new one a fresh queue.
let queue: MainToWorker[] = [];
let runId: number | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type !== "start") {
    queue.push(message);
    return;
  }
  if (runId !== null) queue.push({ type: "stop", runId });
  const own: MainToWorker[] = [];
  queue = own;
  runId = message.runId;
  void runSimulation(message, post, () => own.splice(0));
};
