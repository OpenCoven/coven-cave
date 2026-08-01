"use client";

/**
 * chart-room-parts — the small pieces every Chart Room lens repeats.
 *
 * A project dot carrying a real project colour, a state tag whose tone is
 * resolved by the stylesheet from one attribute, and the overlaid select the
 * table and the step sheet both edit through.
 */

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { ChartStepState } from "./chart-room-model";

/** A project's own colour, handed to CSS as a custom property. Board data, not
 *  a literal — the stylesheet owns every other colour in the room. */
export function projectDotStyle(color: string | null | undefined): CSSProperties | undefined {
  return color ? ({ "--cr-dot": color } as CSSProperties) : undefined;
}

export function ChartDot({
  color,
  large = false,
}: {
  color: string | null | undefined;
  large?: boolean;
}) {
  return <span className={large ? "cr-dot cr-dot--lg" : "cr-dot"} style={projectDotStyle(color)} />;
}

export function StateTag({ state }: { state: ChartStepState }) {
  return (
    <span className="cr-state" data-state={state}>
      {state === "decision" ? "owed" : state}
    </span>
  );
}

export function Eyebrow({
  children,
  accent = false,
}: {
  children: ReactNode;
  accent?: boolean;
}) {
  return <span className={accent ? "cr-eyebrow cr-eyebrow--accent" : "cr-eyebrow"}>{children}</span>;
}

/**
 * A select whose visible label is painted from data with the real `<select>`
 * transparent on top. Native pickers cannot be styled to the room's density,
 * and a hand-rolled listbox here would be a third menu implementation — this
 * keeps the platform control, its keyboard behaviour, and the room's type.
 */
export function ChartSelect({
  value,
  onChange,
  label,
  options,
  accent = false,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
  accent?: boolean;
  disabled?: boolean;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <span className="cr-select">
      <span className="cr-select__label" data-tone={accent ? "accent" : undefined}>
        {current?.label ?? "—"}
      </span>
      <span className="cr-select__caret" aria-hidden>
        ▾
      </span>
      <select
        className="focus-ring"
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function LensIcon({ name, size = 13 }: { name: IconName; size?: number }) {
  return <Icon name={name} width={size} height={size} aria-hidden />;
}
