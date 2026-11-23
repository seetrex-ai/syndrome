import { useTranslation } from "react-i18next";
import { DISTANCES, type Distance } from "../../core";
import { SegmentedControl } from "./SegmentedControl";

export interface DistanceSelectProps {
  readonly value: Distance;
  readonly onChange: (d: Distance) => void;
}

/** The code distance as a segmented control (design.md D4): one segment per DISTANCES entry. */
export function DistanceSelect({ value, onChange }: DistanceSelectProps) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      className="distance"
      legend={t("grid.distance")}
      options={DISTANCES.map((d) => ({ value: String(d), label: String(d) }))}
      value={String(value)}
      onChange={(next) => onChange(Number(next) as Distance)}
    />
  );
}
