// The chosen noise model survives a reload (tasks/plans/phase2.md D10):
// `localStorage["syndrome.model"]`, read once at mount and written on every
// change, inside try/catch like the challenge record (a private window or a
// blocked store throws on access; then the default model it is).
import { isNoiseKind, type NoiseKind } from "./noise-kinds";

export const MODEL_KEY = "syndrome.model"; // i18n-exempt: localStorage key

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored model, or null when none, unknown, or unreadable. */
export function readStoredModel(): NoiseKind | null {
  try {
    const value = storage()?.getItem(MODEL_KEY);
    return isNoiseKind(value) ? value : null;
  } catch {
    return null;
  }
}

/** Stores the model; a store that throws is ignored. */
export function storeModel(model: NoiseKind): void {
  try {
    storage()?.setItem(MODEL_KEY, model);
  } catch {
    // The choice lives in the session only.
  }
}
