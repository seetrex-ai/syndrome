// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pauliEquals, type Distance } from "../../core";
import i18n from "../../i18n";
import { LONG_PRESS_MS } from "../model/gesture";
import { createTraceContext, decodeTrace } from "../model/trace";
import { ChallengePanel, TICK_MS } from "./ChallengePanel";
import { decodePuzzle, drawPuzzle, encodePuzzle } from "./puzzle";
import {
  ANNOUNCE_AT,
  LEVEL_P,
  OPEN_KEY,
  RECORD_KEY,
  TIME_LIMIT_S,
} from "./score";
import * as share from "./share";
import {
  BG,
  rgb,
  stubPaintedBody,
} from "../../../tests/helpers/light-dark-stub";

vi.mock("./share", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./share")>();
  return {
    ...mod,
    gridToPngBlob: vi.fn(mod.gridToPngBlob),
    shareOrDownload: vi.fn(mod.shareOrDownload),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

beforeEach(() => {
  localStorage.clear();
});

/** The panel as App mounts it: d held above it. */
function Host({ d0 = 3 as Distance, link }: { d0?: Distance; link?: string }) {
  const [d] = useState<Distance>(d0);
  return <ChallengePanel d={d} link={link} />;
}

const button = (key: string) =>
  screen.getByRole("button", { name: i18n.t(key) }) as HTMLButtonElement;
const panel = () => document.querySelector(".panel--challenge") as HTMLElement;
const phase = () => panel().getAttribute("data-phase");
const qubit = (q: number) => {
  const el = panel().querySelector(`[data-qubit="${q}"]`);
  if (el === null) throw new Error(`qubit ${q} not rendered`);
  return el;
};
function click(el: Element, shift = false) {
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
  });
  fireEvent.pointerUp(el, { pointerId: 1, shiftKey: shift });
}
const count = (selector: string) => panel().querySelectorAll(selector).length;

/** Math.random → seed (seed < 2^53), so the next puzzle is reproducible. */
function nextSeed(seed: number) {
  vi.spyOn(Math, "random").mockReturnValue(seed / 2 ** 53);
}

// Seed 3 at d = 3, p = LEVEL_P[3] = 0.08: one error, two defects, verdict 0
// (searched in Node with sampleNoise + decodeTrace); the expected trace is
// computed outside React.
const SEED = 3;
const expected = decodeTrace(
  createTraceContext(3),
  drawPuzzle(3, LEVEL_P[3], () => SEED).error,
);

/** Applies the decoder's correction by clicking. */
function applyMwpm() {
  for (let q = 0; q < 9; q++) {
    if (expected.correction.x[q] === 1) click(qubit(q));
    if (expected.correction.z[q] === 1) click(qubit(q), true);
  }
}

describe("ChallengePanel", () => {
  beforeEach(() => nextSeed(SEED));

  it("starts idle: a start button, no grid, the empty record", () => {
    render(<Host />);
    expect(phase()).toBe("idle");
    expect(button("challenge.start")).toBeTruthy();
    expect(panel().querySelector("svg.grid")).toBeNull();
    expect(
      panel().querySelector("[data-best]")?.getAttribute("data-best"),
    ).toBe("0");
  });

  it("a new puzzle shows its defects, hides its errors, starts the clock and the flip count at zero", () => {
    expect(expected.verdict).toBe(0);
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    expect(phase()).toBe("playing");
    const defects = [...expected.syndromes.Z, ...expected.syndromes.X].filter(
      (b) => b === 1,
    ).length;
    expect(defects).toBe(2);
    expect(count('[data-defect="1"]')).toBe(defects);
    expect(count('[data-qubit]:not([data-pauli="I"])')).toBe(0);
    expect(count("polyline[data-chain]")).toBe(0);
    expect(panel().querySelector('[role="timer"]')?.textContent).toBe(
      i18n.t("challenge.timeLeft", { seconds: TIME_LIMIT_S[3] }),
    );
    expect(panel().querySelector(".challenge__flips")?.textContent).toBe(
      i18n.t("challenge.flips", { x: 0, z: 0 }),
    );
    expect(panel().querySelector("svg.grid")?.getAttribute("aria-label")).toBe(
      i18n.t("challenge.gridLabel"),
    );
  });

  it("the clock counts down each second in a live region and times the puzzle out at the limit", () => {
    vi.useFakeTimers();
    render(<Host />);
    // React itself keeps a scheduler timer around, and jsdom's focus() queues
    // a zero-delay `selectionchange`; the clock's interval (TICK_MS, never 0)
    // is what must appear at Start and go when the game ends, so the count is
    // taken once the zero-delay timers have run.
    const settledTimers = () => {
      act(() => {
        vi.advanceTimersByTime(0);
      });
      return vi.getTimerCount();
    };
    const baseline = settledTimers();
    fireEvent.click(button("challenge.start"));
    expect(settledTimers()).toBe(baseline + 1);
    const timer = () => panel().querySelector('[role="timer"]')!;
    // The clock itself is silent for a screen reader (it would speak every
    // second); a separate polite region announces ANNOUNCE_AT.
    expect(timer().getAttribute("aria-live")).toBe("off");
    const announcer = () => panel().querySelector(".challenge__announce")!;
    expect(announcer().getAttribute("aria-live")).toBe("polite");
    expect(announcer().textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(timer().getAttribute("data-remaining")).toBe(
      String(TIME_LIMIT_S[3] - 1),
    );
    expect(ANNOUNCE_AT).toEqual([10, 5]);
    act(() => {
      vi.advanceTimersByTime((TIME_LIMIT_S[3] - 1 - 10) * 1000);
    });
    expect(timer().getAttribute("data-remaining")).toBe("10");
    expect(announcer().textContent).toBe(
      i18n.t("challenge.secondsLeft", { count: 10 }),
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(announcer().textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(timer().getAttribute("data-remaining")).toBe("5");
    expect(announcer().textContent).toBe(
      i18n.t("challenge.secondsLeft", { count: 5 }),
    );
    // The announcement is pluralised: one second is not "seconds".
    for (const [code, plural] of [
      ["en", /seconds/],
      ["es", /segundos/],
    ] as const) {
      const fixed = i18n.getFixedT(code);
      expect(fixed("challenge.secondsLeft", { count: 5 })).toMatch(plural);
      expect(fixed("challenge.secondsLeft", { count: 1 })).not.toMatch(plural);
      expect(fixed("challenge.secondsLeft", { count: 1 })).toContain("1");
    }
    act(() => {
      vi.advanceTimersByTime(5 * 1000 - TICK_MS);
    });
    expect(phase()).toBe("playing");
    act(() => {
      vi.advanceTimersByTime(TICK_MS);
    });
    expect(phase()).toBe("submitted");
    expect(panel().querySelector(".challenge__verdict")?.textContent).toBe(
      i18n.t("challenge.timeUp"),
    );
    expect(panel().querySelector('[role="timer"]')).toBeNull();
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("0");
    // No interval left behind after the verdict.
    expect(settledTimers()).toBe(baseline);
  });

  it("a click flips X, Shift+click flips Z, a long press flips Z; the flip count follows", () => {
    vi.useFakeTimers();
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    click(qubit(4));
    expect(qubit(4).getAttribute("data-pauli")).toBe("X");
    click(qubit(4), true);
    expect(qubit(4).getAttribute("data-pauli")).toBe("Y");
    fireEvent.pointerDown(qubit(0), {
      pointerId: 2,
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerUp(qubit(0), { pointerId: 2 });
    expect(qubit(0).getAttribute("data-pauli")).toBe("Z");
    expect(panel().querySelector(".challenge__flips")?.textContent).toBe(
      i18n.t("challenge.flips", { x: 1, z: 2 }),
    );
  });

  it("submitting the decoder's correction: accepted with the bonus, the decoder's answer overlaid, points and streak", () => {
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    applyMwpm();
    fireEvent.click(button("challenge.submit"));
    expect(phase()).toBe("submitted");
    const verdict = panel().querySelector(".challenge__verdict")!;
    expect(verdict.textContent).toBe(i18n.t("challenge.accepted"));
    expect(verdict.getAttribute("data-accepted")).toBe("1");
    expect(verdict.closest("[aria-live]")).not.toBeNull();
    expect(panel().querySelector(".challenge__bonus")?.textContent).toBe(
      i18n.t("challenge.bonus"),
    );
    // The decoder's answer on top: its matching edges and chains, the fixed
    // defects, the player's flips, and no residual (same class, bonus ⇒ the
    // residual is a stabilizer; here the identity).
    const chains = expected.chains.Z.length + expected.chains.X.length;
    expect(count("polyline[data-chain]")).toBe(chains);
    expect(count("line[data-match]")).toBe(chains);
    expect(count('[data-defect="1"]')).toBe(2);
    expect(count('[data-qubit]:not([data-pauli="I"])')).toBe(1);
    expect(count('[data-qubit]:not([data-correction="I"])')).toBe(1);
    expect(
      panel().querySelector(".challenge__points")?.getAttribute("data-points"),
    ).toBe(String((10 + 5) * 3));
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("1");
    expect(
      panel().querySelector("[data-best]")?.getAttribute("data-best"),
    ).toBe("45");
    // The grid is read-only now: clicks change nothing.
    expect(count('[data-qubit][role="button"]')).toBe(0);
    expect(button("challenge.next")).toBeTruthy();
  });

  it("submitting nothing: rejected, the player's residual (the error itself) drawn, streak 0, played counted", () => {
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    fireEvent.click(button("challenge.submit"));
    const verdict = panel().querySelector(".challenge__verdict")!;
    expect(verdict.textContent).toBe(i18n.t("challenge.rejected"));
    expect(verdict.getAttribute("data-accepted")).toBe("0");
    expect(panel().querySelector(".challenge__bonus")).toBeNull();
    expect(panel().querySelector(".challenge__points")).toBeNull();
    expect(count('[data-qubit]:not([data-residual="I"])')).toBe(1);
    expect(panel().textContent).toContain(
      i18n.t("challenge.played", { solved: 0, played: 1 }),
    );
  });

  it("give up forfeits: judged, 0 points, streak 0, presented as failed with no bonus; the valid correction is only noted", () => {
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    applyMwpm();
    fireEvent.click(button("challenge.giveUp"));
    const verdict = panel().querySelector(".challenge__verdict")!;
    expect(verdict.textContent).toBe(i18n.t("challenge.gaveUp"));
    expect(verdict.getAttribute("data-accepted")).toBe("1");
    expect(verdict.getAttribute("data-forfeited")).toBe("1");
    expect(panel().querySelector(".challenge__bonus")).toBeNull();
    expect(panel().textContent).not.toContain(i18n.t("challenge.bonus"));
    expect(panel().textContent).toContain(i18n.t("challenge.validAnyway"));
    expect(panel().querySelector(".challenge__points")).toBeNull();
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("0");
    // A forfeit with an invalid correction gets no such note.
    fireEvent.click(button("challenge.next"));
    fireEvent.click(button("challenge.giveUp"));
    expect(
      panel()
        .querySelector(".challenge__verdict")
        ?.getAttribute("data-accepted"),
    ).toBe("0");
    expect(panel().textContent).not.toContain(i18n.t("challenge.validAnyway"));
  });

  it("a double click on Next does not submit the new puzzle, and one on Submit does not start the next", () => {
    render(<Host />);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(
        i === 0 ? button("challenge.start") : button("challenge.next"),
      );
      applyMwpm();
      fireEvent.click(button("challenge.submit"));
    }
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("2");
    const next = button("challenge.next");
    fireEvent.click(next);
    fireEvent.click(next);
    expect(phase()).toBe("playing");
    expect(panel().querySelector(".challenge__verdict")).toBeNull();
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("2");
    // Submit and Give up stay where they are, disabled, after the verdict:
    // the second click of a double click lands on a dead button.
    applyMwpm();
    const submit = button("challenge.submit");
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(phase()).toBe("submitted");
    expect(submit.disabled).toBe(true);
    expect(button("challenge.giveUp").disabled).toBe(true);
    expect(panel().querySelector(".challenge__verdict")?.textContent).toBe(
      i18n.t("challenge.accepted"),
    );
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("3");
  });

  it("names a decoder failure: on i3.kAA the player's valid answer is accepted without the 'lighter correction' claim", () => {
    // X on (0,0) and (1,0): one defect; the decoder flips (2,0) and completes
    // X_L. The player's two flips undo the error exactly.
    const linked = decodePuzzle("i3.kAA")!;
    expect(decodeTrace(createTraceContext(3), linked.error).verdict).not.toBe(
      0,
    );
    render(<Host link="#c=i3.kAA" />);
    fireEvent.click(button("challenge.begin"));
    click(qubit(0));
    click(qubit(3));
    fireEvent.click(button("challenge.submit"));
    const verdict = panel().querySelector(".challenge__verdict")!;
    expect(verdict.getAttribute("data-accepted")).toBe("1");
    // The wording follows the verdict: an accepted answer beat the decoder;
    // "too" would say the player failed as well.
    const accepted = i18n.t("challenge.decoderFailedAccepted");
    const rejected = i18n.t("challenge.decoderFailedRejected");
    expect(accepted).not.toBe(rejected);
    expect(panel().querySelector(".challenge__decoder")?.textContent).toBe(
      accepted,
    );
    expect(panel().textContent).not.toContain(rejected);
    expect(panel().textContent).not.toContain(i18n.t("challenge.noBonus"));
    expect(panel().querySelector(".challenge__bonus")).toBeNull();
    expect(panel().textContent).toContain(
      i18n.t("challenge.mwpmFlips", { x: 1, z: 0 }),
    );
    // The same puzzle submitted empty: rejected, and the decoder fails "too".
    cleanup();
    render(<Host link="#c=i3.kAA" />);
    fireEvent.click(button("challenge.begin"));
    fireEvent.click(button("challenge.submit"));
    expect(
      panel()
        .querySelector(".challenge__verdict")
        ?.getAttribute("data-accepted"),
    ).toBe("0");
    expect(panel().querySelector(".challenge__decoder")?.textContent).toBe(
      rejected,
    );
    expect(panel().textContent).not.toContain(accepted);
    // Control: when the decoder is right, nothing says it failed.
    cleanup();
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    fireEvent.click(button("challenge.submit"));
    expect(panel().querySelector(".challenge__decoder")).toBeNull();
    expect(panel().textContent).not.toContain(accepted);
    expect(panel().textContent).not.toContain(rejected);
  });

  it("moves focus to the clock on New puzzle, Start and Next, and to the verdict on Submit, Give up and time up", () => {
    vi.useFakeTimers();
    render(<Host />);
    const timer = () => panel().querySelector('[role="timer"]');
    const verdict = () => panel().querySelector(".challenge__verdict");
    fireEvent.click(button("challenge.start"));
    expect(timer()?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(timer());
    fireEvent.click(button("challenge.submit"));
    expect(verdict()?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(verdict());
    fireEvent.click(button("challenge.next"));
    expect(document.activeElement).toBe(timer());
    fireEvent.click(button("challenge.giveUp"));
    expect(document.activeElement).toBe(verdict());
    fireEvent.click(button("challenge.next"));
    expect(document.activeElement).toBe(timer());
    act(() => {
      vi.advanceTimersByTime(TIME_LIMIT_S[3] * 1000 + TICK_MS);
    });
    expect(phase()).toBe("submitted");
    expect(document.activeElement).toBe(verdict());
    // A received puzzle takes no focus until the player's own gesture.
    cleanup();
    render(<Host link="#c=i3.gAA" />);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button("challenge.begin"));
    expect(document.activeElement).toBe(timer());
  });

  it("never steals focus from a control outside the panel when the clock runs out", () => {
    vi.useFakeTimers();
    render(
      <>
        <input data-testid="outside" />
        <Host />
      </>,
    );
    const timer = () => panel().querySelector('[role="timer"]');
    const verdict = () => panel().querySelector(".challenge__verdict");
    fireEvent.click(button("challenge.start"));
    expect(document.activeElement).toBe(timer());
    const outside = screen.getByTestId("outside");
    outside.focus();
    expect(document.activeElement).toBe(outside);
    act(() => {
      vi.advanceTimersByTime(TIME_LIMIT_S[3] * 1000 + TICK_MS);
    });
    expect(phase()).toBe("submitted");
    expect(document.activeElement).toBe(outside);
    // A gesture inside the panel still moves it. A real click focuses the
    // button first; jsdom's fireEvent does not, so the test does.
    button("challenge.next").focus();
    fireEvent.click(button("challenge.next"));
    expect(document.activeElement).toBe(timer());
    button("challenge.submit").focus();
    fireEvent.click(button("challenge.submit"));
    expect(document.activeElement).toBe(verdict());
  });

  it("marks an own game in progress; mounting on the mark settles it as abandoned (streak 0, played + 1, best and solved intact) and clears it; a verdict clears it and a received game never writes it", () => {
    localStorage.setItem(
      RECORD_KEY,
      JSON.stringify({ best: 50, streak: 5, played: 7, solved: 6 }),
    );
    render(<Host />);
    expect(localStorage.getItem(OPEN_KEY)).toBeNull();
    fireEvent.click(button("challenge.start"));
    expect(localStorage.getItem(OPEN_KEY)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual({
      best: 50,
      streak: 5,
      played: 7,
      solved: 6,
    });
    // Reload mid-game: the abandoned puzzle is a failure (D12: abandoning is failing).
    cleanup();
    render(<Host />);
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual({
      best: 50,
      streak: 0,
      played: 8,
      solved: 6,
    });
    expect(localStorage.getItem(OPEN_KEY)).toBeNull();
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("0");
    // One failure per abandoned game: a second mount changes nothing.
    cleanup();
    render(<Host />);
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual({
      best: 50,
      streak: 0,
      played: 8,
      solved: 6,
    });
    // A verdict clears the mark; a reload after it changes nothing.
    fireEvent.click(button("challenge.start"));
    applyMwpm();
    fireEvent.click(button("challenge.submit"));
    expect(localStorage.getItem(OPEN_KEY)).toBeNull();
    const settled = { best: 50, streak: 1, played: 9, solved: 7 };
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual(settled);
    cleanup();
    render(<Host />);
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual(settled);
    // A received puzzle is played outside the record: no mark, even started.
    cleanup();
    render(<Host link="#c=i3.gAA" />);
    fireEvent.click(button("challenge.begin"));
    expect(phase()).toBe("playing");
    expect(localStorage.getItem(OPEN_KEY)).toBeNull();
    cleanup();
    render(<Host />);
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual(settled);
  });

  it("shares the directory of the page, never index.html", () => {
    window.history.replaceState(null, "", "/index.html");
    try {
      render(<Host />);
      fireEvent.click(button("challenge.start"));
      const input = screen.getByRole("textbox", {
        name: i18n.t("challenge.shareUrl"),
      }) as HTMLInputElement;
      expect(input.value).toBe(
        `${location.origin}/syndrome/#c=${encodePuzzle(drawPuzzle(3, LEVEL_P[3], () => SEED))}`,
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("explains the rule in context", () => {
    render(<Host />);
    expect(
      screen.getByRole("button", {
        name: i18n.t("explain.challengeRule.title"),
      }),
    ).toBeTruthy();
  });

  it("offers the link and the image while playing and after the verdict; copy writes the URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    const input = screen.getByRole("textbox", {
      name: i18n.t("challenge.shareUrl"),
    }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    const url = input.value;
    expect(url).toBe(
      `${location.origin}/syndrome/#c=${encodePuzzle(decodePuzzle(url.split("#c=")[1]!)!)}`,
    );
    expect(
      pauliEquals(decodePuzzle(url.split("#c=")[1]!)!.error, expected.error),
    ).toBe(true);
    await act(async () => {
      fireEvent.click(button("challenge.copy"));
    });
    expect(writeText).toHaveBeenCalledWith(url);
    expect(panel().querySelector("[data-copied]")?.textContent).toBe(
      i18n.t("challenge.copied"),
    );
    fireEvent.click(button("challenge.submit"));
    expect(
      (
        screen.getByRole("textbox", {
          name: i18n.t("challenge.shareUrl"),
        }) as HTMLInputElement
      ).value,
    ).toBe(url);
    expect(button("challenge.shareImage")).toBeTruthy();
    // A new puzzle clears the "copied" note.
    fireEvent.click(button("challenge.next"));
    expect(panel().querySelector("[data-copied]")).toBeNull();
  });

  it("share image rasterises the grid and hands the PNG to Web Share or a download, named after d", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    vi.mocked(share.gridToPngBlob).mockResolvedValue(blob);
    vi.mocked(share.shareOrDownload).mockResolvedValue(true);
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    await act(async () => {
      fireEvent.click(button("challenge.shareImage"));
    });
    expect(share.gridToPngBlob).toHaveBeenCalledTimes(1);
    const svg = vi.mocked(share.gridToPngBlob).mock.calls[0]![0];
    expect(svg).toBe(panel().querySelector("svg.grid"));
    expect(share.shareOrDownload).toHaveBeenCalledWith(blob, "syndrome-d3.png");
    expect(panel().textContent).not.toContain(i18n.t("challenge.imageFailed"));
    // A failure is reported, not thrown.
    vi.mocked(share.gridToPngBlob).mockRejectedValue(new Error("no canvas"));
    await act(async () => {
      fireEvent.click(button("challenge.shareImage"));
    });
    expect(panel().textContent).toContain(i18n.t("challenge.imageFailed"));
  });

  it.each([
    ["dark", false, BG.dark],
    ["light", true, BG.light],
  ])(
    "share image paints the page's background: forced %s theme on an OS whose dark preference is %s gives the %s side of --bg",
    async (forced, osDark, expected) => {
      stubPaintedBody(osDark);
      document.documentElement.setAttribute("data-theme", forced);
      vi.mocked(share.gridToPngBlob).mockResolvedValue(
        new Blob(["png"], { type: "image/png" }),
      );
      vi.mocked(share.shareOrDownload).mockResolvedValue(true);
      render(<Host />);
      fireEvent.click(button("challenge.start"));
      await act(async () => {
        fireEvent.click(button("challenge.shareImage"));
      });
      expect(vi.mocked(share.gridToPngBlob).mock.calls[0]![1]).toBe(
        rgb(expected),
      );
    },
  );

  it("opens a `#c=` link as a received puzzle that waits for Start (no clock, no flips), outside the record, and offers a new one after", () => {
    vi.useFakeTimers();
    localStorage.setItem(
      RECORD_KEY,
      JSON.stringify({ best: 30, streak: 2, played: 4, solved: 3 }),
    );
    const linked = decodePuzzle("i5.gAAAAAAAA")!;
    render(<Host link="#c=i5.gAAAAAAAA" />);
    expect(phase()).toBe("ready");
    expect(panel().getAttribute("data-from-link")).toBe("1");
    expect(
      panel().querySelector("svg.grid")?.getAttribute("data-distance"),
    ).toBe("5");
    expect(panel().textContent).toContain(i18n.t("challenge.fromLink"));
    expect(panel().textContent).toContain(i18n.t("challenge.readyHint"));
    const defects = [
      ...decodeTrace(createTraceContext(5), linked.error).syndromes.Z,
    ].filter((b) => b === 1).length;
    expect(count('[data-defect="1"]')).toBe(defects);
    // Nothing runs and nothing is taken before the gesture.
    expect(panel().querySelector('[role="timer"]')).toBeNull();
    expect(count('[data-qubit][role="button"]')).toBe(0);
    click(qubit(0));
    expect(count('[data-qubit]:not([data-pauli="I"])')).toBe(0);
    expect(button("challenge.submit").disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(TIME_LIMIT_S[5] * 1000 + 1000);
    });
    expect(phase()).toBe("ready");
    // Start: the clock begins now, at the full limit.
    const begin = button("challenge.begin");
    fireEvent.click(begin);
    fireEvent.click(begin); // a double click must not submit
    expect(phase()).toBe("playing");
    expect(panel().querySelector('[role="timer"]')?.textContent).toBe(
      i18n.t("challenge.timeLeft", { seconds: TIME_LIMIT_S[5] }),
    );
    expect(count('[data-defect="1"]')).toBe(defects);
    fireEvent.click(button("challenge.submit"));
    expect(phase()).toBe("submitted");
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("2");
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual({
      best: 30,
      streak: 2,
      played: 4,
      solved: 3,
    });
    // "Play a new puzzle" draws at the app's d, not the link's.
    fireEvent.click(button("challenge.playNew"));
    expect(phase()).toBe("playing");
    expect(panel().getAttribute("data-from-link")).toBe("0");
    expect(
      panel().querySelector("svg.grid")?.getAttribute("data-distance"),
    ).toBe("3");
  });

  it("a bad link says so and starts idle; a link with no defect is a bad link", () => {
    for (const bad of ["#c=i3.AAA=", "#c=i3.kgA", "#c=i3.wAA"]) {
      render(<Host link={bad} />);
      expect(phase(), bad).toBe("idle");
      expect(panel().textContent, bad).toContain(i18n.t("challenge.badLink"));
      cleanup();
    }
    render(<Host link="" />);
    expect(panel().textContent).not.toContain(i18n.t("challenge.badLink"));
  });

  it("a link that arrives later (hashchange) loads its puzzle, replacing the game in progress after the same gesture", () => {
    const { rerender } = render(<Host link="" />);
    fireEvent.click(button("challenge.start"));
    click(qubit(4));
    expect(phase()).toBe("playing");
    rerender(<Host link="#c=i5.gAAAAAAAA" />);
    expect(phase()).toBe("ready");
    // The own game it replaced was abandoned: a failure.
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual({
      best: 0,
      streak: 0,
      played: 1,
      solved: 0,
    });
    expect(localStorage.getItem(OPEN_KEY)).toBeNull();
    expect(
      panel().querySelector("svg.grid")?.getAttribute("data-distance"),
    ).toBe("5");
    expect(count('[data-qubit]:not([data-pauli="I"])')).toBe(0);
    fireEvent.click(button("challenge.begin"));
    expect(phase()).toBe("playing");
    expect(panel().getAttribute("data-from-link")).toBe("1");
    // A bad link later: noted, the game goes on.
    rerender(<Host link="#c=i3.AAA=" />);
    expect(phase()).toBe("playing");
    expect(panel().textContent).toContain(i18n.t("challenge.badLink"));
  });

  it("persists best, streak, played and solved in localStorage and reads them back on mount", () => {
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    applyMwpm();
    fireEvent.click(button("challenge.submit"));
    expect(JSON.parse(localStorage.getItem(RECORD_KEY)!)).toEqual({
      best: 45,
      streak: 1,
      played: 1,
      solved: 1,
    });
    cleanup();
    render(<Host />);
    expect(
      panel().querySelector("[data-best]")?.getAttribute("data-best"),
    ).toBe("45");
    expect(
      panel().querySelector("[data-streak]")?.getAttribute("data-streak"),
    ).toBe("1");
  });

  it("survives a storage that throws (private mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Host />);
    fireEvent.click(button("challenge.start"));
    expect(phase()).toBe("playing");
    fireEvent.click(button("challenge.submit"));
    expect(phase()).toBe("submitted");
    fireEvent.click(button("challenge.next"));
    expect(phase()).toBe("playing");
  });

  it("reads its texts in Spanish", async () => {
    await i18n.changeLanguage("es");
    try {
      render(<Host />);
      const es = i18n.getFixedT("es");
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        es("challenge.title"),
      );
      expect(
        screen.getByRole("button", { name: es("challenge.start") }),
      ).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
