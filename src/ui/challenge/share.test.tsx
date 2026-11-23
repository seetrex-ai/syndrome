// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Grid } from "../grid/Grid";
import { createTraceContext, decodeTrace } from "../model/trace";
import { decodePuzzle } from "./puzzle";
import {
  BG,
  rgb,
  stubPaintedBody,
} from "../../../tests/helpers/light-dark-stub";
import {
  gridToPngBlob,
  pageBackground,
  puzzleUrl,
  serializeGridSvg,
  shareOrDownload,
} from "./share";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

const puzzle = decodePuzzle("i3.gAA")!;

function renderGrid(): SVGSVGElement {
  const trace = decodeTrace(createTraceContext(3), puzzle.error);
  render(<Grid trace={trace} />);
  const svg = document.querySelector("svg.grid");
  if (svg === null) throw new Error("no grid");
  return svg as SVGSVGElement;
}

describe("puzzleUrl", () => {
  it("is the base plus `/#c=` and the encoded puzzle, whatever the trailing slash", () => {
    // The app lives at seequant.app/syndrome/ (docs/decisiones.md 2026-10-19).
    expect(puzzleUrl("https://seequant.app/syndrome", puzzle)).toBe(
      "https://seequant.app/syndrome/#c=i3.gAA",
    );
    expect(puzzleUrl("https://seequant.app/syndrome/", puzzle)).toBe(
      "https://seequant.app/syndrome/#c=i3.gAA",
    );
    expect(puzzleUrl("http://localhost:5173/sub/", puzzle)).toBe(
      "http://localhost:5173/sub/#c=i3.gAA",
    );
  });

  it("drops a trailing index.html and keeps the directory", () => {
    expect(puzzleUrl("https://seequant.app/syndrome/index.html", puzzle)).toBe(
      "https://seequant.app/syndrome/#c=i3.gAA",
    );
    expect(puzzleUrl("http://localhost:5173/sub/index.html", puzzle)).toBe(
      "http://localhost:5173/sub/#c=i3.gAA",
    );
    expect(puzzleUrl("http://localhost:5173/sub", puzzle)).toBe(
      "http://localhost:5173/sub/#c=i3.gAA",
    );
  });
});

describe("gridToPngBlob", () => {
  function stubCanvas(blob: Blob | null) {
    vi.stubGlobal(
      "Image",
      class {
        width = 480;
        height = 480;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: () => {},
      drawImage: () => {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => callback(blob),
    );
    return revoke;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("resolves with the PNG the canvas produced and revokes the intermediate SVG URL", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const revoke = stubCanvas(png);
    await expect(gridToPngBlob(renderGrid(), "#ffffff")).resolves.toBe(png);
    expect(revoke).toHaveBeenCalledWith("blob:fake");
  });

  it("rejects when toBlob yields null instead of hanging or resolving an empty image, and still revokes the URL", async () => {
    const revoke = stubCanvas(null);
    await expect(gridToPngBlob(renderGrid(), "#ffffff")).rejects.toThrow(
      /toBlob/,
    );
    expect(revoke).toHaveBeenCalledWith("blob:fake");
  });
});

describe("serializeGridSvg", () => {
  it("produces a standalone SVG document: namespace, size, background, d² qubits, no class, inlined styles", () => {
    const svg = renderGrid();
    const text = serializeGridSvg(svg, "#ffffff");
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    expect(root.tagName).toBe("svg");
    expect(root.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(text.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(
      true,
    );
    expect(root.querySelector("title")).toBeNull();
    expect(root.getAttribute("viewBox")).toBe(svg.getAttribute("viewBox"));
    expect(Number(root.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(root.getAttribute("height"))).toBeGreaterThan(0);
    // The first painted element is the background.
    const first = root.firstElementChild!;
    expect(first.tagName).toBe("rect");
    expect(first.getAttribute("fill")).toBe("#ffffff");
    expect(root.querySelectorAll("[data-qubit]")).toHaveLength(9);
    expect(root.querySelectorAll("[data-plaquette]")).toHaveLength(8);
    // No element depends on a stylesheet any more: no class attribute left,
    // and every element that is painted carries its own style.
    expect(root.querySelectorAll("[class]")).toHaveLength(0);
    for (const el of root.querySelectorAll(
      "path, circle, line, polyline, text",
    )) {
      expect(el.getAttribute("style"), el.outerHTML).not.toBeNull();
    }
    // The live grid is untouched.
    expect(svg.querySelectorAll("[class]").length).toBeGreaterThan(0);
    expect(svg.querySelector("rect")).toBeNull();
  });

  it("copies the computed fill and stroke of each element (what the browser painted)", () => {
    const svg = renderGrid();
    // jsdom computes no cascade from <style>; the inline fallback it does see.
    const disc = svg.querySelector<SVGElement>(
      "[data-qubit='4'] .qubit__disc",
    )!;
    disc.style.fill = "rgb(1, 2, 3)";
    disc.style.stroke = "rgb(4, 5, 6)";
    const text = serializeGridSvg(svg, "#ffffff");
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    // The disc is the fourth circle: hit, halo, focus ring, disc (Qubit.tsx).
    const copy = doc.querySelector<SVGElement>(
      "[data-qubit='4'] circle:nth-of-type(4)",
    )!;
    expect(copy.style.fill).toBe("rgb(1, 2, 3)");
    expect(copy.style.stroke).toBe("rgb(4, 5, 6)");
  });
});

describe("shareOrDownload", () => {
  it("uses navigator.share with the file when the browser can share files", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    Object.assign(navigator, { share, canShare });
    try {
      await expect(shareOrDownload(blob, "syndrome-d3.png")).resolves.toBe(
        true,
      );
      expect(canShare).toHaveBeenCalledTimes(1);
      expect(share).toHaveBeenCalledTimes(1);
      const files = (share.mock.calls[0]![0] as { files: File[] }).files;
      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe("syndrome-d3.png");
      expect(files[0]!.type).toBe("image/png");
    } finally {
      delete (navigator as { share?: unknown }).share;
      delete (navigator as { canShare?: unknown }).canShare;
    }
  });

  it("a cancelled share sheet (AbortError) is not a failure and downloads nothing; any other rejection falls back to the download", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const share = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("cancelled", "AbortError"))
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
      .mockRejectedValueOnce(new TypeError("files not shareable"));
    Object.assign(navigator, { share, canShare: () => true });
    try {
      // The result tells a cancelled sheet (false) from a completed share or
      // download (true): only the latter is reported (analytics.md D14).
      await expect(shareOrDownload(blob, "a.png")).resolves.toBe(false);
      expect(clicked).toHaveLength(0);
      await expect(shareOrDownload(blob, "b.png")).resolves.toBe(true);
      expect(clicked.map((a) => a.download)).toEqual(["b.png"]);
      await expect(shareOrDownload(blob, "c.png")).resolves.toBe(true);
      expect(clicked.map((a) => a.download)).toEqual(["b.png", "c.png"]);
      expect(share).toHaveBeenCalledTimes(3);
    } finally {
      delete (navigator as { share?: unknown }).share;
      delete (navigator as { canShare?: unknown }).canShare;
    }
  });

  it("falls back to a download link with the given name", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const clicked: HTMLAnchorElement[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this);
      });
    const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    await expect(shareOrDownload(blob, "syndrome-d7.png")).resolves.toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked[0]!.download).toBe("syndrome-d7.png");
    expect(clicked[0]!.href).toBe("blob:fake");
    expect(url).toHaveBeenCalledWith(blob);
    expect(revoke).toHaveBeenCalledWith("blob:fake");
    // Nothing left in the document.
    expect(document.querySelector("a[download]")).toBeNull();
  });
});

describe("pageBackground", () => {
  it("is white only when nothing painted the page (jsdom without the stylesheet)", () => {
    expect(pageBackground()).toBe("#ffffff");
  });

  it.each([
    ["dark", false, BG.dark],
    ["light", true, BG.light],
    ["dark", true, BG.dark],
    ["light", false, BG.light],
  ])(
    "follows <html data-theme=%s> over the OS (dark OS: %s): the painted --bg %s",
    (forced, osDark, expected) => {
      stubPaintedBody(osDark);
      document.documentElement.setAttribute("data-theme", forced);
      expect(pageBackground()).toBe(rgb(expected));
    },
  );

  it.each([
    [true, BG.dark],
    [false, BG.light],
  ])("with no forced theme follows the OS (dark: %s)", (osDark, expected) => {
    stubPaintedBody(osDark);
    expect(pageBackground()).toBe(rgb(expected));
  });

  it("is the background rect of the serialised SVG: forced dark on a light OS paints the dark --bg", () => {
    stubPaintedBody(false);
    document.documentElement.setAttribute("data-theme", "dark");
    const text = serializeGridSvg(renderGrid(), pageBackground());
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    expect(doc.documentElement.firstElementChild!.getAttribute("fill")).toBe(
      rgb(BG.dark),
    );
  });
});
