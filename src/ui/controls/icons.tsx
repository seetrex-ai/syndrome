// Decorative icons of the playback buttons (back, play, pause, next, replay)
// shared by the step-by-step and the spacetime viewer. Inline SVG, no
// library: `aria-hidden`, painted in currentColor so they follow the button's
// ink in both themes, static (no animation, T-D8). The button's accessible
// name stays its i18n label. One component per icon and the geometry as
// literal `d` attributes of native <path> elements: the literal-text detector
// treats neither as visible text, so no i18n-exempt hatch is needed.

import type { ReactNode } from "react";

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      className="btn__icon"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconPrev() {
  return (
    <Frame>
      <path d="M10.5 3.5 6 8l4.5 4.5" />
    </Frame>
  );
}

export function IconPlay() {
  return (
    <Frame>
      <path d="M5 3.2v9.6L12.8 8z" fill="currentColor" />
    </Frame>
  );
}

export function IconPause() {
  return (
    <Frame>
      <path d="M5 3.5v9M11 3.5v9" />
    </Frame>
  );
}

export function IconNext() {
  return (
    <Frame>
      <path d="M5.5 3.5 10 8l-4.5 4.5" />
    </Frame>
  );
}

export function IconRestart() {
  return (
    <Frame>
      <path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4M3.2 2.6v2.6h2.6" />
    </Frame>
  );
}

// The three theme options (ThemeToggle), shown instead of their text on a
// phone: the option's label stays in the DOM as its accessible name.

/** Auto (the OS): a circle half filled. */
export function IconThemeAuto() {
  return (
    <Frame>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </Frame>
  );
}

/** Light: a sun. */
export function IconThemeLight() {
  return (
    <Frame>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
    </Frame>
  );
}

/** Dark: a crescent moon. */
export function IconThemeDark() {
  return (
    <Frame>
      <path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.3 4.3 0 0 0 6.6 6.6z" />
    </Frame>
  );
}
