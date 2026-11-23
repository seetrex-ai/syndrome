// State of the challenge mode (tasks/plans/phase2.md D11): one pure reducer,
// immutable flips (every toggle returns a fresh copy, as the grid reducer
// does under StrictMode), the decoded trace of the puzzle carried along for
// the overlay, and the record (best, streak, played, solved) updated on every
// verdict. The clock lives in the component: `timeout` is an action like any
// other and the verdict never depends on time (tests/intent/challenge-conventions).

import {
  copyPauli,
  identity,
  multiplyInto,
  rotatedSurfaceCode,
  type ReadonlyPauli,
} from "../../core";
import type { ShotTrace } from "../model/trace";
import type { Puzzle } from "./puzzle";
import {
  abandonedRecord,
  EMPTY_RECORD,
  judge,
  scoreOf,
  type ChallengeRecord,
  type JudgeResult,
} from "./score";

export interface IdleGame {
  readonly phase: "idle";
}

/**
 * A received puzzle (`#c=` link) waiting for the player's gesture: the board
 * and its defects are shown, the clock has not started and no flip is taken
 * (a link must not start counting while the page loads).
 */
export interface ReadyGame {
  readonly phase: "ready";
  readonly puzzle: Puzzle;
  readonly trace: ShotTrace;
}

export interface PlayingGame {
  readonly phase: "playing";
  readonly puzzle: Puzzle;
  /** The puzzle decoded once: its syndromes drive the grid, its correction is C_MWPM. */
  readonly trace: ShotTrace;
  /** The player's correction so far. */
  readonly flips: ReadonlyPauli;
  /** Clock origin (ms, the component's time source). */
  readonly startedAt: number;
  /** A received challenge (`#c=`): played outside the record. */
  readonly fromLink: boolean;
}

export interface SubmittedGame {
  readonly phase: "submitted";
  readonly puzzle: Puzzle;
  readonly trace: ShotTrace;
  readonly flips: ReadonlyPauli;
  /** error · flips: what the player's correction left behind. */
  readonly residual: ReadonlyPauli;
  readonly fromLink: boolean;
  readonly result: JudgeResult;
  /** Points awarded (0 on a forfeit or a rejection; informational when fromLink). */
  readonly points: number;
  readonly timedOut: boolean;
  readonly gaveUp: boolean;
}

export type Game = IdleGame | ReadyGame | PlayingGame | SubmittedGame;

export interface ChallengeState {
  readonly record: ChallengeRecord;
  readonly game: Game;
}

export type ChallengeAction =
  | {
      readonly type: "start";
      readonly puzzle: Puzzle;
      readonly trace: ShotTrace;
      readonly now: number;
      readonly fromLink: boolean;
    }
  /** A received puzzle: shown in `ready`, in any phase (a pasted link replaces the game). */
  | {
      readonly type: "load";
      readonly puzzle: Puzzle;
      readonly trace: ShotTrace;
    }
  /** The player's gesture on a received puzzle: the clock starts now. */
  | { readonly type: "begin"; readonly now: number }
  | { readonly type: "toggleX"; readonly q: number }
  | { readonly type: "toggleZ"; readonly q: number }
  | { readonly type: "submit" }
  | { readonly type: "timeout" }
  | { readonly type: "giveUp" }
  | { readonly type: "next" };

function idle(): Game {
  const game: Game = { phase: "idle" };
  return Object.freeze(game);
}

export function initialChallengeState(
  record: ChallengeRecord = EMPTY_RECORD,
): ChallengeState {
  return Object.freeze({ record, game: idle() });
}

function withGame(state: ChallengeState, game: Game): ChallengeState {
  return Object.freeze({ record: state.record, game: Object.freeze(game) });
}

/**
 * The state once its game is left for another: an own game in progress is
 * abandoned, which is a failure (D12: streak 0, played + 1). A
 * received game, a ready one or a settled one leave nothing behind.
 */
function leaving(state: ChallengeState): ChallengeState {
  const game = state.game;
  return game.phase === "playing" && !game.fromLink
    ? Object.freeze({ record: abandonedRecord(state.record), game })
    : state;
}

function playingGame(
  puzzle: Puzzle,
  trace: ShotTrace,
  now: number,
  fromLink: boolean,
): Game {
  return {
    phase: "playing",
    puzzle,
    trace,
    flips: Object.freeze(identity(puzzle.error.n)),
    startedAt: now,
    fromLink,
  };
}

function hasQubit(flips: ReadonlyPauli, q: number): boolean {
  return Number.isInteger(q) && q >= 0 && q < flips.n;
}

function toggled(
  state: ChallengeState,
  game: PlayingGame,
  q: number,
  zComponent: boolean,
): ChallengeState {
  if (!hasQubit(game.flips, q)) return state;
  const flips = copyPauli(game.flips);
  const mask = zComponent ? flips.z : flips.x;
  mask[q] = mask[q]! ^ 1;
  return withGame(state, { ...game, flips: Object.freeze(flips) });
}

function settled(
  state: ChallengeState,
  game: PlayingGame,
  timedOut: boolean,
  gaveUp: boolean,
): ChallengeState {
  const { puzzle, flips, fromLink } = game;
  const code = rotatedSurfaceCode(puzzle.d);
  const result = judge(code, puzzle.error, flips, game.trace.correction);
  const residual = Object.freeze(
    multiplyInto(identity(code.n), puzzle.error, flips),
  );
  const forfeited = timedOut || gaveUp;
  const scored = forfeited
    ? { points: 0, streak: 0 }
    : scoreOf(result, puzzle.d, fromLink ? 0 : state.record.streak);
  const record: ChallengeRecord = fromLink
    ? state.record
    : Object.freeze({
        best: Math.max(state.record.best, scored.points),
        streak: scored.streak,
        played: state.record.played + 1,
        solved: state.record.solved + (result.accepted && !forfeited ? 1 : 0),
      });
  const next: Game = {
    phase: "submitted",
    puzzle,
    trace: game.trace,
    flips,
    residual,
    fromLink,
    result,
    points: scored.points,
    timedOut,
    gaveUp,
  };
  return Object.freeze({ record, game: Object.freeze(next) });
}

/** Pure: never mutates `state`, its flips or its record. */
export function challengeReducer(
  state: ChallengeState,
  action: ChallengeAction,
): ChallengeState {
  const game = state.game;
  switch (action.type) {
    case "start":
      return withGame(
        leaving(state),
        playingGame(action.puzzle, action.trace, action.now, action.fromLink),
      );
    case "load": {
      const next: Game = {
        phase: "ready",
        puzzle: action.puzzle,
        trace: action.trace,
      };
      return withGame(leaving(state), next);
    }
    case "begin":
      return game.phase === "ready"
        ? withGame(
            state,
            playingGame(game.puzzle, game.trace, action.now, true),
          )
        : state;
    case "toggleX":
      return game.phase === "playing"
        ? toggled(state, game, action.q, false)
        : state;
    case "toggleZ":
      return game.phase === "playing"
        ? toggled(state, game, action.q, true)
        : state;
    case "submit":
      return game.phase === "playing"
        ? settled(state, game, false, false)
        : state;
    case "timeout":
      return game.phase === "playing"
        ? settled(state, game, true, false)
        : state;
    case "giveUp":
      return game.phase === "playing"
        ? settled(state, game, false, true)
        : state;
    case "next":
      return game.phase === "submitted" ? withGame(state, idle()) : state;
  }
}
