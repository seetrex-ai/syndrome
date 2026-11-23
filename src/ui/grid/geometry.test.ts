import { describe, expect, it } from "vitest";
import { BOUNDARY, qubitIndex, rotatedSurfaceCode } from "../../core";
import {
  chainPoints,
  pauliName,
  plaquettePath,
  plaquettePoint,
  pointsAttribute,
  qubitPoint,
  UNIT,
  viewBox,
} from "./geometry";

const code = rotatedSurfaceCode(3);

function stabilizerAt(row: number, col: number) {
  const s = code.stabilizers.find((x) => x.row === row && x.col === col);
  if (s === undefined) throw new Error(`no plaquette at (${row}, ${col})`);
  return s;
}

describe("geometry", () => {
  it("maps qubit (r, c) to (c, r) and plaquette (i, j) to (j + ½, i + ½), scaled", () => {
    expect(qubitPoint(3, qubitIndex(3, 2, 1))).toEqual([UNIT, 2 * UNIT]);
    expect(plaquettePoint(stabilizerAt(0, 1))).toEqual([
      1.5 * UNIT,
      0.5 * UNIT,
    ]);
    expect(plaquettePoint(stabilizerAt(-1, 0))).toEqual([
      0.5 * UNIT,
      -0.5 * UNIT,
    ]);
  });

  it("names the Pauli from its components", () => {
    expect(pauliName(0, 0)).toBe("I");
    expect(pauliName(1, 0)).toBe("X");
    expect(pauliName(0, 1)).toBe("Z");
    expect(pauliName(1, 1)).toBe("Y");
  });

  it("the viewBox leaves one unit of margin on every side", () => {
    expect(viewBox(3)).toBe(`${-UNIT} ${-UNIT} ${4 * UNIT} ${4 * UNIT}`);
    expect(viewBox(9)).toBe(`${-UNIT} ${-UNIT} ${10 * UNIT} ${10 * UNIT}`);
  });

  it("draws interior plaquettes as unit squares and boundary ones as half discs that bulge outwards", () => {
    expect(plaquettePath(stabilizerAt(0, 0))).toBe(
      `M0,0h${UNIT}v${UNIT}h${-UNIT}Z`,
    );
    const r = UNIT / 2;
    // Top: from (0,0) to (UNIT,0) clockwise on screen, i.e. through y < 0.
    expect(plaquettePath(stabilizerAt(-1, 0))).toBe(
      `M0,0A${r},${r} 0 0 1 ${UNIT},0Z`,
    );
    // Bottom (row 2 on d = 3): from (UNIT, 2U) to (2U, 2U) counter-clockwise, through y > 2U.
    expect(plaquettePath(stabilizerAt(2, 1))).toBe(
      `M${UNIT},${2 * UNIT}A${r},${r} 0 0 0 ${2 * UNIT},${2 * UNIT}Z`,
    );
    // Left (col −1, row 1): from (0, U) to (0, 2U) counter-clockwise, through x < 0.
    expect(plaquettePath(stabilizerAt(1, -1))).toBe(
      `M0,${UNIT}A${r},${r} 0 0 0 0,${2 * UNIT}Z`,
    );
    // Right (col 2, row 0): from (2U, 0) to (2U, U) clockwise, through x > 2U.
    expect(plaquettePath(stabilizerAt(0, 2))).toBe(
      `M${2 * UNIT},0A${r},${r} 0 0 1 ${2 * UNIT},${UNIT}Z`,
    );
  });

  it("a chain between two defects runs centre → qubits → centre", () => {
    const a = stabilizerAt(0, 0);
    const b = stabilizerAt(1, 1);
    const q = qubitIndex(3, 1, 1);
    const points = chainPoints(code, "Z", {
      a: a.typeIndex,
      b: b.typeIndex,
      qubits: [q],
    });
    expect(points).toEqual([
      plaquettePoint(a),
      qubitPoint(3, q),
      plaquettePoint(b),
    ]);
  });

  it("a chain to the boundary continues half a unit past its last qubit", () => {
    const a = stabilizerAt(0, 0); // centre (0.5, 0.5)
    const q = qubitIndex(3, 0, 1); // (1, 0): top edge
    const points = chainPoints(code, "Z", {
      a: a.typeIndex,
      b: BOUNDARY,
      qubits: [q],
    });
    expect(points).toHaveLength(3);
    expect(points[1]).toEqual([UNIT, 0]);
    const [ex, ey] = points[2]!;
    // Direction (0.5, −0.5) normalised, times ½ unit: up and to the right, off the board.
    expect(ex).toBeGreaterThan(UNIT);
    expect(ey).toBeLessThan(0);
    expect(Math.hypot(ex - UNIT, ey)).toBeCloseTo(UNIT / 2);
  });

  it("formats points for the polyline attribute", () => {
    expect(
      pointsAttribute([
        [0, 1],
        [2.5, 3],
      ]),
    ).toBe("0,1 2.5,3");
  });
});
