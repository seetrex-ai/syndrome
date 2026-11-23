// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { App } from "./App";
import { UpdateToast } from "./pwa/UpdateToast";
import { LAST_STEP } from "./steps/step-machine";

// The real component, spied on: the assertion below is that App RENDERS it,
// not that some div carries its attributes.
vi.mock("./pwa/UpdateToast", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./pwa/UpdateToast")>();
  return { ...mod, UpdateToast: vi.fn(mod.UpdateToast) };
});

afterEach(() => {
  cleanup();
  vi.mocked(UpdateToast).mockClear();
});

describe("App", () => {
  it('has exactly one role="status" (the interactive grid\'s verdict): the step-by-step verdict lives in its own live region', () => {
    render(<App />);
    // The step-by-step verdict only exists on the last step: walk there first.
    const next = screen.getByRole("button", { name: i18n.t("steps.next") });
    for (let i = 0; i < LAST_STEP; i++) fireEvent.click(next);
    expect(document.querySelector(".steps__verdict")).not.toBeNull();
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("renders the translated title", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      i18n.t("app.title"),
    );
  });

  it("mounts the service worker notice (UpdateToast) as a closed live region: without it no update is ever offered", () => {
    expect(UpdateToast).not.toHaveBeenCalled();
    render(<App />);
    expect(UpdateToast).toHaveBeenCalled();
    const toast = document.querySelector("[data-pwa-toast]");
    expect(toast).not.toBeNull();
    expect(toast!.getAttribute("aria-live")).toBe("polite");
    expect(toast!.getAttribute("data-open")).toBe("0");
  });
});
