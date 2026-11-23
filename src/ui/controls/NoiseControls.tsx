import { useTranslation } from "react-i18next";
import { Slider } from "./Slider";

export const P_MIN = 0;
export const P_MAX = 0.2;
export const P_STEP = 0.005;

export interface NoiseControlsProps {
  readonly p: number;
  readonly onPChange: (p: number) => void;
  readonly onRandom: () => void;
  readonly onClear: () => void;
}

export function NoiseControls({
  p,
  onPChange,
  onRandom,
  onClear,
}: NoiseControlsProps) {
  const { t, i18n } = useTranslation();
  const percent = p.toLocaleString(i18n.language, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <>
      <Slider
        label={t("grid.p")}
        min={P_MIN}
        max={P_MAX}
        step={P_STEP}
        value={p}
        onChange={onPChange}
        valueText={percent}
      />
      <button type="button" className="btn btn--primary" onClick={onRandom}>
        {t("grid.random")}
      </button>
      <button type="button" className="btn btn--ghost" onClick={onClear}>
        {t("grid.clear")}
      </button>
    </>
  );
}
