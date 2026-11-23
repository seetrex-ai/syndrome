import { useTranslation } from "react-i18next";
import type { Stabilizer } from "../../core";
import { plaquettePath } from "./geometry";

export interface PlaquetteProps {
  readonly stabilizer: Stabilizer;
  /** The stabilizer is flipped and the defects layer is visible. */
  readonly defect: boolean;
}

export function Plaquette({ stabilizer, defect }: PlaquetteProps) {
  const { t } = useTranslation();
  const { type, row, col, typeIndex } = stabilizer;
  return (
    <path
      className={`plaquette plaquette--${type}`}
      d={plaquettePath(stabilizer)}
      data-type={type}
      data-plaquette={typeIndex}
      data-defect={defect ? 1 : 0}
    >
      <title>{t("grid.plaquette", { type, row, col })}</title>
    </path>
  );
}
