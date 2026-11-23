import { describe, expect, it } from "vitest";
import {
  identity,
  multiplyInto,
  pauliEquals,
  rotatedSurfaceCode,
  weight,
  type Distance,
} from "../../core";
import {
  createTraceContext,
  decodeTrace,
  type ShotTrace,
} from "../model/trace";
import {
  challengeReducer,
  initialChallengeState,
  type ChallengeAction,
  type ChallengeState,
  type PlayingGame,
  type SubmittedGame,
} from "./challenge-machine";
import { decodePuzzle, type Puzzle } from "./puzzle";
import { EMPTY_RECORD, scoreOf, SOLVED_POINTS, BONUS_POINTS } from "./score";

// "i3.gAA": one X error on qubit (0, 0) of d = 3; the decoder corrects it with
// one flip to the boundary (verdict 0), so C_MWPM is accepted with the bonus.
const puzzle: Puzzle = decodePuzzle("i3.gAA")!;
const trace: ShotTrace = decodeTrace(createTraceContext(3), puzzle.error);
const code = rotatedSurfaceCode(3);

function start(
  state: ChallengeState,
  now = 1000,
  fromLink = false,
): ChallengeState {
  return challengeReducer(state, {
    type: "start",
    puzzle,
    trace,
    now,
    fromLink,
  });
}

function playing(state: ChallengeState): PlayingGame {
  if (state.game.phase !== "playing") throw new Error("not playing");
  return state.game;
}

function submitted(state: ChallengeState): SubmittedGame {
  if (state.game.phase !== "submitted") throw new Error("not submitted");
  return state.game;
}

/** Applies the decoder's correction as toggles. */
function applyMwpm(state: ChallengeState): ChallengeState {
  let s = state;
  for (let q = 0; q < code.n; q++) {
    if (trace.correction.x[q] === 1)
      s = challengeReducer(s, { type: "toggleX", q });
    if (trace.correction.z[q] === 1)
      s = challengeReducer(s, { type: "toggleZ", q });
  }
  return s;
}

describe("challengeReducer", () => {
  it("starts idle with the given record", () => {
    const record = { best: 30, streak: 2, played: 4, solved: 3 };
    const state = initialChallengeState(record);
    expect(state.game.phase).toBe("idle");
    expect(state.record).toEqual(record);
    expect(initialChallengeState().record).toEqual(EMPTY_RECORD);
  });

  it("start opens a playing game with no flips, the clock at `now`, the puzzle and its trace", () => {
    expect(trace.verdict).toBe(0);
    const state = start(initialChallengeState(), 1234);
    const game = playing(state);
    expect(game.puzzle).toBe(puzzle);
    expect(game.trace).toBe(trace);
    expect(game.startedAt).toBe(1234);
    expect(game.fromLink).toBe(false);
    expect(weight(game.flips)).toBe(0);
    expect(game.flips.n).toBe(9);
    expect(Object.isFrozen(game)).toBe(true);
  });

  it("toggles flip one component of one qubit without mutating the previous state", () => {
    const s0 = start(initialChallengeState());
    const s1 = challengeReducer(s0, { type: "toggleX", q: 4 });
    const s2 = challengeReducer(s1, { type: "toggleZ", q: 4 });
    const s3 = challengeReducer(s2, { type: "toggleX", q: 4 });
    expect([...playing(s1).flips.x]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect([...playing(s2).flips.z]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect([...playing(s3).flips.x]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...playing(s3).flips.z]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(weight(playing(s0).flips)).toBe(0);
    expect(playing(s1).flips).not.toBe(playing(s0).flips);
  });

  it("ignores a toggle outside playing and on a qubit the code does not have", () => {
    const idle = initialChallengeState();
    expect(challengeReducer(idle, { type: "toggleX", q: 0 })).toBe(idle);
    const s = start(idle);
    expect(challengeReducer(s, { type: "toggleX", q: 9 })).toBe(s);
    expect(challengeReducer(s, { type: "toggleZ", q: -1 })).toBe(s);
    expect(challengeReducer(s, { type: "toggleZ", q: 1.5 })).toBe(s);
    const done = challengeReducer(s, { type: "submit" });
    expect(challengeReducer(done, { type: "toggleX", q: 0 })).toBe(done);
    expect(challengeReducer(done, { type: "toggleZ", q: 0 })).toBe(done);
  });

  it("submit freezes the flips and judges them: C_MWPM is accepted with the bonus and scores", () => {
    const s = applyMwpm(start(initialChallengeState()));
    const flips = playing(s).flips;
    const done = challengeReducer(s, { type: "submit" });
    const game = submitted(done);
    expect(game.flips).toBe(flips);
    expect(pauliEquals(game.flips, trace.correction)).toBe(true);
    expect(game.result.accepted).toBe(true);
    expect(game.result.bonus).toBe(true);
    expect(game.timedOut).toBe(false);
    expect(game.gaveUp).toBe(false);
    expect(game.points).toBe((SOLVED_POINTS + BONUS_POINTS) * 3);
    expect(done.record).toEqual({
      best: game.points,
      streak: 1,
      played: 1,
      solved: 1,
    });
    // A second solve in a row: streak 2, multiplied.
    const again = challengeReducer(applyMwpm(start(done, 5000)), {
      type: "submit",
    });
    expect(submitted(again).points).toBe(
      scoreOf({ accepted: true, bonus: true }, 3, 1).points,
    );
    expect(again.record).toEqual({
      best: submitted(again).points,
      streak: 2,
      played: 2,
      solved: 2,
    });
  });

  it("a wrong answer: rejected, 0 points, streak 0, played counts, solved does not, best stays", () => {
    const solved = challengeReducer(applyMwpm(start(initialChallengeState())), {
      type: "submit",
    });
    const wrong = challengeReducer(start(solved), { type: "submit" });
    const game = submitted(wrong);
    expect(game.result.accepted).toBe(false);
    expect(game.points).toBe(0);
    expect(wrong.record).toEqual({
      best: solved.record.best,
      streak: 0,
      played: 2,
      solved: 1,
    });
  });

  it("timeout and giveUp forfeit: the flips are still judged (same verdict), points 0, streak 0", () => {
    const s = applyMwpm(start(initialChallengeState()));
    const byClock = submitted(challengeReducer(s, { type: "timeout" }));
    const byHand = submitted(challengeReducer(s, { type: "giveUp" }));
    const bySubmit = submitted(challengeReducer(s, { type: "submit" }));
    expect(byClock.result).toEqual(bySubmit.result);
    expect(byHand.result).toEqual(bySubmit.result);
    expect(byClock.timedOut).toBe(true);
    expect(byClock.gaveUp).toBe(false);
    expect(byHand.timedOut).toBe(false);
    expect(byHand.gaveUp).toBe(true);
    expect(byClock.points).toBe(0);
    expect(byHand.points).toBe(0);
    const after = challengeReducer(s, { type: "timeout" });
    expect(after.record).toEqual({ best: 0, streak: 0, played: 1, solved: 0 });
  });

  it("timeout and giveUp cut a running streak to 0", () => {
    const before = { best: 90, streak: 3, played: 5, solved: 5 };
    const s = applyMwpm(start(initialChallengeState(before)));
    expect(
      submitted(challengeReducer(s, { type: "submit" })).result.accepted,
    ).toBe(true);
    for (const type of ["timeout", "giveUp"] as const) {
      const after = challengeReducer(s, { type });
      expect(after.record, type).toEqual({
        best: 90,
        streak: 0,
        played: 6,
        solved: 5,
      });
      expect(submitted(after).points).toBe(0);
    }
  });

  it("load opens a received puzzle in `ready`: board shown, no clock, no flips accepted until begin", () => {
    const before = { best: 30, streak: 2, played: 4, solved: 3 };
    const s = challengeReducer(initialChallengeState(before), {
      type: "load",
      puzzle,
      trace,
    });
    expect(s.game.phase).toBe("ready");
    if (s.game.phase !== "ready") throw new Error("not ready");
    expect(s.game.puzzle).toBe(puzzle);
    expect(s.game.trace).toBe(trace);
    expect(s.record).toBe(before);
    for (const action of [
      { type: "toggleX", q: 0 },
      { type: "toggleZ", q: 0 },
      { type: "submit" },
      { type: "timeout" },
      { type: "giveUp" },
      { type: "next" },
    ] as const satisfies readonly ChallengeAction[]) {
      expect(challengeReducer(s, action), action.type).toBe(s);
    }
    const begun = challengeReducer(s, { type: "begin", now: 777 });
    const game = playing(begun);
    expect(game.puzzle).toBe(puzzle);
    expect(game.trace).toBe(trace);
    expect(game.startedAt).toBe(777);
    expect(game.fromLink).toBe(true);
    expect(weight(game.flips)).toBe(0);
    expect(begun.record).toBe(before);
    // begin outside ready is ignored.
    expect(challengeReducer(begun, { type: "begin", now: 1 })).toBe(begun);
    expect(
      challengeReducer(initialChallengeState(), { type: "begin", now: 1 }).game
        .phase,
    ).toBe("idle");
  });

  it("load replaces a game in any phase (a link pasted mid-puzzle), and start from ready draws the app's own puzzle", () => {
    const mid = challengeReducer(start(initialChallengeState()), {
      type: "toggleX",
      q: 4,
    });
    const loaded = challengeReducer(mid, { type: "load", puzzle, trace });
    expect(loaded.game.phase).toBe("ready");
    const done = challengeReducer(start(initialChallengeState()), {
      type: "submit",
    });
    expect(
      challengeReducer(done, { type: "load", puzzle, trace }).game.phase,
    ).toBe("ready");
    const own = start(loaded, 5);
    expect(playing(own).fromLink).toBe(false);
    expect(playing(own).startedAt).toBe(5);
  });

  it("abandoning an own game in progress is a failure: load or start over it cuts the streak to 0 and counts it played; a linked, ready or settled game is not abandoned", () => {
    const before = { best: 50, streak: 5, played: 7, solved: 6 };
    const after = { best: 50, streak: 0, played: 8, solved: 6 };
    const own = challengeReducer(start(initialChallengeState(before)), {
      type: "toggleX",
      q: 4,
    });
    const pasted = challengeReducer(own, { type: "load", puzzle, trace });
    expect(pasted.game.phase).toBe("ready");
    expect(pasted.record).toEqual(after);
    expect(start(own, 5).record).toEqual(after);
    // Only one failure per abandoned game: the ready game it left is not own.
    expect(
      challengeReducer(pasted, { type: "load", puzzle, trace }).record,
    ).toEqual(after);
    // Not own, not playing, or already settled: nothing to abandon.
    const linked = start(initialChallengeState(before), 1, true);
    expect(
      challengeReducer(linked, { type: "load", puzzle, trace }).record,
    ).toEqual(before);
    const done = challengeReducer(start(initialChallengeState(before)), {
      type: "submit",
    });
    expect(
      challengeReducer(done, { type: "load", puzzle, trace }).record,
    ).toEqual(done.record);
    expect(start(done).record).toEqual(done.record);
  });

  it("a puzzle from a link is played outside the record: no streak, no best, not counted", () => {
    const before = { best: 30, streak: 2, played: 4, solved: 3 };
    const s = applyMwpm(start(initialChallengeState(before), 1, true));
    expect(playing(s).fromLink).toBe(true);
    const done = challengeReducer(s, { type: "submit" });
    expect(submitted(done).fromLink).toBe(true);
    expect(submitted(done).result.accepted).toBe(true);
    // Informational points, as a first solve (streak 0), not multiplied by the
    // player's own streak and not written to the record.
    expect(submitted(done).points).toBe(
      scoreOf({ accepted: true, bonus: true }, 3, 0).points,
    );
    expect(done.record).toEqual(before);
    expect(done.record).toBe(s.record);
  });

  it("submit, timeout, giveUp and next are ignored outside playing; next returns to idle keeping the record", () => {
    const idle = initialChallengeState();
    for (const type of ["submit", "timeout", "giveUp", "next"] as const) {
      const action: ChallengeAction = { type };
      expect(challengeReducer(idle, action)).toBe(idle);
    }
    const done = challengeReducer(start(idle), { type: "submit" });
    expect(challengeReducer(done, { type: "submit" })).toBe(done);
    const back = challengeReducer(done, { type: "next" });
    expect(back.game.phase).toBe("idle");
    expect(back.record).toBe(done.record);
    // start from submitted opens a new game directly.
    expect(start(done).game.phase).toBe("playing");
  });

  it("the residual it exposes is error · flips, for the grid (not the decoder's)", () => {
    const s = challengeReducer(start(initialChallengeState()), {
      type: "toggleX",
      q: 4,
    });
    const game = submitted(challengeReducer(s, { type: "submit" }));
    const expected = multiplyInto(identity(9), puzzle.error, game.flips);
    expect(pauliEquals(game.residual, expected)).toBe(true);
    expect(game.result.accepted).toBe(false);
  });

  it("works at every distance the puzzle can have", () => {
    for (const d of [5, 7, 9] as Distance[]) {
      // X on qubit 0: one defect at every distance (an empty board is no puzzle).
      const p = decodePuzzle(
        `i${d}.g${"A".repeat(Math.ceil((2 * d * d) / 6) - 1)}`,
      )!;
      const t = decodeTrace(createTraceContext(d), p.error);
      const s = challengeReducer(initialChallengeState(), {
        type: "start",
        puzzle: p,
        trace: t,
        now: 0,
        fromLink: false,
      });
      expect(playing(s).flips.n).toBe(d * d);
      const flipped = challengeReducer(s, { type: "toggleX", q: 0 });
      expect(
        submitted(challengeReducer(flipped, { type: "submit" })).result
          .accepted,
      ).toBe(true);
    }
  });
});
