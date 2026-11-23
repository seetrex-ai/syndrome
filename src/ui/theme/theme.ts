// Light / dark / auto theme (tasks/plans/phase2.md D14). The colours themselves
// live in CSS tokens (`light-dark()` in the `:root` blocks of each stylesheet,
// tests/intent/theme-tokens.test.ts); this module only decides which side of
// each token the browser resolves, by setting `color-scheme` through
// `<html data-theme>`. "auto" removes the attribute and leaves the choice to
// `prefers-color-scheme`. The inline script of index.html replays
// `readStoredTheme` + `applyTheme` before the first paint; keep the two in step.

// The three states; the toggle shows t(`theme.${theme}`), never the name
// (tests/intent/i18n-literal-text: TAG_TYPES).
export type Theme = "auto" | "light" | "dark";
export const THEMES: readonly Theme[] = ["auto", "light", "dark"];

export const DEFAULT_THEME: Theme = "auto";
export const THEME_STORAGE_KEY = "syndrome.theme"; // i18n-exempt: localStorage key

export const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

const storageOf = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Access to `localStorage` itself throws in some privacy modes.
    return null;
  }
};

/** The stored choice, or "auto" when there is none, it is invalid or storage throws. */
export function readStoredTheme(storage: Storage | null = storageOf()): Theme {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Persist the choice; "auto" clears it. Storage failures are swallowed: the theme still applies for this visit. */
export function storeTheme(
  theme: Theme,
  storage: Storage | null = storageOf(),
): void {
  try {
    if (theme === DEFAULT_THEME) storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Quota, privacy mode: nothing to do.
  }
}

// Media queries that always / never match (`media` of a theme-color meta).
const MEDIA_ALWAYS = "all"; // i18n-exempt: media query
const MEDIA_NEVER = "not all"; // i18n-exempt: media query

/** A `<meta name="theme-color" data-scheme="light|dark">` of index.html. */
export type ThemeColorMeta = Pick<
  HTMLMetaElement,
  "getAttribute" | "setAttribute"
>;

const themeColorMetas = (): ThemeColorMeta[] =>
  typeof document === "undefined"
    ? []
    : [...document.querySelectorAll('meta[name="theme-color"][data-scheme]')];

/** Does this browser resolve `light-dark()`? A missing `CSS.supports` (jsdom, old engines) counts as yes: the fallback is the exception, not the rule. */
export function supportsLightDark(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return true;
  }
  return CSS.supports("color", "light-dark(#000, #fff)"); // i18n-exempt: CSS feature query
}

/** The themes the select offers: all three, or auto and light where dark cannot be painted. */
export const offeredThemes = (): readonly Theme[] =>
  supportsLightDark() ? THEMES : THEMES.filter((t) => t !== "dark");

/**
 * The theme the page can actually paint: the stored one, or "auto" for a
 * stored "dark" where light-dark() is unsupported (the page is light there
 * whatever is asked; without this, `data-theme="dark"` on a light page
 * with the select showing a theme that was not applied).
 */
export const effectiveTheme = (
  theme: Theme,
  lightDark: boolean = supportsLightDark(),
): Theme => (!lightDark && theme === "dark" ? DEFAULT_THEME : theme);

/**
 * Set `data-theme` on the root element; "auto" removes it (the OS decides).
 * The two `theme-color` metas (browser chrome on phones) follow: on "auto"
 * each one answers to its own `prefers-color-scheme`; a forced theme makes
 * the matching one apply always and the other never.
 * Without light-dark() the page is light whatever the OS says (index.css
 * forces `color-scheme: light`), so the light meta applies always and the
 * dark one never, and "dark" is applied as "auto".
 */
export function applyTheme(
  theme: Theme,
  root: Pick<
    HTMLElement,
    "setAttribute" | "removeAttribute"
  > = document.documentElement,
  metas: Iterable<ThemeColorMeta> = themeColorMetas(),
  lightDark: boolean = supportsLightDark(),
): void {
  const applied = effectiveTheme(theme, lightDark);
  if (applied === DEFAULT_THEME) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", applied);
  for (const meta of metas) {
    const scheme = meta.getAttribute("data-scheme");
    const media = !lightDark
      ? scheme === "light"
        ? MEDIA_ALWAYS
        : MEDIA_NEVER
      : applied === DEFAULT_THEME
        ? `(prefers-color-scheme: ${scheme})` // i18n-exempt: media query
        : scheme === applied
          ? MEDIA_ALWAYS
          : MEDIA_NEVER;
    meta.setAttribute("media", media);
  }
}
