// Drawing a random shot for the viewer (tasks/plans/phase2-g.md D7), apart
// from the panel so the component file only exports components (fast refresh).

import type { Distance, SpacetimeHistory } from "../../core";
import { DEFAULT_P_BY_MODEL } from "../model/noise-kinds";
import { hasEvent, randomHistory } from "../model/spacetime-trace";

/** The viewer's p starts at the model's default (0.01), not at the app's p (D7). */
export const VIEWER_DEFAULT_P = DEFAULT_P_BY_MODEL.phenomenological;

/** From this distance on the panel notes that the stack is dense (D7, decision 5). */
export const LARGE_DISTANCE = 9;

/** Seeds drawn at most before an empty history is shown anyway (p > 0). */
export const MAX_DRAWS = 32;

// createRng accepts seeds in [0, 2^53); Math.random() < 1 keeps the floor below it.
const randomSeed = () => Math.floor(Math.random() * 2 ** 53);

/**
 * A random history with at least one event when p > 0 (at d = 3, p = 0.01
 * almost half the shots have no defect, M2): seeds are drawn until something
 * happens, at most MAX_DRAWS times. With p = 0 the empty shot is the honest
 * answer.
 */
export function drawHistory(d: Distance, p: number): SpacetimeHistory {
  let history = randomHistory(d, p, randomSeed());
  if (p > 0) {
    for (let draws = 1; draws < MAX_DRAWS && !hasEvent(history); draws++) {
      history = randomHistory(d, p, randomSeed());
    }
  }
  return history;
}
