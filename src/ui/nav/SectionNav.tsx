import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./nav.css";

// The five sections of the scroll story (tasks/plans/design.md D1), in page
// order: the `id` each `section.panel` carries and its `h2`, by the same key
// (literal calls: tests/intent/i18n-keys checks them statically). The link
// texts ARE the headings (no new strings); tests/intent/design-conventions
// (test_intent_first_screen_carries_the_message) checks each href resolves
// to a section and that the order is the document's.
const SECTIONS: readonly (readonly [
  id: string,
  title: (t: TFunction) => string,
])[] = [
  // i18n-exempt: a section id
  ["panel-chart", (t) => t("chart.title")],
  // i18n-exempt: a section id
  ["panel-grid", (t) => t("grid.title")],
  // i18n-exempt: a section id
  ["panel-steps", (t) => t("steps.title")],
  // i18n-exempt: a section id
  ["panel-spacetime", (t) => t("spacetime.title")],
  // i18n-exempt: a section id
  ["panel-challenge", (t) => t("challenge.title")],
];

// The CSS variable nav.css reads for `scroll-padding-top` (the bar's height,
// so nothing scrolls under it); written on <html> from the measured bar.
// i18n-exempt: a CSS custom property name
const NAV_HEIGHT = "--nav-height";

/**
 * In-page navigation over the five panels: sticky under the viewport's top
 * from 640 px, a scrollable row on a phone (nav.css). `aria-current="true"`
 * marks the section that occupies the viewport (IntersectionObserver; absent
 * in jsdom and then no link is current). Plain anchors: keyboard reachable,
 * 44 px targets, the browser does the scrolling.
 *
 * Two of the sections (the chart, the viewer) are deferred: at mount their
 * ids belong to Suspense skeletons that React replaces by the real panels
 * later, so the observer is rebuilt whenever a child of the sections'
 * container changes (MutationObserver; observed once, the chart and the
 * viewer were never current and the wrong link was).
 * The bar's height goes to `--nav-height` on <html> (ResizeObserver).
 */
export function SectionNav() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.set(entry.target.id, entry.intersectionRatio);
        }
        let best: string | null = null;
        let bestRatio = 0;
        for (const [id] of SECTIONS) {
          const ratio = visible.get(id) ?? 0;
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        }
        setCurrent(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    const observed = new Set<Element>();
    const observeSections = () => {
      for (const [id] of SECTIONS) {
        const section = document.getElementById(id);
        if (section === null || observed.has(section)) continue;
        observed.add(section);
        observer.observe(section);
      }
    };
    observeSections();
    // A replaced section (skeleton → panel) is a new node: observe it too.
    // The stale node is gone from the document; its last ratio is overwritten
    // by the new node's first entry (same id).
    // i18n-exempt: an element name (the sections' container, App's <main>)
    const container = navRef.current?.closest("main") ?? document.body;
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(observeSections);
    mutations?.observe(container, { childList: true });
    return () => {
      mutations?.disconnect();
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (nav === null || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const write = () => {
      // i18n-exempt: a CSS length
      root.style.setProperty(NAV_HEIGHT, `${nav.offsetHeight}px`);
    };
    const resize = new ResizeObserver(write);
    resize.observe(nav);
    write();
    return () => {
      resize.disconnect();
      root.style.removeProperty(NAV_HEIGHT);
    };
  }, []);

  return (
    <nav className="app__nav" ref={navRef} aria-label={t("a11y.sectionNav")}>
      <ul className="app__nav-list">
        {SECTIONS.map(([id, title]) => (
          <li key={id}>
            <a
              className="app__nav-link"
              href={`#${id}`}
              aria-current={current === id ? "true" : undefined}
            >
              {title(t)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
