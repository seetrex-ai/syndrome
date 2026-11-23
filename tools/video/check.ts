// Scenes validated against the core, without a browser (tasks/plans/video.md
// D5, T-V3): the 2D shot a seed draws has the declared weight and verdict, a
// preset or link exists, the gap is on the slider's grid, every walkthrough
// ends on its last step, every key exists in both languages, and the whole
// video respects MAX_SECONDS. `npm run video -- --dry` prints the problems;
// tests/intent/video-conventions.test.ts requires none.

import {
  createRng,
  DISTANCES,
  identity,
  independentNoise,
  sampleNoise,
  weight,
} from "../../src/core/index";
import { DEFAULT_P, NOISE_KINDS } from "../../src/ui/model/noise-kinds";
import { PRESET_KINDS } from "../../src/ui/model/spacetime-trace";
import { createTraceContext, decodeTrace } from "../../src/ui/model/trace";
import { historyFromHash } from "../../src/ui/spacetime/link";
import { VIEWS } from "../../src/ui/spacetime/projection";
import { VIEWER_LAST_STEP } from "../../src/ui/spacetime/viewer-steps";
import { isGap } from "../../src/ui/spacetime/viewer-store";
import { LAST_STEP } from "../../src/ui/steps/step-machine";
import { hasKey, LANGS } from "./i18n";
import {
  MAX_SECONDS,
  totalSeconds,
  type Action,
  type Scene,
  type StepsScene,
} from "./scenes";

/** The distance the app loads with (src/ui/App.tsx DEFAULT_DISTANCE; not imported: App is React). */
export const APP_DEFAULT_DISTANCE = 3;

/** The error of a StepsScene as the app samples it (StepsPanel.drawShot → grid-reducer.randomError). */
export function shotOf(scene: StepsScene) {
  return sampleNoise(
    independentNoise(scene.p),
    createRng(scene.seed2d),
    identity(scene.d * scene.d),
  );
}

function checkActions(
  id: string,
  actions: readonly Action[],
  lastStep: number,
  gaps: boolean,
  problems: string[],
): void {
  let step = 0;
  let states = 0;
  for (const action of actions) {
    if (action.kind === "next") step++;
    else {
      states++;
      if (!(action.seconds > 0)) {
        problems.push(`${id}: a ${action.kind} lasts ${action.seconds} s`);
      }
    }
    if (action.kind === "gap") {
      if (!gaps) problems.push(`${id}: gap actions belong to the viewer`);
      else if (!isGap(action.value)) {
        problems.push(`${id}: gap ${action.value} is off the slider's grid`);
      }
    }
  }
  if (step !== lastStep) {
    problems.push(
      `${id}: ${step} "next" actions, the walkthrough has ${lastStep} steps after the first`,
    );
  }
  if (states === 0) problems.push(`${id}: no captured state`);
}

/** Every problem of the scenes; an empty list means they are valid. */
export function checkScenes(scenes: readonly Scene[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const scene of scenes) {
    if (ids.has(scene.id)) problems.push(`duplicate scene id ${scene.id}`);
    ids.add(scene.id);
    switch (scene.panel) {
      case "card": {
        if (scene.lines.length === 0 || scene.lines.length > 2) {
          problems.push(`${scene.id}: a card has one or two lines`);
        }
        for (const key of scene.lines) {
          for (const lang of LANGS) {
            if (!hasKey(lang, key)) {
              problems.push(`${scene.id}: key ${key} missing in ${lang}.json`);
            }
          }
        }
        if (!(scene.seconds > 0))
          problems.push(`${scene.id}: ${scene.seconds} s`);
        break;
      }
      case "steps": {
        if (scene.d !== APP_DEFAULT_DISTANCE) {
          problems.push(
            `${scene.id}: d = ${scene.d}, but the app loads with ${APP_DEFAULT_DISTANCE} and no action changes it`,
          );
        }
        if (scene.p !== DEFAULT_P) {
          problems.push(
            `${scene.id}: p = ${scene.p}, but the app loads with ${DEFAULT_P} and no action changes it`,
          );
        }
        if (
          !Number.isInteger(scene.seed2d) ||
          scene.seed2d < 0 ||
          scene.seed2d >= 2 ** 53
        ) {
          problems.push(`${scene.id}: seed2d must be an integer in [0, 2^53)`);
          break;
        }
        const error = shotOf(scene);
        const w = weight(error);
        if (w === 0)
          problems.push(
            `${scene.id}: seed ${scene.seed2d} draws an empty error`,
          );
        if (w !== scene.expect.weight) {
          problems.push(
            `${scene.id}: weight ${w}, the scene expects ${scene.expect.weight}`,
          );
        }
        const verdict = decodeTrace(createTraceContext(scene.d), error).verdict;
        if (verdict !== scene.expect.verdict) {
          problems.push(
            `${scene.id}: verdict ${verdict}, the scene expects ${scene.expect.verdict}`,
          );
        }
        checkActions(scene.id, scene.actions, LAST_STEP, false, problems);
        break;
      }
      case "spacetime": {
        if (!(DISTANCES as readonly number[]).includes(scene.d)) {
          problems.push(`${scene.id}: d = ${scene.d}`);
        }
        if ("preset" in scene.shot) {
          if (!PRESET_KINDS.includes(scene.shot.preset)) {
            problems.push(`${scene.id}: unknown preset ${scene.shot.preset}`);
          }
        } else {
          const linked = historyFromHash(scene.shot.link);
          if (linked === null)
            problems.push(`${scene.id}: the link does not parse`);
          else if (linked.d !== scene.d) {
            problems.push(
              `${scene.id}: link of d = ${linked.d}, scene of d = ${scene.d}`,
            );
          }
        }
        if (!VIEWS.includes(scene.view))
          problems.push(`${scene.id}: view ${scene.view}`);
        if (!isGap(scene.gap)) {
          problems.push(
            `${scene.id}: gap ${scene.gap} is off the slider's grid`,
          );
        }
        checkActions(scene.id, scene.actions, VIEWER_LAST_STEP, true, problems);
        break;
      }
      case "chart": {
        if (!NOISE_KINDS.includes(scene.model)) {
          problems.push(`${scene.id}: unknown model ${scene.model}`);
        }
        if (!(scene.seconds > 0))
          problems.push(`${scene.id}: ${scene.seconds} s`);
        break;
      }
    }
  }
  const total = totalSeconds(scenes);
  if (total > MAX_SECONDS) {
    problems.push(`the video lasts ${total} s, more than ${MAX_SECONDS}`);
  }
  return problems;
}
