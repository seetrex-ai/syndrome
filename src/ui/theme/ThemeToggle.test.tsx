// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ModelSelect } from "../controls/ModelSelect";
import { ThemeToggle } from "./ThemeToggle";
import { THEME_STORAGE_KEY } from "./theme";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

// The control is a fieldset named `theme.label` with one native radio per
// option (design.md D4); the tests read it as a user would: by group name,
// by option name, and by which option is checked.
const group = (): HTMLFieldSetElement =>
  screen.getByRole("group", { name: i18n.t("theme.label") });

const radios = (): HTMLInputElement[] =>
  [...group().querySelectorAll("input[type=radio]")] as HTMLInputElement[];

const options = (): [value: string, label: string | null][] =>
  radios().map((radio) => [
    radio.value,
    group().querySelector(`label[for="${radio.id}"]`)?.textContent ?? null,
  ]);

const values = (): string[] => radios().map((radio) => radio.value);

const current = (): string | undefined =>
  radios().find((radio) => radio.checked)?.value;

const choose = (value: string): void => {
  const radio = radios().find((r) => r.value === value);
  if (radio === undefined) throw new Error(`no option ${value}`);
  fireEvent.click(radio);
};

describe("ThemeToggle", () => {
  it("offers auto, light and dark by their i18n names and starts on auto", () => {
    render(<ThemeToggle />);
    expect(options()).toEqual([
      ["auto", i18n.t("theme.auto")],
      ["light", i18n.t("theme.light")],
      ["dark", i18n.t("theme.dark")],
    ]);
    expect(current()).toBe("auto");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("each icon segment carries its option's name as a tooltip (the phone shows the icon alone)", () => {
    render(<ThemeToggle />);
    const titles = radios().map((radio) =>
      group().querySelector(`label[for="${radio.id}"]`)?.getAttribute("title"),
    );
    expect(titles).toEqual([
      i18n.t("theme.auto"),
      i18n.t("theme.light"),
      i18n.t("theme.dark"),
    ]);
  });

  it("a segmented control without icons carries no tooltip (its text is always visible)", () => {
    const { container } = render(
      <ModelSelect value="independent" onChange={() => {}} />,
    );
    const labels = [...container.querySelectorAll("label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label.hasAttribute("title")).toBe(false);
  });

  it("every option is a radio reachable by its accessible name, and the fieldset carries data-theme-select", () => {
    render(<ThemeToggle />);
    for (const option of ["auto", "light", "dark"]) {
      const radio = screen.getByRole("radio", {
        name: i18n.t(`theme.${option}`),
      }) as HTMLInputElement;
      expect(radio.value).toBe(option);
    }
    expect(group().hasAttribute("data-theme-select")).toBe(true);
  });

  it("applies the choice to <html data-theme> and persists it under syndrome.theme", () => {
    render(<ThemeToggle />);
    choose("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(current()).toBe("dark");
    choose("auto");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("starts from the stored choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeToggle />);
    expect(current()).toBe("light");
  });

  it("applies the stored choice to <html data-theme> on mount, without the inline script", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(current()).toBe("dark");
  });

  it("offers no dark option where light-dark() is unsupported (Safari < 17.5), all three where it is or where CSS.supports is missing", () => {
    const supports = vi.fn(
      (property: string, value: string) =>
        !(property === "color" && value.startsWith("light-dark(")),
    );
    vi.stubGlobal("CSS", { supports });
    try {
      render(<ThemeToggle />);
      expect(values()).toEqual(["auto", "light"]);
      expect(supports).toHaveBeenCalledWith("color", "light-dark(#000, #fff)");
      cleanup();
      supports.mockImplementation(() => true);
      render(<ThemeToggle />);
      expect(values()).toEqual(["auto", "light", "dark"]);
      cleanup();
      vi.stubGlobal("CSS", undefined);
      render(<ThemeToggle />);
      expect(values()).toEqual(["auto", "light", "dark"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("without light-dark(), a stored dark shows and applies as auto, and the metas say light", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const metas = ["light", "dark"].map((scheme) => {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      meta.setAttribute("data-scheme", scheme);
      meta.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
      document.head.append(meta);
      return meta;
    });
    vi.stubGlobal("CSS", {
      supports: (property: string, value: string) =>
        !(property === "color" && value.startsWith("light-dark(")),
    });
    try {
      render(<ThemeToggle />);
      expect(current()).toBe("auto");
      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
      expect(metas[0]!.getAttribute("media")).toBe("all");
      expect(metas[1]!.getAttribute("media")).toBe("not all");
      // Choosing light there keeps the metas on light and marks the page.
      choose("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      expect(metas[0]!.getAttribute("media")).toBe("all");
      expect(metas[1]!.getAttribute("media")).toBe("not all");
    } finally {
      vi.unstubAllGlobals();
      for (const meta of metas) meta.remove();
    }
  });

  it("drives the theme-color metas of the document", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("data-scheme", "dark");
    meta.setAttribute("media", "(prefers-color-scheme: dark)");
    document.head.append(meta);
    try {
      render(<ThemeToggle />);
      choose("light");
      expect(meta.getAttribute("media")).toBe("not all");
      choose("dark");
      expect(meta.getAttribute("media")).toBe("all");
      choose("auto");
      expect(meta.getAttribute("media")).toBe("(prefers-color-scheme: dark)");
    } finally {
      meta.remove();
    }
  });
});
