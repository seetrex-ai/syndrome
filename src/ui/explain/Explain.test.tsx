// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { Explain, ExplainGroup } from "./Explain";

afterEach(cleanup);

function button(id: string): HTMLButtonElement {
  return screen.getByRole("button", {
    name: i18n.t(`explain.${id}.title`),
  }) as HTMLButtonElement;
}

function body(el: HTMLButtonElement): HTMLElement {
  const id = el.getAttribute("aria-controls");
  if (id === null) throw new Error("button has no aria-controls");
  const panel = document.getElementById(id);
  if (panel === null) throw new Error(`no element #${id}`);
  return panel;
}

describe("Explain", () => {
  it("renders the title from i18n as the button, collapsed, with aria-expanded and aria-controls", () => {
    render(<Explain id="stabilizer" />);
    const el = button("stabilizer");
    expect(el.getAttribute("aria-expanded")).toBe("false");
    const panel = body(el);
    expect(panel.hidden).toBe(true);
    expect(panel.textContent).toBe(i18n.t("explain.stabilizer.body"));
  });

  it("a click opens the body, a second click closes it", () => {
    render(<Explain id="qubit" />);
    const el = button("qubit");
    fireEvent.click(el);
    expect(el.getAttribute("aria-expanded")).toBe("true");
    expect(body(el).hidden).toBe(false);
    expect(screen.getByText(i18n.t("explain.qubit.body"))).toBeTruthy();
    fireEvent.click(el);
    expect(el.getAttribute("aria-expanded")).toBe("false");
    expect(body(el).hidden).toBe(true);
  });

  it("Escape closes the open body and returns focus to its button", () => {
    render(<Explain id="distance" />);
    const el = button("distance");
    fireEvent.click(el);
    expect(body(el).hidden).toBe(false);
    fireEvent.keyDown(body(el), { key: "Escape" });
    expect(el.getAttribute("aria-expanded")).toBe("false");
    expect(body(el).hidden).toBe(true);
    expect(document.activeElement).toBe(el);
  });

  it("inside a group only one explanation is open at a time", () => {
    render(
      <ExplainGroup>
        <Explain id="qubit" />
        <Explain id="stabilizer" />
        <Explain id="matching" />
      </ExplainGroup>,
    );
    fireEvent.click(button("qubit"));
    expect(button("qubit").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button("matching"));
    expect(button("matching").getAttribute("aria-expanded")).toBe("true");
    expect(button("qubit").getAttribute("aria-expanded")).toBe("false");
    expect(body(button("qubit")).hidden).toBe(true);
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-expanded") === "true"),
    ).toHaveLength(1);
  });

  it("two groups are independent", () => {
    render(
      <>
        <ExplainGroup>
          <Explain id="qubit" />
        </ExplainGroup>
        <ExplainGroup>
          <Explain id="matching" />
        </ExplainGroup>
      </>,
    );
    fireEvent.click(button("qubit"));
    fireEvent.click(button("matching"));
    expect(button("qubit").getAttribute("aria-expanded")).toBe("true");
    expect(button("matching").getAttribute("aria-expanded")).toBe("true");
  });

  it("switches language with i18n", async () => {
    render(<Explain id="yError" />);
    await i18n.changeLanguage("es");
    try {
      const el = button("yError");
      expect(el.textContent).toContain(
        i18n.t("explain.yError.title", { lng: "es" }),
      );
      expect(body(el).textContent).toBe(
        i18n.t("explain.yError.body", { lng: "es" }),
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
