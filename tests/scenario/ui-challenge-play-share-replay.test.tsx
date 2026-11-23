// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pauliEquals } from "../../src/core";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";
import { decodePuzzle, drawPuzzle } from "../../src/ui/challenge/puzzle";
import {
  BONUS_POINTS,
  LEVEL_P,
  RECORD_KEY,
  SOLVED_POINTS,
} from "../../src/ui/challenge/score";
import { createTraceContext, decodeTrace } from "../../src/ui/model/trace";

/**
 * test_scenario_ui_challenge_play_share_replay
 *
 * The challenge end to end through the real App (tasks/plans/phase2.md §5):
 * a puzzle at d = 3 (seed 3 at LEVEL_P[3]: one error, two defects,
 * corrected by one flip) → the share link decodes to the very same error →
 * the decoder's correction, clicked in, is accepted with the bonus → streak 1
 * → a second puzzle submitted empty is rejected → streak 0 → the page is
 * reloaded on the shared link: the same puzzle opens as a received challenge
 * and the best score survived in localStorage.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

const SEED = 3;
const expected = decodeTrace(
  createTraceContext(3),
  drawPuzzle(3, LEVEL_P[3], () => SEED).error,
);

const panel = () => document.querySelector(".panel--challenge") as HTMLElement;
const button = (key: string) =>
  screen.getByRole("button", { name: i18n.t(key) }) as HTMLButtonElement;
const qubit = (q: number) => panel().querySelector(`[data-qubit="${q}"]`)!;
const attr = (selector: string, name: string) =>
  document.querySelector(selector)?.getAttribute(name);
function click(el: Element, shift = false) {
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
  });
  fireEvent.pointerUp(el, { pointerId: 1, shiftKey: shift });
}

describe("test_scenario_ui_challenge_play_share_replay", () => {
  it("play, share, replay", () => {
    vi.spyOn(Math, "random").mockReturnValue(SEED / 2 ** 53);
    expect(expected.verdict).toBe(0);
    render(<App />);
    expect(attr(".panel--challenge", "data-phase")).toBe("idle");

    // A puzzle: defects on the board, no error shown.
    fireEvent.click(button("challenge.start"));
    expect(attr(".panel--challenge", "data-phase")).toBe("playing");
    expect(panel().querySelectorAll('[data-defect="1"]')).toHaveLength(2);
    expect(
      panel().querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(0);

    // The share link carries exactly this error.
    const url = (
      screen.getByRole("textbox", {
        name: i18n.t("challenge.shareUrl"),
      }) as HTMLInputElement
    ).value;
    const hash = url.slice(url.indexOf("#"));
    expect(hash.startsWith("#c=i3.")).toBe(true);
    const shared = decodePuzzle(hash.slice("#c=".length))!;
    expect(pauliEquals(shared.error, expected.error)).toBe(true);

    // The decoder's correction, clicked in, is accepted with the bonus.
    for (let q = 0; q < 9; q++) {
      if (expected.correction.x[q] === 1) click(qubit(q));
      if (expected.correction.z[q] === 1) click(qubit(q), true);
    }
    fireEvent.click(button("challenge.submit"));
    expect(attr(".challenge__verdict", "data-accepted")).toBe("1");
    expect(attr(".challenge__bonus", "data-bonus")).toBe("1");
    const points = (SOLVED_POINTS + BONUS_POINTS) * 3;
    expect(attr(".challenge__points", "data-points")).toBe(String(points));
    expect(attr("[data-streak]", "data-streak")).toBe("1");
    // The decoder's answer is overlaid: chains and matching edges.
    expect(panel().querySelectorAll("polyline[data-chain]")).toHaveLength(
      expected.chains.Z.length + expected.chains.X.length,
    );

    // A second puzzle (same seed: same board), submitted empty: rejected.
    fireEvent.click(button("challenge.next"));
    expect(attr(".panel--challenge", "data-phase")).toBe("playing");
    fireEvent.click(button("challenge.submit"));
    expect(attr(".challenge__verdict", "data-accepted")).toBe("0");
    expect(attr("[data-streak]", "data-streak")).toBe("0");
    expect(attr("[data-best]", "data-best")).toBe(String(points));
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual({
      best: points,
      streak: 0,
      played: 2,
      solved: 1,
    });

    // The other panels did not notice: the interactive grid is still clean.
    expect(
      document.querySelectorAll(
        '.panel--grid [data-qubit]:not([data-pauli="I"])',
      ),
    ).toHaveLength(0);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);

    // Reload on the shared link: the same puzzle, as a received challenge,
    // with the record read back.
    cleanup();
    window.location.hash = hash;
    render(<App />);
    // The received puzzle waits for the player's gesture.
    expect(attr(".panel--challenge", "data-phase")).toBe("ready");
    expect(attr(".panel--challenge", "data-from-link")).toBe("1");
    expect(panel().textContent).toContain(i18n.t("challenge.fromLink"));
    expect(panel().querySelectorAll('[data-defect="1"]')).toHaveLength(2);
    expect(attr("[data-best]", "data-best")).toBe(String(points));
    fireEvent.click(button("challenge.begin"));
    expect(attr(".panel--challenge", "data-phase")).toBe("playing");
    const again = (
      screen.getByRole("textbox", {
        name: i18n.t("challenge.shareUrl"),
      }) as HTMLInputElement
    ).value;
    expect(again.slice(again.indexOf("#"))).toBe(hash);
    // Solving it does not touch the record.
    for (let q = 0; q < 9; q++) {
      if (expected.correction.x[q] === 1) click(qubit(q));
      if (expected.correction.z[q] === 1) click(qubit(q), true);
    }
    fireEvent.click(button("challenge.submit"));
    expect(attr(".challenge__verdict", "data-accepted")).toBe("1");
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual({
      best: points,
      streak: 0,
      played: 2,
      solved: 1,
    });
    expect(button("challenge.playNew")).toBeTruthy();
  });

  it("a link pasted into the open page (hashchange) loads that puzzle in the same tab", () => {
    render(<App />);
    expect(attr(".panel--challenge", "data-phase")).toBe("idle");
    window.location.hash = "#c=i5.gAAAAAAAA";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(attr(".panel--challenge", "data-phase")).toBe("ready");
    expect(attr(".panel--challenge svg.grid", "data-distance")).toBe("5");
    fireEvent.click(button("challenge.begin"));
    expect(attr(".panel--challenge", "data-phase")).toBe("playing");
    // Another link mid-game replaces it, again behind the gesture.
    window.location.hash = "#c=i3.gAA";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(attr(".panel--challenge", "data-phase")).toBe("ready");
    expect(attr(".panel--challenge svg.grid", "data-distance")).toBe("3");
  });
});
