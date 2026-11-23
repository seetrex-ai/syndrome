// The result a finished challenge reports to analytics (tasks/plans/analytics.md
// D13). A forfeit counts as wrong even when the flips made so far were a valid
// correction: "wrong" covers a rejection, a timeout and giving up.
import type { ChallengeResult } from "../../analytics/events";
import type { SubmittedGame } from "./challenge-machine";

/** optimal = accepted with the decoder's weight; valid = accepted; wrong otherwise. */
export function challengeResult(game: SubmittedGame): ChallengeResult {
  if (game.timedOut || game.gaveUp || !game.result.accepted) return "wrong";
  return game.result.bonus ? "optimal" : "valid";
}
