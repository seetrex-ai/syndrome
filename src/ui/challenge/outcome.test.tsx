// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Component, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChallengeResult } from "../../analytics/events";
import i18n from "../../i18n";
import { createTraceContext, decodeTrace } from "../model/trace";
import type { SubmittedGame } from "./challenge-machine";
import { ChallengePanel } from "./ChallengePanel";
import { challengeResult } from "./outcome";
import { drawPuzzle, encodePuzzle } from "./puzzle";
import { LEVEL_P } from "./score";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

function game(
  accepted: boolean,
  bonus: boolean,
  timedOut: boolean,
  gaveUp: boolean,
): SubmittedGame {
  return {
    phase: "submitted",
    timedOut,
    gaveUp,
    result: { accepted, bonus, flipsX: 0, flipsZ: 0, mwpmX: 0, mwpmZ: 0 },
  } as unknown as SubmittedGame;
}

function fakeTracker() {
  const calls: { name: string; props: Record<string, string> }[] = [];
  vi.stubGlobal("umami", {
    track: (name: string, props: Record<string, string>) => {
      calls.push({ name, props: { ...props } });
    },
  });
  return calls;
}

const SEED = 3;

/**
 * test_intent_challenge_result_mapping
 *
 * INTENCIÓN: `challenge_completed` dice cómo acabó el reto con esta regla:
 *   `optimal` = aceptado con el peso del decodificador, `valid` = aceptado, `wrong` =
 *   rechazado, tiempo agotado o rendirse; y se emite una sola vez por partida, no en
 *   cada render del panel, y sólo si el veredicto llega a confirmarse en pantalla (un
 *   render que React descarta no cuenta).
 * CONTEXTO: tasks/plans/analytics.md D13, T-E2. Un tiempo agotado con correcciones
 *   válidas se muestra como «válida igualmente», pero para la analítica cuenta como
 *   `wrong`; y el panel se vuelve a pintar tras el veredicto (copiar, cambiar d,
 *   el idioma, un `hashchange` de la navegación de secciones que cambia su `link`), lo que duplicaría el evento con una emisión en el render.
 * EXPIRA SI: la taxonomía cambia los valores de `result` o el reto deja de tener
 *   tiempo o rendición.
 */
describe("test_intent_challenge_result_mapping", () => {
  // accepted, bonus, timedOut, gaveUp → result (every combination).
  const table: readonly [
    boolean,
    boolean,
    boolean,
    boolean,
    ChallengeResult,
  ][] = [
    [true, true, false, false, "optimal"],
    [true, false, false, false, "valid"],
    [false, false, false, false, "wrong"],
    [false, true, false, false, "wrong"],
    [true, true, true, false, "wrong"],
    [true, false, true, false, "wrong"],
    [false, false, true, false, "wrong"],
    [false, true, true, false, "wrong"],
    [true, true, false, true, "wrong"],
    [true, false, false, true, "wrong"],
    [false, false, false, true, "wrong"],
    [false, true, false, true, "wrong"],
    [true, true, true, true, "wrong"],
    [true, false, true, true, "wrong"],
    [false, false, true, true, "wrong"],
    [false, true, true, true, "wrong"],
  ];

  it.each(table)(
    "accepted %s, bonus %s, timed out %s, gave up %s → %s",
    (accepted, bonus, timedOut, gaveUp, expected) => {
      expect(challengeResult(game(accepted, bonus, timedOut, gaveUp))).toBe(
        expected,
      );
    },
  );

  it("one event per finished game, whatever re-renders the panel afterwards", async () => {
    const calls = fakeTracker();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    vi.spyOn(Math, "random").mockReturnValue(SEED / 2 ** 53);
    const view = render(<ChallengePanel d={3} />);
    const button = (key: string) =>
      screen.getByRole("button", { name: i18n.t(key) });
    const completed = () =>
      calls.filter((c) => c.name === "challenge_completed");

    fireEvent.click(button("challenge.start"));
    expect(completed()).toHaveLength(0);
    fireEvent.click(button("challenge.submit"));
    expect(completed()).toEqual([
      { name: "challenge_completed", props: { d: "3", result: "wrong" } },
    ]);
    // Re-renders after the verdict: a new d prop, a new link (the hashchange a
    // section link of SectionNav causes: href="#panel-chart"), the copy note,
    // a language.
    view.rerender(<ChallengePanel d={5} />);
    view.rerender(<ChallengePanel d={5} link="#panel-chart" />);
    view.rerender(<ChallengePanel d={5} link="#panel-grid" />);
    expect(completed()).toHaveLength(1);
    await act(async () => {
      fireEvent.click(button("challenge.copy"));
    });
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(completed()).toHaveLength(1);

    // The next game counts once more; a received puzzle counts too.
    fireEvent.click(button("challenge.next"));
    fireEvent.click(button("challenge.giveUp"));
    expect(completed()).toHaveLength(2);
    expect(completed()[1]!.props).toEqual({ d: "5", result: "wrong" });
  });

  it("the decoder's own correction is optimal; a received puzzle counts with its d", () => {
    const calls = fakeTracker();
    const puzzle = drawPuzzle(3, LEVEL_P[3], () => SEED);
    const expected = decodeTrace(createTraceContext(3), puzzle.error);
    render(<ChallengePanel d={7} link={`#c=${encodePuzzle(puzzle)}`} />);
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("challenge.begin") }),
    );
    const panel = document.querySelector(".panel--challenge")!;
    const click = (q: number, shiftKey: boolean) => {
      const el = panel.querySelector(`[data-qubit="${q}"]`)!;
      fireEvent.pointerDown(el, {
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        button: 0,
      });
      fireEvent.pointerUp(el, { pointerId: 1, shiftKey });
    };
    for (let q = 0; q < 9; q++) {
      if (expected.correction.x[q] === 1) click(q, false);
      if (expected.correction.z[q] === 1) click(q, true);
    }
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("challenge.submit") }),
    );
    expect(calls).toEqual([
      { name: "challenge_completed", props: { d: "3", result: "optimal" } },
    ]);
  });

  // React may render and throw the render away (here: a sibling that throws in
  // the same update, caught by a boundary). Only a committed verdict counts,
  // which is what an effect gives and an emission in the render (even guarded
  // by a ref) does not.
  it("a verdict whose render is never committed does not count", () => {
    const calls = fakeTracker();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(SEED / 2 ** 53);
    class Boundary extends Component<{ children: ReactNode }> {
      override state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      override render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    function Bomb({ armed }: { armed: boolean }) {
      if (armed) throw new Error("sibling failed");
      return null;
    }
    function Host() {
      const [armed, setArmed] = useState(false);
      // The submit click also arms the bomb: one batched update for both.
      return (
        <div
          onClickCapture={(e) => {
            const name = (e.target as HTMLElement).textContent;
            if (name === i18n.t("challenge.giveUp")) setArmed(true);
          }}
        >
          <Boundary>
            <ChallengePanel d={3} />
            <Bomb armed={armed} />
          </Boundary>
        </div>
      );
    }
    render(<Host />);
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("challenge.start") }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("challenge.giveUp") }),
    );
    expect(document.querySelector(".panel--challenge")).toBeNull();
    expect(calls).toEqual([]);
  });
});
