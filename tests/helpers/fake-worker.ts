// A scripted stand-in for the simulation Worker (tasks/plans/ui.md D6, D7):
// records what the main thread posts, lets a test emit protocol messages, and
// counts instances alive so StrictMode's double mount is measurable (ui.md R2).
import { act } from "@testing-library/react";
import type {
  MainToWorker,
  StartMessage,
  WorkerToMain,
} from "../../src/worker/protocol";
import type { WorkerLike } from "../../src/ui/chart/useSimulation";

export class FakeWorker implements WorkerLike {
  readonly posted: MainToWorker[] = [];
  terminated = false;
  onmessage: ((event: { readonly data: WorkerToMain }) => void) | null = null;
  onerror: ((event: { readonly message?: string }) => void) | null = null;

  postMessage(message: MainToWorker): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** The start messages received so far (the last one is the current run). */
  get starts(): StartMessage[] {
    return this.posted.filter((m): m is StartMessage => m.type === "start");
  }

  /** Delivers a message as the Worker would, inside act(). */
  emit(message: WorkerToMain): void {
    act(() => {
      this.onmessage?.({ data: message });
    });
  }

  /** The Worker's script failed to load or threw at top level (an `error` event). */
  fail(message = "Failed to load worker script"): void {
    act(() => {
      this.onerror?.({ message });
    });
  }
}

export interface FakeWorkerFactory {
  readonly create: () => FakeWorker;
  readonly instances: FakeWorker[];
  readonly alive: () => FakeWorker[];
}

export function fakeWorkerFactory(): FakeWorkerFactory {
  const instances: FakeWorker[] = [];
  return {
    instances,
    create: () => {
      const worker = new FakeWorker();
      instances.push(worker);
      return worker;
    },
    alive: () => instances.filter((w) => !w.terminated),
  };
}
