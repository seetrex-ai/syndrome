import { useTranslation } from "react-i18next";
import { qubitRowCol } from "../../core";
import type { QubitHandlers } from "../model/gesture";
import { qubitPoint, type PauliName } from "./geometry";

const RADIUS = 9;
// The pointer target: 2·HIT_RADIUS = 32 viewBox units, 26.2 CSS px at d = 9 on a
// 360 px screen, where the grid is 328 px wide after the 16 px gutters
// (measured; WCAG 2.5.8 asks ≥ 24; the halo alone measured 23).
// Qubits sit UNIT = 40 apart, so neighbouring targets never overlap.
const HIT_RADIUS = 16;

export interface QubitProps {
  readonly d: number;
  readonly q: number;
  /**
   * Error on this qubit, or null when the errors layer is hidden: nothing is
   * drawn and the accessible name claims nothing about it (the error exists
   * even when it is not shown, so "no error" would be false).
   */
  readonly error: PauliName | null;
  /** Correction on this qubit, or "I" when the correction layer is hidden. */
  readonly correction: PauliName;
  /** Residual (error · correction) on this qubit, or "I" when hidden. */
  readonly residual: PauliName;
  /** Absent in a read-only grid (step-by-step mode). */
  readonly handlers?: QubitHandlers;
}

export function Qubit({
  d,
  q,
  error,
  correction,
  residual,
  handlers,
}: QubitProps) {
  const { t } = useTranslation();
  const [row, col] = qubitRowCol(d, q);
  const [x, y] = qubitPoint(d, q);
  const interactive = handlers !== undefined;
  // An accessible name needs a role to hang on: a button when the qubit can be
  // pressed, an image when the grid is read-only (a role-less <g> is generic,
  // and `aria-label` is not allowed on a generic element).
  const name =
    error === null
      ? t("grid.qubitHidden", { row, col })
      : error === "I"
        ? t("grid.qubitNoError", { row, col })
        : t("grid.qubit", { row, col, pauli: error });
  const drawn: PauliName = error ?? "I";
  return (
    <g
      className="qubit"
      transform={`translate(${x} ${y})`}
      data-qubit={q}
      data-pauli={drawn}
      data-correction={correction}
      data-residual={residual}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={name}
      {...handlers}
    >
      <circle className="qubit__hit" r={HIT_RADIUS} />
      <circle className="qubit__halo" r={RADIUS + 5} />
      {/* Keyboard focus ring (grid.css .qubit:focus-visible .qubit__focus):
          outside the residual ring on the halo (r 14, 3 wide), so focusing a
          qubit never covers its residual; 17 + 1.5 stays short of UNIT / 2. */}
      <circle className="qubit__focus" r={RADIUS + 8} />
      <circle className="qubit__disc" r={RADIUS} />
      {drawn !== "I" && (
        <text className="qubit__label" textAnchor="middle" dy="0.35em">
          {drawn}
        </text>
      )}
    </g>
  );
}
