"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Popover, PopoverBody, PopoverItem } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export type StandardSelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  detail?: string;
  icon?: IconName;
  leading?: ReactNode;
};

export type StandardSelectGroup<T extends string> = {
  label: string;
  options: StandardSelectOption<T>[];
};

type SelectEntry<T extends string> = StandardSelectOption<T> | StandardSelectGroup<T>;

export type StandardSelectProps<T extends string> = {
  id?: string;
  label: string;
  title?: string;
  value: T;
  onChange: (value: T) => void;
  options: SelectEntry<T>[];
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
  popoverClassName?: string;
  groupClassName?: string;
  showCaret?: boolean;
  renderValue?: (selected: StandardSelectOption<T> | null) => ReactNode;
};

function isGroup<T extends string>(entry: SelectEntry<T>): entry is StandardSelectGroup<T> {
  return typeof entry === "object" && "options" in entry;
}

function flattenOptions<T extends string>(entries: SelectEntry<T>[]): StandardSelectOption<T>[] {
  return entries.flatMap((entry) => (isGroup(entry) ? entry.options : [entry]));
}

function findSelected<T extends string>(
  entries: SelectEntry<T>[],
  value: T,
): StandardSelectOption<T> | null {
  return flattenOptions(entries).find((option) => option.value === value) ?? null;
}

function defaultOptionLabel<T extends string>(selected: StandardSelectOption<T> | null): string {
  return selected?.label ?? "";
}

export function StandardSelect<T extends string>({
  id,
  label,
  title,
  value,
  onChange,
  options,
  className,
  style,
  disabled,
  placeholder,
  popoverClassName,
  groupClassName,
  showCaret = true,
  renderValue,
}: StandardSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = findSelected(options, value);
  const selectedLabel = defaultOptionLabel(selected) || placeholder || value || label;

  return (
    <>
      <Button
        id={id}
        type="button"
        ref={triggerRef}
        variant="secondary"
        size="md"
        className={[
            "min-w-0 justify-between gap-1 px-3 py-1.5 text-left text-[12px] leading-none",
            className ?? "",
          ]
          .filter(Boolean)
          .join(" ")}
        style={style}
        title={title}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
      >
        {renderValue ? (
          renderValue(selected)
        ) : (
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        )}
        {showCaret ? (
          <Icon
            name="ph:caret-down-bold"
            width={11}
            className="shrink-0 text-[var(--text-muted)]"
            aria-hidden
          />
        ) : null}
      </Button>

      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        placement="bottom-start"
        ariaLabel={label}
        className={popoverClassName}
      >
        <PopoverBody role="menu" ariaLabel={`${label} options`}>
          {options.map((entry, index) => {
            if (isGroup(entry)) {
              return (
                <div
                  key={entry.label || `group-${index}`}
                  className={groupClassName}
                >
                  {entry.label ? <span className="ui-popover-label">{entry.label}</span> : null}
                  {entry.options.map((option) => (
                    <PopoverItem
                      key={option.value}
                      icon={option.icon}
                      leading={option.leading}
                      checked={option.value === value}
                      disabled={option.disabled}
                      onSelect={() => {
                        if (option.disabled) return;
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{option.label}</span>
                        {option.detail ? (
                          <span className="truncate text-[10px] text-[var(--text-muted)]">{option.detail}</span>
                        ) : null}
                      </span>
                    </PopoverItem>
                  ))}
                </div>
              );
            }

            return (
              <PopoverItem
                key={entry.value}
                icon={entry.icon}
                leading={entry.leading}
                checked={entry.value === value}
                disabled={entry.disabled}
                onSelect={() => {
                  if (entry.disabled) return;
                  onChange(entry.value);
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{entry.label}</span>
                  {entry.detail ? (
                    <span className="truncate text-[10px] text-[var(--text-muted)]">{entry.detail}</span>
                  ) : null}
                </span>
              </PopoverItem>
            );
          })}
        </PopoverBody>
      </Popover>
    </>
  );
}
