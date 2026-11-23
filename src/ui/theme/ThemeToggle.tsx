import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  IconThemeAuto,
  IconThemeDark,
  IconThemeLight,
} from "../controls/icons";
import { SegmentedControl } from "../controls/SegmentedControl";
import {
  applyTheme,
  effectiveTheme,
  isTheme,
  readStoredTheme,
  offeredThemes,
  storeTheme,
  type Theme,
} from "./theme";

// Below 640 px the segments show these icons and keep their text visually
// hidden (controls.css), so the theme fits on the name's row at 320 px (the
// language switch is in the brand bar since 2026-10-20).
const THEME_ICONS: Readonly<Record<Theme, ReactNode>> = {
  auto: <IconThemeAuto />,
  light: <IconThemeLight />,
  dark: <IconThemeDark />,
};

/**
 * Three-state theme control in the header (phase2.md D14): auto (the OS), light,
 * dark. A segmented control (design.md D4) like the other controls of the
 * page, right of the name: a fieldset named `theme.label`, one native radio per option, a 44 px
 * target on a phone. The choice is applied at once and persisted under
 * `syndrome.theme`. The stored choice is applied on mount too: the inline
 * script of index.html only avoids the flash, and a page where it did not run
 * (a strict CSP, a blocked script) must still be the theme the control shows.
 *
 * A browser without `light-dark()` (Safari < 17.5) paints the light tokens of
 * the `@supports not` fallback whatever the scheme, so "dark" there would be a
 * promise the page cannot keep: the option is not offered (index.css
 * also forces `color-scheme: light` for a stored "dark"), and a stored
 * "dark" shows and applies as "auto" (the control must show what is painted).
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() =>
    effectiveTheme(readStoredTheme()),
  );
  const [themes] = useState(offeredThemes);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const change = (next: string) => {
    if (!isTheme(next)) return;
    setTheme(next);
    storeTheme(next);
  };

  return (
    <SegmentedControl
      className="theme"
      legend={t("theme.label")}
      hideLegend
      options={themes.map((option) => ({
        value: option,
        label: t(`theme.${option}`),
        icon: THEME_ICONS[option],
      }))}
      value={theme}
      onChange={change}
      data-theme-select
    />
  );
}
