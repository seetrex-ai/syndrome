// Progressive disclosure of an existing paragraph (tasks/plans/design.md D8):
// the text is clamped to `lines` lines by CSS (controls.css) and a toggle
// unfolds it. The toggle exists only when the text overflows its clamp
// (measured, and again on resize); the text itself is always in the DOM and
// never changes. The toggle's name is the only new string of the redesign
// (`a11y.showMore` / `a11y.showLess`, aria only).
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import "./controls.css";

export interface ClampProps {
  readonly className?: string;
  readonly lines?: 2 | 3;
  readonly children: ReactNode;
  /** `data-*` attributes passed through to the wrapper (hooks of tests and scripts). */
  readonly [data: `data-${string}`]: string | number | boolean | undefined;
}

export function Clamp({ className, lines = 2, children, ...data }: ClampProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const id = useId();

  // Measured while clamped only: unfolded, the text never overflows, and the
  // toggle must stay to fold it back.
  useLayoutEffect(() => {
    if (expanded) return undefined;
    const el = textRef.current;
    if (el === null) return undefined;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [expanded, children, lines]);

  return (
    <div
      className={className === undefined ? "clamp" : `clamp ${className}`}
      data-clamped={expanded ? 0 : 1}
      {...data}
    >
      <p
        id={id}
        ref={textRef}
        className="clamp__text"
        style={{ "--lines": lines } as CSSProperties}
      >
        {children}
      </p>
      {/* Always in the DOM (the video camera and the tests address it), hidden
          while nothing overflows: a hidden button is out of the tab order. */}
      <button
        type="button"
        className="clamp__toggle"
        hidden={!(overflows || expanded)}
        aria-expanded={expanded}
        aria-controls={id}
        aria-label={t(expanded ? "a11y.showLess" : "a11y.showMore")}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="chevron" aria-hidden="true" />
      </button>
    </div>
  );
}
