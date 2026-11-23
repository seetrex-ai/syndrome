// A range input with the track painted up to the thumb (tasks/plans/design.md
// D4): `--fill` is the position as a percentage, set here so controls.css can
// draw the filled part with a gradient. The markup stays `<label class="control">`
// + the range + `.control__value`, which the panels' tests and the video hooks
// already rely on (`fireEvent.change` keeps working on the native input).
import type { CSSProperties } from "react";
import "./controls.css";

export interface SliderProps {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** The formatted value shown beside the track (a percentage, a count). */
  readonly valueText?: string;
  readonly className?: string;
}

export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  valueText,
  className,
}: SliderProps) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label
      className={className === undefined ? "control" : `control ${className}`}
    >
      <span className="control__label">{label}</span>
      <input
        type="range"
        className="slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {valueText !== undefined && (
        <span className="control__value">{valueText}</span>
      )}
    </label>
  );
}
