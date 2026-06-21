"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  value: string;
  onValueChange: (next: string) => void;
  /** Leading icon. Defaults to ph:magnifying-glass. */
  leadingIcon?: IconName;
  /** When set and value is non-empty, shows a clear (X) button. */
  onClear?: () => void;
  /** Optional below-input hint row (e.g. example tokens). */
  hint?: ReactNode;
  containerClassName?: string;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onValueChange,
    leadingIcon = "ph:magnifying-glass",
    onClear,
    hint,
    placeholder = "Search…",
    className,
    containerClassName,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const showClear = value.length > 0 && onClear;
  return (
    <div className={containerClassName}>
      <div className="ui-search-input">
        <span className="ui-search-input-leading" aria-hidden>
          <Icon name={leadingIcon} width={13} />
        </span>
        <input
          ref={ref}
          type="search"
          className={["ui-search-input-field", className ?? ""].filter(Boolean).join(" ")}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            // Escape clears a non-empty query (consumers opt in via onClear),
            // matching the app's other search fields. Defers to a consumer
            // handler that already consumed the event.
            if (!e.defaultPrevented && e.key === "Escape" && value && onClear) {
              e.preventDefault();
              onClear();
              onValueChange("");
            }
          }}
          {...rest}
        />
        {showClear ? (
          <button
            type="button"
            className="ui-search-input-clear"
            onClick={() => {
              onClear?.();
              onValueChange("");
            }}
            aria-label="Clear search"
          >
            <Icon name="ph:x" width={11} aria-hidden />
          </button>
        ) : null}
      </div>
      {hint ? <div className="ui-search-input-hint">{hint}</div> : null}
    </div>
  );
});
