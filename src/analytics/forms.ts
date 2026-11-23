// Links to the interest and feedback forms (tasks/plans/analytics.md D6). The
// forms are pages of the brand site, on the same origin as the app; Syndrome
// has no backend and only links to them, carrying `role`, `lang` and `from` in
// the query. While a page is not published its path stays null and the link
// falls back to an email. Turning a link on is a reviewed four-line commit,
// made only after measuring a 200 on each page, never an environment variable.
import { SUPPORTED_LANGUAGES, type Language } from "../locales";
import type { FormSource, Role } from "./events";

export type FormKind = "interest" | "feedback";

/**
 * The brand origin the form pages live on. A copy of edge/paths.ts
 * CANONICAL_ORIGIN, not an import: no runtime import of src/ may leave src/
 * (tests/intent/video-conventions); forms.test.ts pins the two equal.
 */
export const FORMS_ORIGIN = "https://seequant.app";

/**
 * Path of each form page on the brand site, per language; null = not published
 * yet (mailto fallback). Each path matches `/<lang>/<slug>/` with the same
 * language as its key (checked by formPathProblem and its test).
 */
export const FORM_PATHS: Readonly<
  Record<FormKind, Readonly<Record<Language, string | null>>>
> = {
  interest: { es: "/es/interes/", en: "/en/interest/" },
  feedback: { es: "/es/opinion/", en: "/en/feedback/" },
};

/** Where the links point while the form pages are not published. */
export const FORM_FALLBACK_EMAIL = "info@seequant.app";

/** Query parameters the form pages receive. `role` only on the interest form. */
export interface FormHidden {
  readonly role?: Role;
  readonly from: FormSource;
}

const SLUG = /^[a-z0-9-]+$/;

/** Why `path` may not be a form path for `lang`, or null when it may. */
export function formPathProblem(path: string, lang: Language): string | null {
  const parts = path.split("/");
  // "/es/interes/" splits into ["", "es", "interes", ""].
  if (
    parts.length !== 4 ||
    parts[0] !== "" ||
    parts[3] !== "" ||
    !(SUPPORTED_LANGUAGES as readonly string[]).includes(parts[1] ?? "") ||
    !SLUG.test(parts[2] ?? "")
  ) {
    return `form path "${path}" is not /<lang>/<slug>/`;
  }
  if (parts[1] !== lang) {
    return `form path "${path}" is not in language "${lang}"`;
  }
  return null;
}

/**
 * The href of a form link: the brand-site page as an absolute URL on the
 * canonical origin (a relative one would 404 on a preview or the legacy host)
 * with `role` (interest only), `lang` and `from`, in that order; or, while the
 * path is null, `mailto:` with `subject` (already translated) as the subject.
 * Throws on a malformed path, on `role` given to the feedback form and on an
 * interest link without one.
 */
export function formHref(
  kind: FormKind,
  lang: Language,
  hidden: FormHidden,
  subject: string,
  paths: Readonly<
    Record<FormKind, Readonly<Record<Language, string | null>>>
  > = FORM_PATHS,
): string {
  if (kind === "interest" && hidden.role === undefined) {
    throw new Error("formHref: the interest form needs a role");
  }
  if (kind === "feedback" && hidden.role !== undefined) {
    throw new Error("formHref: the feedback form takes no role");
  }
  const path = paths[kind][lang];
  if (path === null) {
    return `mailto:${FORM_FALLBACK_EMAIL}?subject=${encodeURIComponent(subject)}`;
  }
  const problem = formPathProblem(path, lang);
  if (problem !== null) throw new Error(`formHref: ${problem}`);
  const query = new URLSearchParams();
  if (hidden.role !== undefined) query.set("role", hidden.role);
  query.set("lang", lang);
  query.set("from", hidden.from);
  return `${FORMS_ORIGIN}${path}?${query.toString()}`;
}
