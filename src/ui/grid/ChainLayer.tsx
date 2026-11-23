import type { RotatedSurfaceCode, StabilizerType } from "../../core";
import type { ShotTrace } from "../model/trace";
import { chainPoints, pointsAttribute } from "./geometry";

export interface ChainLayerProps {
  readonly code: RotatedSurfaceCode;
  readonly chains: ShotTrace["chains"];
  /** Straight matching edges between the paired defects. */
  readonly showMatching: boolean;
  /** Correction chains along the lattice. */
  readonly showCorrection: boolean;
}

const TYPES: readonly StabilizerType[] = ["Z", "X"];

export function ChainLayer({
  code,
  chains,
  showMatching,
  showCorrection,
}: ChainLayerProps) {
  if (!showMatching && !showCorrection) return null;
  return (
    <g className="chains">
      {TYPES.map((type) =>
        chains[type].map((chain, i) => {
          const points = chainPoints(code, type, chain);
          const [x1, y1] = points[0]!;
          const [x2, y2] = points[points.length - 1]!;
          return (
            <g key={`${type}-${i}`}>
              {showMatching && (
                <line
                  className={`match match--${type}`}
                  data-match={i}
                  data-type={type}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                />
              )}
              {showCorrection && (
                <polyline
                  className={`chain chain--${type}`}
                  data-chain={i}
                  data-type={type}
                  points={pointsAttribute(points)}
                  pathLength={1}
                />
              )}
            </g>
          );
        }),
      )}
    </g>
  );
}
