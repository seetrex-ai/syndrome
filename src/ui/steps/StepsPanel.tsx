// Step-by-step mode (tasks/plans/ui.md D5, docs/spec.md §4 phase 1 point 5):
// errors → defects → matching → correction → verdict over one random shot,
// with play, pause, back and repeat. The panel owns its own grid state (a
// read-only Grid fed by `randomize`); the trace is decoded once per shot and
// the steps only choose which layers of it are drawn.

import { useCallback, useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import {
  createRng,
  identity,
  independentNoise,
  LOGICAL_X,
  LOGICAL_Z,
  sampleNoise,
  weight,
  type Distance,
} from "../../core";
import { Clamp } from "../controls/Clamp";
import {
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRestart,
} from "../controls/icons";
import { Explain, ExplainGroup } from "../explain/Explain";
import { Grid } from "../grid/Grid";
import { useGridState, type Shot } from "../model/grid-reducer";
import {
  initialStepState,
  LAST_STEP,
  layersOf,
  STEP_INTERVAL_MS,
  STEPS,
  stepReducer,
} from "./step-machine";
import "./steps.css";

export interface StepsPanelProps {
  readonly d: Distance;
  /** Physical error probability of the random shot (the slider of the grid panel). */
  readonly p: number;
}

// createRng accepts seeds in [0, 2^53); Math.random() < 1 keeps the floor below it.
const randomSeed = () => Math.floor(Math.random() * 2 ** 53);

/** Seeds drawn at most before an empty error is shown anyway (p > 0). */
const MAX_DRAWS = 32;

/**
 * A shot whose error is not empty when p > 0: seeds are drawn until the
 * sampled error has weight > 0 (7 empty boards were measured in
 * 60 loads at p = 0.1, d = 3, where a draw is empty 15 % of the time; 32 draws
 * leave ≈ 10⁻²⁶). Only the Pauli is sampled here; the reducer samples the
 * chosen seed again and the trace is decoded once per shown shot. With p = 0,
 * or after MAX_DRAWS seeds, the empty board is the honest answer.
 */
function drawShot(d: number, p: number): Shot {
  let seed = randomSeed();
  if (p > 0) {
    const noise = independentNoise(p);
    const error = identity(d * d);
    for (let draws = 1; draws < MAX_DRAWS; draws++) {
      if (weight(sampleNoise(noise, createRng(seed), error)) > 0) break;
      seed = randomSeed();
    }
  }
  return { p, seed };
}

export function StepsPanel({ d, p }: StepsPanelProps) {
  const { t } = useTranslation();
  // The panel never shows an empty board when p > 0: it mounts on a random
  // shot at the slider's p, redrawn while empty (drawShot), and a new distance
  // draws a new one. Called by the hook
  // during render, so it reads the current p.
  const { trace, dispatch: gridDispatch } = useGridState(d, () =>
    drawShot(d, p),
  );
  const [steps, dispatch] = useReducer(stepReducer, trace, initialStepState);

  // A new shot (or a new distance) restarts the walkthrough. Adjusting state
  // during render is React's documented pattern for deriving from a change in
  // a value: no frame ever shows the old steps over the new trace.
  if (steps.trace !== trace) dispatch({ type: "load", trace });

  const newShot = useCallback(
    () => gridDispatch({ type: "randomize", ...drawShot(d, p) }),
    [gridDispatch, d, p],
  );

  // Playing = a ticking interval that advances one step; the reducer pauses
  // itself on the last step, which clears the interval through `playing`.
  useEffect(() => {
    if (!steps.playing) return undefined;
    const id = setInterval(() => dispatch({ type: "next" }), STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [steps.playing]);

  const { index, playing } = steps;
  const step = STEPS[index]!;
  const verdict = trace.verdict;
  const verdictText =
    verdict === 0
      ? t("grid.verdict.ok")
      : verdict === LOGICAL_X
        ? t("grid.verdict.x")
        : verdict === LOGICAL_Z
          ? t("grid.verdict.z")
          : t("grid.verdict.xz");

  return (
    <section id="panel-steps" className="panel panel--steps" data-step={index}>
      <h2>{t("steps.title")}</h2>
      <Clamp className="steps__intro">{t("steps.intro")}</Clamp>
      <ol className="stepper steps__list">
        {STEPS.map((name, i) => (
          <li
            key={name}
            className="stepper__step steps__item"
            data-done={i <= index ? 1 : 0}
            aria-current={i === index ? "step" : undefined}
          >
            {t(`steps.${name}`)}
          </li>
        ))}
      </ol>
      <Grid
        trace={trace}
        layers={layersOf(index)}
        label={t("steps.gridLabel")}
      />
      {/* One live region for the step text and its verdict: not a second
          role="status" beside the interactive grid's verdict. */}
      <div className="steps__live" aria-live="polite">
        <p className="steps__explain">
          <strong className="steps__name">{t(`steps.${step}`)}</strong>{" "}
          {t(`steps.explain.${step}`)}
        </p>
        {step === "verdict" && (
          <p className="verdict steps__verdict" data-verdict={verdict}>
            {verdictText}
          </p>
        )}
      </div>
      <div className="steps__controls">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => dispatch({ type: "prev" })}
          disabled={index === 0}
        >
          <IconPrev />
          {t("steps.prev")}
        </button>
        {playing ? (
          <button
            type="button"
            className="btn btn--primary btn--play"
            onClick={() => dispatch({ type: "pause" })}
          >
            <IconPause />
            {t("steps.pause")}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--play"
            onClick={() => dispatch({ type: "play" })}
          >
            <IconPlay />
            {t("steps.play")}
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => dispatch({ type: "next" })}
          disabled={index === LAST_STEP}
        >
          {t("steps.next")}
          <IconNext />
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => dispatch({ type: "restart" })}
          disabled={index === 0}
        >
          <IconRestart />
          {t("steps.restart")}
        </button>
        <button type="button" className="btn steps__new" onClick={newShot}>
          {t("steps.newShot")}
        </button>
      </div>
      {/* Below the controls: an open explanation never moves the grid. */}
      <p className="steps__model">{t("steps.measurementsPerfect")}</p>
      <ExplainGroup>
        <Explain id="measurementsPerfect" />
        <Explain id="matching" />
        <Explain id="verdictRule" />
      </ExplainGroup>
    </section>
  );
}
