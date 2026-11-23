// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRestart,
  IconThemeAuto,
  IconThemeDark,
  IconThemeLight,
} from "./icons";

afterEach(cleanup);

const ICONS = [
  IconPrev,
  IconPlay,
  IconPause,
  IconNext,
  IconRestart,
  IconThemeAuto,
  IconThemeLight,
  IconThemeDark,
];

describe("playback icons", () => {
  it("are decorative, static, 16 px and painted in currentColor; the button keeps its label as accessible name", () => {
    for (const Icon of ICONS) {
      const { container, unmount } = render(
        <button type="button">
          <Icon />
          Label
        </button>,
      );
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.getAttribute("width")).toBe("16");
      expect(svg.getAttribute("height")).toBe("16");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.querySelector("animate, animateTransform, set")).toBeNull();
      expect(svg.querySelector("path")!.getAttribute("d")).toMatch(/^M/);
      expect(screen.getByRole("button", { name: "Label" })).toBeTruthy();
      unmount();
    }
  });
});
