// A segmented control over native radios (tasks/plans/design.md D4): a
// fieldset named by its legend (visible, or visually hidden but never absent),
// one visually hidden radio per option and its label as the segment. Keyboard
// (Tab into the group, arrows between options), the accessible name and the
// checked state come from the platform; controls.css only paints.
import { Fragment, useId, type ReactNode } from "react";
import "./controls.css";

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: string;
  /**
   * A decorative icon drawn before the label. On a phone controls.css shows
   * the icon alone and keeps the label visually hidden: it stays the
   * option's accessible name.
   */
  readonly icon?: ReactNode;
}

export interface SegmentedControlProps<V extends string> {
  /** The group's accessible name (an i18n string). */
  readonly legend: string;
  /** Hide the legend visually (`.sr-only`); it stays in the accessibility tree. */
  readonly hideLegend?: boolean;
  readonly options: readonly SegmentedOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  /** The radios' `name`; unique per group by default (two groups never share one). */
  readonly name?: string;
  readonly className?: string;
  /** `data-*` attributes passed through to the fieldset (hooks of tests and scripts). */
  readonly [data: `data-${string}`]: string | number | boolean | undefined;
}

export function SegmentedControl<V extends string>({
  legend,
  hideLegend = false,
  options,
  value,
  onChange,
  name,
  className,
  ...data
}: SegmentedControlProps<V>) {
  const id = useId();
  const groupName = name ?? id;
  return (
    <fieldset
      className={
        className === undefined ? "segmented" : `segmented ${className}`
      }
      data-segmented
      {...data}
    >
      <legend className={hideLegend ? "sr-only" : "segmented__legend"}>
        {legend}
      </legend>
      <div className="segmented__options">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <Fragment key={option.value}>
              <input
                type="radio"
                className="segmented__input"
                id={optionId}
                name={groupName}
                value={option.value}
                checked={option.value === value}
                onChange={() => onChange(option.value)}
              />
              <label
                className={
                  option.icon === undefined
                    ? "segmented__option"
                    : "segmented__option segmented__option--icon"
                }
                // An icon segment shows no text on a phone: the tooltip names
                // it for a pointer.
                title={option.icon === undefined ? undefined : option.label}
                htmlFor={optionId}
              >
                {option.icon === undefined ? (
                  option.label
                ) : (
                  <>
                    {option.icon}
                    <span className="segmented__text">{option.label}</span>
                  </>
                )}
              </label>
            </Fragment>
          );
        })}
      </div>
    </fieldset>
  );
}
