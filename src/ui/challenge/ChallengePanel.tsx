// Challenge mode (docs/spec.md §4 phase 2 point 6; tasks/plans/phase2.md D11,
// D12): the player is the decoder. The panel owns a challengeReducer, the
// clock (UI only: it dispatches `timeout` like any other action), the record
// in localStorage and the share controls. The grid is the ordinary Grid fed a
// ShotTrace built by hand: the player's flips as the "errors" layer over the
// puzzle's fixed defects while playing; after the verdict, the decoder's
// answer (matching and chains) and the player's residual on top.
//
// A received puzzle (`#c=` link, at load or on hashchange) is shown in `ready`
// with its defects and a Start button; the clock begins with that gesture.
// Submit and Give up keep their place, disabled, after
// the verdict, and Start/Next sit in a row of their own below: the second
// click of a double click never lands on the opposite action.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  trackChallengeCompleted,
  trackChallengeShared,
} from "../../analytics/events";
import { identity, type Distance, type ReadonlyPauli } from "../../core";
import { Clamp } from "../controls/Clamp";
import { Explain, ExplainGroup } from "../explain/Explain";
import { FormLinks } from "../footer/FormLinks";
import { Grid } from "../grid/Grid";
import {
  ALL_LAYERS,
  createTraceContext,
  decodeTrace,
  type Layer,
  type ShotTrace,
} from "../model/trace";
import {
  challengeReducer,
  initialChallengeState,
  type ChallengeAction,
  type ChallengeState,
  type Game,
} from "./challenge-machine";
import { challengeResult } from "./outcome";
import { drawPuzzle, HASH_PREFIX, puzzleFromHash, type Puzzle } from "./puzzle";
import {
  abandonedRecord,
  ANNOUNCE_AT,
  hasOpenGame,
  LEVEL_P,
  markOpenGame,
  readRecord,
  TIME_LIMIT_S,
  writeRecord,
} from "./score";
import {
  gridToPngBlob,
  pageBackground,
  puzzleUrl,
  shareOrDownload,
} from "./share";
import { APP_PATH } from "../../locale-path";
import "./challenge.css";

export interface ChallengePanelProps {
  /** Distance of the next puzzle (the app's shared d). A linked puzzle keeps its own. */
  readonly d: Distance;
  /** `location.hash`: a `#c=` link opens that puzzle (ready for Start); a new value loads a new one. */
  readonly link?: string;
}

// createRng accepts seeds in [0, 2^53); Math.random() < 1 keeps the floor below it.
const randomSeed = () => Math.floor(Math.random() * 2 ** 53);

/** How often the clock is read; the text changes once per second. */
export const TICK_MS = 250;
/** Seconds left from which the clock is highlighted. */
const URGENT_S = 5;

const PLAYING_LAYERS: ReadonlySet<Layer> = new Set<Layer>([
  "errors",
  "defects",
]);
const NO_CHAINS: ShotTrace["chains"] = Object.freeze({
  Z: Object.freeze([]),
  X: Object.freeze([]),
});

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function startAction(puzzle: Puzzle): ChallengeAction {
  return {
    type: "start",
    puzzle,
    trace: decodeTrace(createTraceContext(puzzle.d), puzzle.error),
    now: Date.now(),
    fromLink: false,
  };
}

function loadAction(puzzle: Puzzle): ChallengeAction {
  return {
    type: "load",
    puzzle,
    trace: decodeTrace(createTraceContext(puzzle.d), puzzle.error),
  };
}

// An own game still marked as in progress at mount was abandoned (the page
// reloaded mid-puzzle): a failure, settled here (D12: abandoning is
// failing). The mark itself is cleared by the effect that keeps it, once the
// new game (idle or ready) is rendered; the read here is pure.
function initialState(link: string | undefined): ChallengeState {
  const store = storage();
  const record = readRecord(store);
  const state = initialChallengeState(
    hasOpenGame(store) ? abandonedRecord(record) : record,
  );
  const puzzle = link === undefined ? null : puzzleFromHash(link);
  return puzzle === null ? state : challengeReducer(state, loadAction(puzzle));
}

/** A `#c=` hash that describes no puzzle (bad text, or an error with no defect). */
function isBadLink(link: string | undefined): boolean {
  return (
    link !== undefined &&
    link.startsWith(HASH_PREFIX) &&
    puzzleFromHash(link) === null
  );
}

function countType(mask: ArrayLike<number>): number {
  let w = 0;
  for (let q = 0; q < mask.length; q++) w += mask[q]! & 1;
  return w;
}

/**
 * What the grid draws for a game. The trace's `verdict` is the challenge's
 * `result`, not these bits: the grid never reads them, and the panel prints
 * the result itself.
 */
function gridTrace(game: Game): ShotTrace | null {
  switch (game.phase) {
    case "idle":
      return null;
    case "ready":
    case "playing": {
      const n = game.puzzle.error.n;
      const none: ReadonlyPauli = Object.freeze(identity(n));
      return Object.freeze({
        d: game.puzzle.d,
        error: game.phase === "playing" ? game.flips : none,
        syndromes: game.trace.syndromes,
        chains: NO_CHAINS,
        correction: none,
        residual: none,
        verdict: 0,
      });
    }
    case "submitted":
      return Object.freeze({
        ...game.trace,
        error: game.flips,
        residual: game.residual,
        verdict: 0,
      });
  }
}

export function ChallengePanel({ d, link }: ChallengePanelProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(challengeReducer, link, initialState);
  const [badLink, setBadLink] = useState(() => isBadLink(link));
  const game = state.game;

  // A link that changes after mount (hashchange): its puzzle replaces the
  // game, behind the same Start gesture; a bad one is only noted.
  const appliedLink = useRef(link);
  useEffect(() => {
    if (link === appliedLink.current) return;
    appliedLink.current = link;
    setBadLink(isBadLink(link));
    const puzzle = link === undefined ? null : puzzleFromHash(link);
    if (puzzle !== null) dispatch(loadAction(puzzle));
  }, [link]);

  // The record outlives the page (D12), silently when storage is unavailable.
  useEffect(() => {
    writeRecord(storage(), state.record);
  }, [state.record]);

  // challenge_completed (tasks/plans/analytics.md D13): once per finished
  // game. A game object is immutable and replaced on every change, so an
  // effect keyed on it runs once per verdict; re-renders of the same game do
  // not re-run it. StrictMode's extra setup/cleanup cycle (src/main.tsx) only
  // happens at mount, and a panel never mounts with a submitted game
  // (initialState): no "already reported" guard is needed. Covered by
  // test_scenario_challenge_completed_once_under_strict_mode.
  useEffect(() => {
    if (game.phase !== "submitted") return;
    trackChallengeCompleted(game.puzzle.d, challengeResult(game));
  }, [game]);

  // The own game in progress is marked while it is played and the mark is
  // cleared with any other game (idle, ready, submitted, a received one): a
  // mount that still finds it settles it as abandoned (initialState).
  const open =
    game.phase === "playing" && !game.fromLink
      ? { startedAt: game.startedAt, d: game.puzzle.d }
      : null;
  const openStartedAt = open?.startedAt ?? null;
  const openD = open?.d ?? null;
  useEffect(() => {
    markOpenGame(
      storage(),
      openStartedAt === null || openD === null
        ? null
        : { startedAt: openStartedAt, d: openD },
    );
  }, [openStartedAt, openD]);

  // Focus follows the game: the clock when a puzzle starts
  // (New puzzle, Start, Next), the verdict when it ends (Submit, Give up, time
  // up). Both are focusable by script only (tabIndex -1).
  // Never stolen from another control: `timeout` is not a
  // gesture, so if the player is typing in the p slider or the language
  // selector when the clock runs out, their focus stays where it is. Focus
  // moves only when it is nowhere (body) or already inside this panel, and
  // without scrolling the page.
  const sectionRef = useRef<HTMLElement>(null);
  const timerRef = useRef<HTMLParagraphElement>(null);
  const verdictRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    const free =
      active === null ||
      active === document.body ||
      (sectionRef.current?.contains(active) ?? false);
    if (!free) return;
    if (game.phase === "playing") {
      timerRef.current?.focus({ preventScroll: true });
    } else if (game.phase === "submitted") {
      verdictRef.current?.focus({ preventScroll: true });
    }
  }, [game.phase]);

  // The clock: a UI concern. It reads Date.now() every TICK_MS and dispatches
  // `timeout` when the limit is past; the verdict itself never sees the time.
  const startedAt = game.phase === "playing" ? game.startedAt : null;
  const limitMs =
    game.phase === "playing" ? TIME_LIMIT_S[game.puzzle.d] * 1000 : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return undefined;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current - startedAt >= limitMs) dispatch({ type: "timeout" });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [startedAt, limitMs]);
  // Seconds left, clamped: `now` may predate a game that just started.
  const remaining =
    startedAt === null
      ? null
      : Math.ceil(
          Math.max(0, Math.min(limitMs, limitMs - (now - startedAt))) / 1000,
        );
  const announced =
    remaining !== null && ANNOUNCE_AT.includes(remaining)
      ? t("challenge.secondsLeft", { count: remaining })
      : "";

  const [copied, setCopied] = useState<boolean | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const startNew = useCallback(() => {
    setCopied(null);
    setImageFailed(false);
    setBadLink(false);
    dispatch(startAction(drawPuzzle(d, LEVEL_P[d], randomSeed)));
  }, [d]);
  const begin = useCallback(() => {
    setCopied(null);
    setImageFailed(false);
    dispatch({ type: "begin", now: Date.now() });
  }, []);
  const toggleX = useCallback(
    (q: number) => dispatch({ type: "toggleX", q }),
    [],
  );
  const toggleZ = useCallback(
    (q: number) => dispatch({ type: "toggleZ", q }),
    [],
  );

  const trace = useMemo(() => gridTrace(game), [game]);
  const puzzle = game.phase === "idle" ? null : game.puzzle;
  // Shared from the language-neutral base, never from /syndrome/es/: the
  // path fixes the language, so a link from the Spanish page would impose
  // Spanish on whoever opens it; from the base each reader gets their own
  // stored or browser language (decision of 2026-10-20).
  const url = useMemo(
    () =>
      puzzle === null
        ? null
        : puzzleUrl(window.location.origin + APP_PATH, puzzle),
    [puzzle],
  );

  const gridHost = useRef<HTMLDivElement>(null);
  const copyLink = useCallback(async () => {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      trackChallengeShared("link");
    } catch {
      setCopied(false);
    }
  }, [url]);
  const shareImage = useCallback(async () => {
    const svg = gridHost.current?.querySelector("svg");
    if (!svg || puzzle === null) return;
    try {
      // The page's painted background: follows the forced theme like the
      // grid colours do, not the OS alone.
      const blob = await gridToPngBlob(svg, pageBackground());
      const shared = await shareOrDownload(
        blob,
        t("challenge.imageName", { d: puzzle.d }),
      );
      setImageFailed(false);
      // A closed share sheet is no share (analytics.md D14).
      if (shared) trackChallengeShared("image");
    } catch {
      setImageFailed(true);
    }
  }, [puzzle, t]);

  const hasFlips = game.phase === "playing" || game.phase === "submitted";
  const flipsX = hasFlips ? countType(game.flips.x) : 0;
  const flipsZ = hasFlips ? countType(game.flips.z) : 0;
  const fromLink =
    game.phase === "ready" || (hasFlips && game.fromLink) ? 1 : 0;
  const forfeited =
    game.phase === "submitted" && (game.timedOut || game.gaveUp);
  // The decoder itself fails this puzzle: its correction leaves a logical
  // error, so "lighter" is no claim to make about it.
  const decoderFailed = game.phase === "submitted" && game.trace.verdict !== 0;

  return (
    <section
      ref={sectionRef}
      id="panel-challenge"
      className="panel panel--challenge"
      data-phase={game.phase}
      data-from-link={fromLink}
    >
      <h2>{t("challenge.title")}</h2>
      <Clamp className="challenge__intro">{t("challenge.intro")}</Clamp>
      {badLink && <p className="challenge__note">{t("challenge.badLink")}</p>}

      {game.phase === "idle" ? (
        <div className="challenge__controls">
          <button
            type="button"
            className="btn btn--primary challenge__wide"
            onClick={startNew}
          >
            {t("challenge.start")}
          </button>
        </div>
      ) : (
        <>
          {fromLink === 1 && (
            <p className="challenge__note">{t("challenge.fromLink")}</p>
          )}
          <div className="challenge__status">
            {game.phase === "playing" && remaining !== null && (
              <p
                ref={timerRef}
                className="challenge__timer"
                role="timer"
                aria-live="off"
                tabIndex={-1}
                data-urgent={remaining <= URGENT_S ? 1 : 0}
                data-remaining={remaining}
              >
                {t("challenge.timeLeft", { seconds: remaining })}
              </p>
            )}
            {game.phase === "playing" && (
              <p
                className="challenge__announce"
                aria-live="polite"
                aria-atomic="true"
              >
                {announced}
              </p>
            )}
            <p className="challenge__flips">
              {t("challenge.flips", { x: flipsX, z: flipsZ })}
            </p>
            {game.phase === "submitted" && (
              <p className="challenge__mwpm">
                {t("challenge.mwpmFlips", {
                  x: game.result.mwpmX,
                  z: game.result.mwpmZ,
                })}
              </p>
            )}
          </div>
          <div ref={gridHost} className="challenge__figure">
            <Grid
              trace={trace!}
              layers={game.phase === "submitted" ? ALL_LAYERS : PLAYING_LAYERS}
              onToggleX={game.phase === "playing" ? toggleX : undefined}
              onToggleZ={game.phase === "playing" ? toggleZ : undefined}
              label={t("challenge.gridLabel")}
            />
          </div>
          <div className="challenge__live" aria-live="polite">
            {game.phase === "ready" ? (
              <p className="hint">{t("challenge.readyHint")}</p>
            ) : game.phase === "playing" ? (
              <p className="hint">{t("challenge.hint")}</p>
            ) : (
              <>
                <p
                  ref={verdictRef}
                  className="challenge__verdict"
                  tabIndex={-1}
                  data-accepted={game.result.accepted ? 1 : 0}
                  data-forfeited={forfeited ? 1 : 0}
                >
                  {game.timedOut
                    ? t("challenge.timeUp")
                    : game.gaveUp
                      ? t("challenge.gaveUp")
                      : game.result.accepted
                        ? t("challenge.accepted")
                        : t("challenge.rejected")}
                </p>
                {forfeited && game.result.accepted && (
                  <p className="challenge__note">
                    {t("challenge.validAnyway")}
                  </p>
                )}
                {!forfeited &&
                  game.result.accepted &&
                  (game.result.bonus || !decoderFailed) && (
                    <p
                      className="challenge__bonus"
                      data-bonus={game.result.bonus ? 1 : 0}
                    >
                      {game.result.bonus
                        ? t("challenge.bonus")
                        : t("challenge.noBonus")}
                    </p>
                  )}
                {decoderFailed && (
                  <p className="challenge__decoder" data-decoder-failed="1">
                    {/* "too" only when the player failed as well. */}
                    {game.result.accepted
                      ? t("challenge.decoderFailedAccepted")
                      : t("challenge.decoderFailedRejected")}
                  </p>
                )}
                {game.points > 0 && (
                  <p className="challenge__points" data-points={game.points}>
                    {t("challenge.points", { points: game.points })}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="challenge__controls">
            <button
              type="button"
              className="btn btn--primary challenge__submit"
              disabled={game.phase !== "playing"}
              onClick={() => dispatch({ type: "submit" })}
            >
              {t("challenge.submit")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={game.phase !== "playing"}
              onClick={() => dispatch({ type: "giveUp" })}
            >
              {t("challenge.giveUp")}
            </button>
          </div>
          {game.phase === "ready" && (
            <div className="challenge__controls">
              <button
                type="button"
                className="btn btn--primary challenge__wide challenge__begin"
                onClick={begin}
              >
                {t("challenge.begin")}
              </button>
            </div>
          )}
          {game.phase === "submitted" && (
            <div className="challenge__controls">
              <button
                type="button"
                className="btn btn--primary challenge__wide"
                onClick={startNew}
              >
                {game.fromLink ? t("challenge.playNew") : t("challenge.next")}
              </button>
            </div>
          )}
          {/* The form links at the moment of most intent (analytics.md D8):
              below the controls, so a double click on Submit never lands on
              them, and outside the aria-live region. */}
          {game.phase === "submitted" && (
            <div className="challenge__follow">
              <p>{t("challenge.followUp")}</p>
              <FormLinks from="challenge_result" />
            </div>
          )}
          {url !== null && (
            <div className="challenge__share">
              <h3>{t("challenge.share")}</h3>
              <input
                className="challenge__url"
                type="text"
                readOnly
                value={url}
                aria-label={t("challenge.shareUrl")}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void copyLink()}
              >
                {t("challenge.copy")}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void shareImage()}
              >
                {t("challenge.shareImage")}
              </button>
              {copied !== null && (
                <p className="challenge__note" data-copied={copied ? 1 : 0}>
                  {copied ? t("challenge.copied") : t("challenge.copyFailed")}
                </p>
              )}
              {imageFailed && (
                <p className="challenge__note">{t("challenge.imageFailed")}</p>
              )}
            </div>
          )}
        </>
      )}

      <ExplainGroup>
        <Explain id="challengeRule" />
      </ExplainGroup>

      <ul className="challenge__record">
        <li data-best={state.record.best}>
          {t("challenge.best", { best: state.record.best })}
        </li>
        <li data-streak={state.record.streak}>
          {t("challenge.streak", { streak: state.record.streak })}
        </li>
        <li>
          {t("challenge.played", {
            solved: state.record.solved,
            played: state.record.played,
          })}
        </li>
      </ul>
    </section>
  );
}
