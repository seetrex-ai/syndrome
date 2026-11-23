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
import type { Distance } from "../../core";
import i18n from "../../i18n";
import { LAST_STEP, STEP_INTERVAL_MS, STEPS } from "./step-machine";
import { StepsPanel } from "./StepsPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The panel as App mounts it: d and p held above it. */
function Host({
  d0 = 3 as Distance,
  p0 = 0.1,
}: {
  d0?: Distance;
  p0?: number;
}) {
  const [d] = useState<Distance>(d0);
  return <StepsPanel d={d} p={p0} />;
}

const button = (key: string) =>
  screen.getByRole("button", { name: i18n.t(key) }) as HTMLButtonElement;
const panel = () =>
  document.querySelector(".panel--steps") as HTMLElement | null;
const stepIndex = () => Number(panel()?.getAttribute("data-step"));
const current = () => document.querySelector('[aria-current="step"]');
const explain = () =>
  document.querySelector(".steps__explain")?.textContent ?? "";

/** Math.random → seed, so the next "new shot" is reproducible (seed < 2^53). */
function nextSeed(seed: number) {
  vi.spyOn(Math, "random").mockReturnValue(seed / 2 ** 53);
}

describe("StepsPanel", () => {
  // The panel mounts on a random shot. Seed 7 (one X error at d = 3,
  // p = 0.1, corrected) keeps the walkthrough below deterministic.
  beforeEach(() => nextSeed(7));

  it("mounts on a random shot at the slider's p (never an empty board when p > 0), and a new distance draws another", () => {
    render(<Host />);
    expect(
      document.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(1);
    expect(stepIndex()).toBe(0);
    cleanup();
    const { rerender } = render(<StepsPanel d={3} p={1} />);
    expect(
      document.querySelectorAll('[data-qubit][data-pauli="Y"]'),
    ).toHaveLength(9);
    fireEvent.click(button("steps.next"));
    rerender(<StepsPanel d={5} p={1} />);
    expect(
      document.querySelectorAll('[data-qubit][data-pauli="Y"]'),
    ).toHaveLength(25);
    expect(stepIndex()).toBe(0);
  });

  it("redraws an empty shot while p > 0 (7 empty boards in 60 loads); p = 0 shows the empty board with one draw", () => {
    // Seed 0 is empty at d = 3, p = 0.1; seed 7 has one error (measured with
    // sampleNoise). Mutant: no redraw → 0 errors → red.
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValue(7 / 2 ** 53);
    render(<Host />);
    expect(
      document.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(1);
    expect(random).toHaveBeenCalledTimes(2);
    cleanup();
    random.mockClear();
    random.mockReturnValue(0);
    render(<Host p0={0} />);
    expect(
      document.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(0);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it("lists the five steps with their translated titles, the first one current", () => {
    render(<Host />);
    const items = [...document.querySelectorAll(".steps__item")].map(
      (el) => el.textContent,
    );
    expect(items).toEqual(STEPS.map((s) => i18n.t(`steps.${s}`)));
    expect(current()?.textContent).toBe(i18n.t("steps.errors"));
    expect(stepIndex()).toBe(0);
    expect(explain()).toContain(i18n.t("steps.explain.errors"));
  });

  it("disables back and repeat on the first step, next on the last", () => {
    render(<Host />);
    expect(button("steps.prev").disabled).toBe(true);
    expect(button("steps.restart").disabled).toBe(true);
    expect(button("steps.next").disabled).toBe(false);
    for (let i = 0; i < LAST_STEP; i++) fireEvent.click(button("steps.next"));
    expect(stepIndex()).toBe(LAST_STEP);
    expect(button("steps.next").disabled).toBe(true);
    expect(button("steps.prev").disabled).toBe(false);
    expect(button("steps.restart").disabled).toBe(false);
    expect(current()?.textContent).toBe(i18n.t("steps.verdict"));
  });

  it("next, back and repeat move the current step and its explanation", () => {
    render(<Host />);
    fireEvent.click(button("steps.next"));
    fireEvent.click(button("steps.next"));
    expect(stepIndex()).toBe(2);
    expect(explain()).toContain(i18n.t("steps.explain.matching"));
    fireEvent.click(button("steps.prev"));
    expect(stepIndex()).toBe(1);
    expect(explain()).toContain(i18n.t("steps.explain.defects"));
    fireEvent.click(button("steps.restart"));
    expect(stepIndex()).toBe(0);
  });

  it("the verdict line appears only on the last step", () => {
    render(<Host />);
    expect(document.querySelector(".steps__verdict")).toBeNull();
    for (let i = 0; i < LAST_STEP; i++) fireEvent.click(button("steps.next"));
    expect(document.querySelector(".steps__verdict")?.textContent).toBe(
      i18n.t("grid.verdict.ok"),
    );
  });

  it("the verdict is announced: it sits inside a live region", () => {
    render(<Host />);
    for (let i = 0; i < LAST_STEP; i++) fireEvent.click(button("steps.next"));
    const verdict = document.querySelector(".steps__verdict");
    expect(verdict).not.toBeNull();
    expect(verdict!.closest("[aria-live]")).not.toBeNull();
    expect(
      document.querySelector(".steps__explain")!.closest("[aria-live]"),
    ).toBe(verdict!.closest("[aria-live]"));
  });

  it("its grid has an accessible name of its own, not the interactive grid's", () => {
    render(<Host />);
    const svg = document.querySelector("svg.grid");
    expect(svg?.getAttribute("aria-label")).toBe(i18n.t("steps.gridLabel"));
    expect(svg?.getAttribute("aria-label")).not.toBe(i18n.t("grid.title"));
  });

  it("play advances one step per interval and pauses itself on the last step", () => {
    vi.useFakeTimers();
    render(<Host />);
    fireEvent.click(button("steps.play"));
    expect(button("steps.pause")).toBeTruthy();
    for (let i = 1; i <= LAST_STEP; i++) {
      act(() => {
        vi.advanceTimersByTime(STEP_INTERVAL_MS);
      });
      expect(stepIndex()).toBe(i);
    }
    // Paused by itself: the play button is back and time no longer moves it.
    expect(button("steps.play")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS * 3);
    });
    expect(stepIndex()).toBe(LAST_STEP);
    // Play on the last step replays from the first.
    fireEvent.click(button("steps.play"));
    expect(stepIndex()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS);
    });
    expect(stepIndex()).toBe(1);
  });

  it("pause stops the interval; unmount clears it (no timer left behind)", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Host />);
    fireEvent.click(button("steps.play"));
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS);
    });
    expect(stepIndex()).toBe(1);
    fireEvent.click(button("steps.pause"));
    act(() => {
      vi.advanceTimersByTime(STEP_INTERVAL_MS * 3);
    });
    expect(stepIndex()).toBe(1);
    fireEvent.click(button("steps.play"));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a new shot draws a random error with the given p and restarts the walkthrough", () => {
    nextSeed(7);
    render(<Host />);
    fireEvent.click(button("steps.next"));
    fireEvent.click(button("steps.newShot"));
    expect(stepIndex()).toBe(0);
    // Seed 7 at d = 3, p = 0.1: one error (the grid shows it from step 0).
    expect(
      document.querySelectorAll('[data-qubit]:not([data-pauli="I"])'),
    ).toHaveLength(1);
    // The grid is read-only: no button role on a qubit.
    expect(
      document.querySelectorAll('.panel--steps [data-qubit][role="button"]'),
    ).toHaveLength(0);
  });

  it("p = 1 gives a Y on every qubit and the logical Y verdict at the end", () => {
    render(<Host p0={1} />);
    fireEvent.click(button("steps.newShot"));
    expect(
      document.querySelectorAll('[data-qubit][data-pauli="Y"]'),
    ).toHaveLength(9);
    for (let i = 0; i < LAST_STEP; i++) fireEvent.click(button("steps.next"));
    expect(document.querySelector(".steps__verdict")?.textContent).toBe(
      i18n.t("grid.verdict.xz"),
    );
  });

  it("reads the step titles in Spanish", async () => {
    await i18n.changeLanguage("es");
    try {
      render(<Host />);
      const es = i18n.getFixedT("es");
      expect(current()?.textContent).toBe(es("steps.errors"));
      expect(current()?.textContent).not.toBe(
        i18n.getFixedT("en")("steps.errors"),
      );
      expect(
        screen.getByRole("button", { name: es("steps.play") }),
      ).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
