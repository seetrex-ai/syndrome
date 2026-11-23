// The SEEQuant mark (tasks/plans/design.md D7): a d = 3 rotated-surface-code
// lattice drawn in SVG (two Z plaquettes, two X ones and nine qubits as holes,
// painted with the tokens by index.css). It is the brand's mark, so since
// 2026-10-20 it sits in the brand bar (SiteHeader.tsx) next to "SEEQuant",
// as in the brand site's (seequant.app) header, which copied it from
// here; the favicon is the same drawing (tests/intent/design-conventions).
// Decorative: the wordmark beside it names the link.

const QUBITS = [4, 14, 24];

export function BrandMark() {
  return (
    <svg
      className="brand__mark"
      viewBox="0 0 28 28"
      width="32"
      height="32"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        className="brand__plaquette brand__plaquette--z"
        x="4"
        y="4"
        width="10"
        height="10"
        rx="1.5"
      />
      <rect
        className="brand__plaquette brand__plaquette--x"
        x="14"
        y="4"
        width="10"
        height="10"
        rx="1.5"
      />
      <rect
        className="brand__plaquette brand__plaquette--x"
        x="4"
        y="14"
        width="10"
        height="10"
        rx="1.5"
      />
      <rect
        className="brand__plaquette brand__plaquette--z"
        x="14"
        y="14"
        width="10"
        height="10"
        rx="1.5"
      />
      {QUBITS.flatMap((y) =>
        QUBITS.map((x) => (
          <circle
            key={`${x}-${y}`}
            className="brand__qubit"
            cx={x}
            cy={y}
            r="2.4"
          />
        )),
      )}
    </svg>
  );
}
