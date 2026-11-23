// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { Footer } from "./Footer";

afterEach(cleanup);

describe("Footer", () => {
  it("keeps the tools/video hook class and the byline, and names its links", () => {
    const { container } = render(<Footer />);
    const footer = container.querySelector("footer.app__footer");
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain(i18n.t("app.byline"));
    const nav = screen.getByRole("navigation", {
      name: i18n.t("footer.links"),
    });
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      i18n.t("footer.feedback"),
      i18n.t("footer.interest"),
    ]);
  });
});
