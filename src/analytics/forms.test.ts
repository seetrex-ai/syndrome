import { describe, expect, it } from "vitest";
import { CANONICAL_ORIGIN } from "../../edge/paths";
import { SUPPORTED_LANGUAGES } from "../locales";
import {
  FORMS_ORIGIN,
  FORM_FALLBACK_EMAIL,
  FORM_PATHS,
  formHref,
  formPathProblem,
  type FormKind,
} from "./forms";

// Form paths injected by parameter (the module's FORM_PATHS stays untouched).
const PATHS = {
  interest: { es: "/es/interes/", en: "/en/interest/" },
  feedback: { es: "/es/opinion/", en: "/en/feedback/" },
} as const;

// The pure half of T-I6 (tasks/plans/analytics.md D6); the DOM half, over the
// rendered footer and challenge result, is tests/intent/analytics-links.
describe("formHref", () => {
  it("the forms origin is the canonical brand origin of edge/paths.ts", () => {
    expect(FORMS_ORIGIN).toBe(CANONICAL_ORIGIN);
  });

  it("with no published page: mailto info@seequant.app with the encoded subject", () => {
    const unpublished = {
      interest: { es: null, en: null },
      feedback: { es: null, en: null },
    };
    expect(FORM_FALLBACK_EMAIL).toBe("info@seequant.app");
    expect(
      formHref(
        "interest",
        "es",
        { role: "other", from: "syndrome_footer" },
        "Interés en Syndrome",
        unpublished,
      ),
    ).toBe("mailto:info@seequant.app?subject=Inter%C3%A9s%20en%20Syndrome");
    expect(
      formHref(
        "feedback",
        "en",
        { from: "challenge_result" },
        "Syndrome feedback & more",
        unpublished,
      ),
    ).toBe("mailto:info@seequant.app?subject=Syndrome%20feedback%20%26%20more");
  });

  it("with a page: absolute URL on the brand origin with role, lang and from in that order", () => {
    expect(
      formHref(
        "interest",
        "es",
        { role: "other", from: "syndrome_footer" },
        "x",
        PATHS,
      ),
    ).toBe(
      "https://seequant.app/es/interes/?role=other&lang=es&from=syndrome_footer",
    );
    expect(
      formHref(
        "interest",
        "en",
        { role: "other", from: "challenge_result" },
        "x",
        PATHS,
      ),
    ).toBe(
      "https://seequant.app/en/interest/?role=other&lang=en&from=challenge_result",
    );
  });

  it("the feedback page gets no role", () => {
    expect(
      formHref("feedback", "es", { from: "syndrome_footer" }, "x", PATHS),
    ).toBe("https://seequant.app/es/opinion/?lang=es&from=syndrome_footer");
    expect(() =>
      formHref(
        "feedback",
        "es",
        { role: "other", from: "syndrome_footer" },
        "x",
        PATHS,
      ),
    ).toThrow(/no role/);
    expect(() =>
      formHref("interest", "es", { from: "syndrome_footer" }, "x", PATHS),
    ).toThrow(/needs a role/);
  });

  it("a page of the other language, a relative or malformed path, or one under /syndrome/ throws", () => {
    const bad = (path: string) => ({
      interest: { es: path, en: path },
      feedback: { es: null, en: null },
    });
    for (const path of [
      "/en/interest/",
      "es/interes/",
      "/es/interes",
      "/syndrome/interes/",
      "/syndrome/es/interes/",
      "https://seequant.app/es/interes/",
      "/es/Interes/",
      "/es/inte res/",
      "/es/a/b/",
    ]) {
      expect(
        () =>
          formHref(
            "interest",
            "es",
            { role: "other", from: "syndrome_footer" },
            "x",
            bad(path),
          ),
        path,
      ).toThrow(/formHref/);
    }
  });

  it("FORM_PATHS of the tree: every path is null or /<lang>/<slug>/ in its own language", () => {
    for (const kind of Object.keys(FORM_PATHS) as FormKind[]) {
      for (const lang of SUPPORTED_LANGUAGES) {
        const path = FORM_PATHS[kind][lang];
        if (path !== null) expect(formPathProblem(path, lang), path).toBeNull();
      }
    }
  });
});
