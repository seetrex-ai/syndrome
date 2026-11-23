import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { LOGICAL_X, LOGICAL_Z, type Distance } from "../../core";
import { DistanceSelect } from "../controls/DistanceSelect";
import { NoiseControls } from "../controls/NoiseControls";
import { Explain, ExplainGroup } from "../explain/Explain";
import { useGridState } from "../model/grid-reducer";
import { Grid } from "./Grid";

export interface GridPanelProps {
  readonly d: Distance;
  readonly onDistanceChange: (d: Distance) => void;
  readonly p: number;
  readonly onPChange: (p: number) => void;
}

// createRng accepts seeds in [0, 2^53); Math.random() < 1 keeps the floor below it.
const randomSeed = () => Math.floor(Math.random() * 2 ** 53);

export function GridPanel({
  d,
  onDistanceChange,
  p,
  onPChange,
}: GridPanelProps) {
  const { t } = useTranslation();
  const { trace, dispatch } = useGridState(d);

  const toggleX = useCallback(
    (q: number) => dispatch({ type: "toggleX", q }),
    [dispatch],
  );
  const toggleZ = useCallback(
    (q: number) => dispatch({ type: "toggleZ", q }),
    [dispatch],
  );
  const randomize = useCallback(
    () => dispatch({ type: "randomize", p, seed: randomSeed() }),
    [dispatch, p],
  );
  const clear = useCallback(() => dispatch({ type: "clear" }), [dispatch]);

  const verdict = trace.verdict;
  const verdictText =
    verdict === 0
      ? t("grid.verdict.ok")
      : verdict === LOGICAL_X
        ? t("grid.verdict.x")
        : verdict === LOGICAL_Z
          ? t("grid.verdict.z")
          : t("grid.verdict.xz");

  return (
    <section id="panel-grid" className="panel panel--grid">
      <h2>{t("grid.title")}</h2>
      <div className="controls">
        <DistanceSelect value={d} onChange={onDistanceChange} />
        <NoiseControls
          p={p}
          onPChange={onPChange}
          onRandom={randomize}
          onClear={clear}
        />
      </div>
      <Grid trace={trace} onToggleX={toggleX} onToggleZ={toggleZ} />
      <p className="verdict" role="status" data-verdict={verdict}>
        {verdictText}
      </p>
      <p className="hint">{t("grid.hint")}</p>
      {/* Below the grid on purpose: an open explanation pushes only the
          legend, never the lattice (tasks/plans/phase2.md D13). */}
      <ExplainGroup>
        <Explain id="qubit" />
        <Explain id="stabilizer" />
        <Explain id="yError" />
        <Explain id="matching" />
        <Explain id="distance" />
      </ExplainGroup>
      <ul className="legend">
        <li>
          <span className="swatch swatch--z" />
          {t("grid.legend.zPlaquette")}
        </li>
        <li>
          <span className="swatch swatch--x" />
          {t("grid.legend.xPlaquette")}
        </li>
        <li>
          <span className="swatch swatch--defect" />
          {t("grid.legend.defect")}
        </li>
        <li>
          <span className="swatch swatch--chain" />
          {t("grid.legend.chain")}
        </li>
      </ul>
    </section>
  );
}
