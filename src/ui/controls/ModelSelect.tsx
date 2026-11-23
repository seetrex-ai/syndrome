// The noise model of the chart (tasks/plans/phase2.md D10): a segmented
// control (design.md D4) in a fieldset named `chart.modelSelect.label`, one
// native radio per NoiseKind, labelled from `chart.modelSelect.*`. It lives in
// the chart panel because the chart is the only view that changes with it: the
// lattice and the walkthrough stay in the one-cycle model. The class and the
// `data-model` attribute are hooks of the video camera (tools/video/hooks.ts).
import { useTranslation } from "react-i18next";
import { NOISE_KINDS, type NoiseKind } from "../model/noise-kinds";
import { SegmentedControl } from "./SegmentedControl";

export interface ModelSelectProps {
  readonly value: NoiseKind;
  readonly onChange: (model: NoiseKind) => void;
}

export function ModelSelect({ value, onChange }: ModelSelectProps) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      className="model-select segmented--fill"
      legend={t("chart.modelSelect.label")}
      options={NOISE_KINDS.map((kind) => ({
        value: kind,
        label: t(`chart.modelSelect.${kind}`),
      }))}
      value={value}
      onChange={onChange}
      data-model={value}
    />
  );
}
