// In-context explanations (docs/spec.md §4.7, tasks/plans/phase2.md D13): a "?"
// disclosure button that shows a short paragraph from `explain.<id>.body` under
// `explain.<id>.title`. Inside an <ExplainGroup> only one is open at a time;
// Escape closes the open one and returns focus to its button. The body is
// always in the DOM (hidden when collapsed) so `aria-controls` points at a real
// element, and it lays out below the whole row of buttons (explain.css), so
// opening one never moves what sits above the group.

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { ExplainId } from "./ids";
import "./explain.css";

interface ExplainEntry {
  readonly title: string;
  readonly body: string;
}

interface GroupState {
  readonly open: ExplainId | null;
  readonly setOpen: (id: ExplainId | null) => void;
}

const GroupContext = createContext<GroupState | null>(null);

export interface ExplainGroupProps {
  readonly children: ReactNode;
}

/** A row of explanations where at most one is open. */
export function ExplainGroup({ children }: ExplainGroupProps) {
  const [open, setOpen] = useState<ExplainId | null>(null);
  const state = useMemo<GroupState>(() => ({ open, setOpen }), [open]);
  return (
    <GroupContext.Provider value={state}>
      <div className="explain-group">{children}</div>
    </GroupContext.Provider>
  );
}

export interface ExplainProps {
  readonly id: ExplainId;
}

export function Explain({ id }: ExplainProps) {
  const { t } = useTranslation();
  const group = useContext(GroupContext);
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = group === null ? localOpen : group.open === id;
  const setExpanded = useCallback(
    (next: boolean) => {
      if (group === null) setLocalOpen(next);
      else group.setOpen(next ? id : null);
    },
    [group, id],
  );
  const bodyId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // `explain.<id>` is a branch {title, body}: one lookup, both texts
  // (tests/intent/i18n-keys accepts `<branch>.${x}`; explanations.test checks
  // every id has both parts in every language).
  const entry = t(`explain.${id}`, { returnObjects: true }) as ExplainEntry;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && expanded) {
      event.stopPropagation();
      setExpanded(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="explain" data-open={expanded ? 1 : 0} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--chip explain__button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="explain__mark" aria-hidden="true">
          ?
        </span>
        {entry.title}
      </button>
      <p id={bodyId} className="explain__body" hidden={!expanded}>
        {entry.body}
      </p>
    </div>
  );
}
