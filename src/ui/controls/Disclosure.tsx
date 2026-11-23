// A disclosure over a plain button (tasks/plans/design.md D4): replaces the
// native <details>/<summary> of the viewer. `button[aria-expanded]
// [aria-controls]` names the body, which stays in the DOM (hidden when
// closed) like Explain's: scripts and tests that look for its content
// (`[data-layer-summary]`) find it whatever the state. The chevron is CSS
// (controls.css), not text.
import { useId, useState, type ReactNode } from "react";
import "./controls.css";

export interface DisclosureProps {
  /** The toggle's text (an i18n string, the old summary). */
  readonly summary: string;
  readonly className?: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}

export function Disclosure({
  summary,
  className,
  defaultOpen = false,
  children,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div
      className={
        className === undefined ? "disclosure" : `disclosure ${className}`
      }
      data-open={open ? 1 : 0}
    >
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span className="chevron" aria-hidden="true" />
        {summary}
      </button>
      <div id={id} className="disclosure__body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
