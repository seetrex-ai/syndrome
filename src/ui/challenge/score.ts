// Judge, score and record of the challenge mode (tasks/plans/phase2.md D11,
// D12; docs/spec.md §4.6). Pure: the clock never reaches the judge (the timer is
// UI only; tests/intent/challenge-conventions pins it), and the acceptance is
// by equivalence class, never by identity with the decoder's correction.

import {
  identity,
  isStabilizerEquivalent,
  multiplyInto,
  type Distance,
  type ReadonlyPauli,
  type RotatedSurfaceCode,
} from "../../core";

// ---------------------------------------------------------------------------
// Initial values (D12), to be tuned by playing; everything the
// game balances is in this block and nowhere else.
// ---------------------------------------------------------------------------

/** Seconds on the clock per distance. */
export const TIME_LIMIT_S: Readonly<Record<Distance, number>> = Object.freeze({
  3: 20,
  5: 40,
  7: 60,
  9: 90,
});

/** Seconds left at which the clock is announced to a screen reader. */
export const ANNOUNCE_AT: readonly number[] = Object.freeze([10, 5]);

/** Physical error probability the puzzles are drawn at, per distance. */
export const LEVEL_P: Readonly<Record<Distance, number>> = Object.freeze({
  3: 0.08,
  5: 0.06,
  7: 0.05,
  9: 0.05,
});

/** Points per unit of distance for an accepted correction. */
export const SOLVED_POINTS = 10;
/** Extra points per unit of distance when the flips match the decoder's weight. */
export const BONUS_POINTS = 5;
/** Streak multiplier: 1 + STREAK_STEP · streak, capped at STREAK_CAP. */
export const STREAK_STEP = 0.1;
export const STREAK_CAP = 2;

// ---------------------------------------------------------------------------

export interface JudgeResult {
  /** The residual error · flips is a stabilizer (docs/spec.md §4.6). */
  readonly accepted: boolean;
  /** Accepted and with the decoder's weight on each type (what the player sees: flips per type). */
  readonly bonus: boolean;
  readonly flipsX: number;
  readonly flipsZ: number;
  readonly mwpmX: number;
  readonly mwpmZ: number;
}

function countType(mask: ArrayLike<number>): number {
  let w = 0;
  for (let q = 0; q < mask.length; q++) w += mask[q]! & 1;
  return w;
}

/**
 * Verdict on the player's flips `flips` against the puzzle's `error`, with the
 * decoder's correction `mwpm` for the bonus only. Accepted ⇔ error · flips is
 * in the stabilizer group (null syndrome and commutes with X_L and Z_L): any
 * correction of the right class passes, not only the decoder's. `scratch`
 * (length d² − 1) is the syndrome buffer, as in isStabilizerEquivalent.
 */
export function judge(
  code: RotatedSurfaceCode,
  error: ReadonlyPauli,
  flips: ReadonlyPauli,
  mwpm: ReadonlyPauli,
  scratch?: Uint8Array,
): JudgeResult {
  const residual = multiplyInto(identity(code.n), error, flips);
  const accepted = isStabilizerEquivalent(code, residual, scratch);
  const flipsX = countType(flips.x);
  const flipsZ = countType(flips.z);
  const mwpmX = countType(mwpm.x);
  const mwpmZ = countType(mwpm.z);
  return Object.freeze({
    accepted,
    bonus: accepted && flipsX === mwpmX && flipsZ === mwpmZ,
    flipsX,
    flipsZ,
    mwpmX,
    mwpmZ,
  });
}

/**
 * Points of a result at distance d with `streak` consecutive solves before it,
 * and the streak after it. A failure (or a forfeit, scored by the caller as a
 * failure) is 0 points and streak 0.
 */
export function scoreOf(
  result: Pick<JudgeResult, "accepted" | "bonus">,
  d: number,
  streak: number,
): { readonly points: number; readonly streak: number } {
  if (!result.accepted) return { points: 0, streak: 0 };
  const base = SOLVED_POINTS * d + (result.bonus ? BONUS_POINTS * d : 0);
  const multiplier = Math.min(1 + STREAK_STEP * streak, STREAK_CAP);
  return { points: Math.round(base * multiplier), streak: streak + 1 };
}

// ---------------------------------------------------------------------------
// Record in localStorage (D12): best score, current streak, puzzles played and
// solved. Read and written under try/catch: private mode, quota or a blocked
// storage must never break the game.
// ---------------------------------------------------------------------------

export interface ChallengeRecord {
  readonly best: number;
  readonly streak: number;
  readonly played: number;
  readonly solved: number;
}

export const EMPTY_RECORD: ChallengeRecord = Object.freeze({
  best: 0,
  streak: 0,
  played: 0,
  solved: 0,
});

// i18n-exempt: localStorage key
export const RECORD_KEY = "syndrome.challenge";
// i18n-exempt: localStorage key of the own game in progress (abandoning is failing)
export const OPEN_KEY = "syndrome.challenge.open";

type RecordStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The record after an own game is abandoned (the page reloaded or a link
 * pasted mid-puzzle): a failure, as a wrong answer or a forfeit is. Streak 0
 * and one more played; best and solved untouched (without
 * this, reloading on a hard puzzle kept the streak and inflated `best`).
 */
export function abandonedRecord(record: ChallengeRecord): ChallengeRecord {
  return Object.freeze({
    best: record.best,
    streak: 0,
    played: record.played + 1,
    solved: record.solved,
  });
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** The stored record, or EMPTY_RECORD when there is none or it cannot be read. */
export function readRecord(
  storage: RecordStorage | undefined,
): ChallengeRecord {
  try {
    const text = storage?.getItem(RECORD_KEY);
    if (text === null || text === undefined) return EMPTY_RECORD;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return EMPTY_RECORD;
    const { best, streak, played, solved } = parsed as Record<string, unknown>;
    if (
      !isCount(best) ||
      !isCount(streak) ||
      !isCount(played) ||
      !isCount(solved)
    )
      return EMPTY_RECORD;
    return Object.freeze({ best, streak, played, solved });
  } catch {
    return EMPTY_RECORD;
  }
}

export function writeRecord(
  storage: RecordStorage | undefined,
  record: ChallengeRecord,
): void {
  try {
    storage?.setItem(RECORD_KEY, JSON.stringify(record));
  } catch {
    // Quota, private mode: the game goes on without persistence.
  }
}

/** An own game in progress, as marked under OPEN_KEY while it is played. */
export interface OpenGame {
  readonly startedAt: number;
  readonly d: number;
}

/** Whether a mark of an own game in progress is stored (an unread one is none). */
export function hasOpenGame(storage: RecordStorage | undefined): boolean {
  try {
    const text = storage?.getItem(OPEN_KEY);
    return text !== null && text !== undefined;
  } catch {
    return false;
  }
}

/**
 * Marks the own game in progress (`open`), or clears the mark (`null`) once
 * it is settled or replaced. The panel writes it on every change of game; a
 * mount that still finds it settles that game as abandoned.
 */
export function markOpenGame(
  storage: RecordStorage | undefined,
  open: OpenGame | null,
): void {
  try {
    if (open === null) storage?.removeItem(OPEN_KEY);
    else storage?.setItem(OPEN_KEY, JSON.stringify(open));
  } catch {
    // Quota, private mode: an unmarked game is simply never abandoned.
  }
}
