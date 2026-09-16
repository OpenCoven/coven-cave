"use client";

/**
 * A segmented choice — density, compose/preview, post type, media kind.
 *
 * Local to this room on purpose. `Tabs` is the nearest primitive and it is the
 * wrong one: it announces tabs that own panels, and three of the four uses
 * here just set a value. So this is a radiogroup, which is what it actually
 * is, with roving focus and arrow keys per the WAI-ARIA radio pattern.
 *
 * If a second room needs one of these, it should be promoted to
 * `components/ui/` rather than copied.
 */

import { useRef, type KeyboardEvent } from "react";

export function Segmented<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  labelOf,
  titleOf,
  equalWidth = false,
}: {
  ariaLabel: string;
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  labelOf?: (option: T) => string;
  titleOf?: (option: T) => string | undefined;
  /** Split the width evenly — for a control whose options should not jitter. */
  equalWidth?: boolean;
}) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  const focusAt = (index: number) => {
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]',
    );
    if (!buttons?.length) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped].focus();
    onChange(options[wrapped]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.indexOf(value);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(options.length - 1);
    }
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className="x-comms-segmented"
      data-equal={equalWidth ? "true" : undefined}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: one stop for the whole group, arrows move within.
            tabIndex={selected ? 0 : -1}
            title={titleOf?.(option)}
            className="x-comms-segment focus-ring"
            onClick={() => onChange(option)}
          >
            {labelOf ? labelOf(option) : option}
          </button>
        );
      })}
    </div>
  );
}
