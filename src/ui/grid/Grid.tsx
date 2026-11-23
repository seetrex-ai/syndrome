import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { rotatedSurfaceCode } from "../../core";
import { useLongPress } from "../model/gesture";
import { ALL_LAYERS, type Layer, type ShotTrace } from "../model/trace";
import { ChainLayer } from "./ChainLayer";
import { PAULI_NAMES, pauliName, viewBox, type PauliName } from "./geometry";
import { Plaquette } from "./Plaquette";
import { Qubit } from "./Qubit";
import "./grid.css";

export interface GridProps {
  readonly trace: ShotTrace;
  /** Which of the trace's layers to draw; all by default. */
  readonly layers?: ReadonlySet<Layer>;
  /** Both absent ⇒ read-only grid (no buttons, no gestures). */
  readonly onToggleX?: (q: number) => void;
  readonly onToggleZ?: (q: number) => void;
  /** Accessible name of the grid; `grid.title` by default. A page with two grids
   *  (the interactive one and the step-by-step replay) names them apart. */
  readonly label?: string;
}

const NONE: PauliName = PAULI_NAMES[0]!;

function nameOrHidden(
  show: boolean,
  x: ArrayLike<number>,
  z: ArrayLike<number>,
  q: number,
): PauliName {
  return show ? pauliName(x[q]!, z[q]!) : NONE;
}

const preventDefault = (event: { preventDefault(): void }) =>
  event.preventDefault();

export function Grid({
  trace,
  layers = ALL_LAYERS,
  onToggleX,
  onToggleZ,
  label,
}: GridProps) {
  const { t } = useTranslation();
  const d = trace.d;
  const code = useMemo(() => rotatedSurfaceCode(d), [d]);
  const interactive = onToggleX !== undefined || onToggleZ !== undefined;

  const onShort = useCallback(
    (q: number, shift: boolean) => (shift ? onToggleZ?.(q) : onToggleX?.(q)),
    [onToggleX, onToggleZ],
  );
  const onLong = useCallback((q: number) => onToggleZ?.(q), [onToggleZ]);
  // resetKey: a press pending when d changes must not fire into the new grid.
  const handlersFor = useLongPress({ onShort, onLong, resetKey: d });

  const showErrors = layers.has("errors");
  const showDefects = layers.has("defects");
  const showCorrection = layers.has("correction");
  const showResidual = layers.has("residual");

  return (
    <svg
      className="grid"
      viewBox={viewBox(d)}
      data-distance={d}
      role="group"
      aria-label={label ?? t("grid.title")}
      // Scrolling over the grid must keep working on a phone: never `none`
      // (tasks/plans/ui.md D2, tests/intent/ui-conventions.test.ts).
      style={{ touchAction: "pan-x pan-y pinch-zoom" }}
      onContextMenu={preventDefault}
    >
      {/* Keyed by d: a plaquette of the new code must not inherit a node (and
          its fill transition) from a plaquette of the old one with the same
          index but another type. */}
      <g className="plaquettes" key={d}>
        {code.stabilizers.map((s) => (
          <Plaquette
            key={s.index}
            stabilizer={s}
            defect={showDefects && trace.syndromes[s.type][s.typeIndex] === 1}
          />
        ))}
      </g>
      <ChainLayer
        code={code}
        chains={trace.chains}
        showMatching={layers.has("matching")}
        showCorrection={showCorrection}
      />
      <g className="qubits">
        {code.qubits.map(({ index: q }) => (
          <Qubit
            key={q}
            d={d}
            q={q}
            error={
              showErrors
                ? pauliName(trace.error.x[q]!, trace.error.z[q]!)
                : null
            }
            correction={nameOrHidden(
              showCorrection,
              trace.correction.x,
              trace.correction.z,
              q,
            )}
            residual={nameOrHidden(
              showResidual,
              trace.residual.x,
              trace.residual.z,
              q,
            )}
            handlers={interactive ? handlersFor(q) : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
