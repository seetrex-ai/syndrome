// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { taxonomyProblems } from "../../src/analytics/taxonomy";
import i18n from "../../src/i18n";
import { App } from "../../src/ui/App";
import { drawPuzzle } from "../../src/ui/challenge/puzzle";
import { LEVEL_P } from "../../src/ui/challenge/score";
import * as share from "../../src/ui/challenge/share";
import { createTraceContext, decodeTrace } from "../../src/ui/model/trace";
import { fakeWorkerFactory } from "../helpers/fake-worker";

// jsdom cannot rasterise the SVG: the PNG is a stub; the share itself is real.
vi.mock("../../src/ui/challenge/share", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../../src/ui/challenge/share")>();
  return { ...mod, gridToPngBlob: vi.fn(mod.gridToPngBlob) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.location.hash = "";
  localStorage.clear();
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

const SEED = 3;

const button = (key: string) =>
  screen.getByRole("button", { name: i18n.t(key) });
function click(el: Element, shift = false) {
  fireEvent.pointerDown(el, {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
  });
  fireEvent.pointerUp(el, { pointerId: 1, shiftKey: shift });
}

/**
 * test_scenario_challenge_play_share_counts_once
 *
 * De extremo a extremo con la App real y un contador falso (tasks/plans/analytics.md
 * T-S1, D13, D14): jugar el puzle con la corrección del decodificador y enviar ⇒ un
 * `challenge_completed` `optimal`; copiar el enlace ⇒ `challenge_shared` `link`;
 * compartir la imagen ⇒ `image`; cerrar la hoja de compartir ⇒ nada; siguiente y
 * rendirse ⇒ `wrong`. Todo pasa el validador de la taxonomía y ningún payload lleva la
 * máscara del puzle (`#c=`) ni la URL.
 */
describe("test_scenario_challenge_play_share_counts_once", () => {
  it("play, submit, copy, share, cancel, next, give up", async () => {
    const calls: { name: string; props: Record<string, string> }[] = [];
    vi.stubGlobal("umami", {
      track: (name: string, props: Record<string, string>) => {
        calls.push({ name, props: { ...props } });
      },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const shareSheet = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new DOMException("closed", "AbortError"));
    Object.assign(navigator, { share: shareSheet, canShare: () => true });
    vi.mocked(share.gridToPngBlob).mockResolvedValue(
      new Blob(["png"], { type: "image/png" }),
    );
    vi.spyOn(Math, "random").mockReturnValue(SEED / 2 ** 53);
    const expected = decodeTrace(
      createTraceContext(3),
      drawPuzzle(3, LEVEL_P[3], () => SEED).error,
    );

    render(<App createWorker={fakeWorkerFactory().create} />);
    const panel = document.querySelector(".panel--challenge")!;
    fireEvent.click(button("challenge.start"));
    for (let q = 0; q < 9; q++) {
      const el = panel.querySelector(`[data-qubit="${q}"]`)!;
      if (expected.correction.x[q] === 1) click(el);
      if (expected.correction.z[q] === 1) click(el, true);
    }
    fireEvent.click(button("challenge.submit"));
    expect(calls).toEqual([
      { name: "challenge_completed", props: { d: "3", result: "optimal" } },
    ]);

    await act(async () => {
      fireEvent.click(button("challenge.copy"));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(button("challenge.shareImage"));
    });
    await act(async () => {
      fireEvent.click(button("challenge.shareImage"));
    });
    expect(shareSheet).toHaveBeenCalledTimes(2);
    expect(calls.slice(1)).toEqual([
      { name: "challenge_shared", props: { method: "link" } },
      { name: "challenge_shared", props: { method: "image" } },
    ]);

    // Failures share nothing: a refused clipboard, an image that cannot be made.
    writeText.mockRejectedValueOnce(new Error("denied"));
    await act(async () => {
      fireEvent.click(button("challenge.copy"));
    });
    vi.mocked(share.gridToPngBlob).mockRejectedValueOnce(new Error("canvas"));
    await act(async () => {
      fireEvent.click(button("challenge.shareImage"));
    });
    expect(
      document.querySelector("[data-copied]")!.getAttribute("data-copied"),
    ).toBe("0");
    expect(calls).toHaveLength(3);

    fireEvent.click(button("challenge.next"));
    fireEvent.click(button("challenge.giveUp"));
    expect(calls.slice(3)).toEqual([
      { name: "challenge_completed", props: { d: "3", result: "wrong" } },
    ]);

    expect(calls).toHaveLength(4);
    for (const { name, props } of calls) {
      expect(taxonomyProblems(name, props)).toEqual([]);
      const payload = JSON.stringify({ name, props });
      expect(payload).not.toContain("#c=");
      expect(payload).not.toContain("http");
    }
  });
});

/**
 * test_scenario_challenge_completed_once_under_strict_mode
 *
 * La app de verdad se monta dentro de `<StrictMode>` (`src/main.tsx`), que en desarrollo
 * monta, desmonta y vuelve a montar cada componente, repite sus efectos y pinta dos veces.
 * Un veredicto debe seguir contando una sola vez (tasks/plans/analytics.md D13) aunque la
 * app se vuelva a pintar después: jugar con la corrección del decodificador y enviar ⇒ un
 * `challenge_completed` `optimal`; tras él, cambiar el idioma (ida y vuelta), navegar a
 * `#panel-chart` (el `hashchange` de un enlace de la navegación de secciones, que cambia
 * el `link` del panel) y cambiar la distancia no añaden ninguno; siguiente y rendirse ⇒
 * otro, `wrong`, y los mismos re-pintados tampoco lo repiten.
 */
describe("test_scenario_challenge_completed_once_under_strict_mode", () => {
  it("one challenge_completed per finished game inside StrictMode, whatever re-renders the app afterwards", async () => {
    const calls: { name: string; props: Record<string, string> }[] = [];
    vi.stubGlobal("umami", {
      track: (name: string, props: Record<string, string>) => {
        calls.push({ name, props: { ...props } });
      },
    });
    vi.spyOn(Math, "random").mockReturnValue(SEED / 2 ** 53);
    const expected = decodeTrace(
      createTraceContext(3),
      drawPuzzle(3, LEVEL_P[3], () => SEED).error,
    );
    const completed = () =>
      calls.filter((c) => c.name === "challenge_completed");

    render(
      <StrictMode>
        <App createWorker={fakeWorkerFactory().create} />
      </StrictMode>,
    );
    const panel = document.querySelector(".panel--challenge")!;
    // Everything that re-renders the app (and the panel) after a verdict.
    const reRenderEverything = async (hash: string, d: string) => {
      await act(async () => {
        await i18n.changeLanguage("es");
      });
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      act(() => {
        window.location.hash = hash;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      const distance = screen.getByRole("group", {
        name: i18n.t("grid.distance"),
      });
      fireEvent.click(within(distance).getByRole("radio", { name: d }));
      expect(
        (within(distance).getByRole("radio", { name: d }) as HTMLInputElement)
          .checked,
      ).toBe(true);
    };

    // A game really played and submitted.
    fireEvent.click(button("challenge.start"));
    for (let q = 0; q < 9; q++) {
      const el = panel.querySelector(`[data-qubit="${q}"]`)!;
      if (expected.correction.x[q] === 1) click(el);
      if (expected.correction.z[q] === 1) click(el, true);
    }
    fireEvent.click(button("challenge.submit"));
    expect(panel.getAttribute("data-phase")).toBe("submitted");
    expect(completed()).toEqual([
      { name: "challenge_completed", props: { d: "3", result: "optimal" } },
    ]);
    await reRenderEverything("#panel-chart", "5");
    expect(panel.getAttribute("data-phase")).toBe("submitted");
    expect(completed()).toHaveLength(1);

    // The next game (at the new distance), given up.
    fireEvent.click(button("challenge.next"));
    fireEvent.click(button("challenge.giveUp"));
    expect(completed()).toEqual([
      { name: "challenge_completed", props: { d: "3", result: "optimal" } },
      { name: "challenge_completed", props: { d: "5", result: "wrong" } },
    ]);
    await reRenderEverything("#panel-grid", "3");
    expect(panel.getAttribute("data-phase")).toBe("submitted");
    expect(completed()).toHaveLength(2);
  });
});
