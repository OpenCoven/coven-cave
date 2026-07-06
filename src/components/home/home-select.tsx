"use client";

/**
 * HomeSelect — the home composer's compact chip-style select. A thin wrapper
 * over the shared StandardSelect that supplies the home chip classes and
 * renders the selected option's leading avatar/icon in the trigger.
 */

import { Icon, type IconName } from "@/lib/icon";
import { StandardSelect, type StandardSelectGroup, type StandardSelectOption } from "@/components/ui/select";

export type HomeSelectOption = StandardSelectOption<string>;

export type HomeSelectGroup = {
  label?: string;
  options: HomeSelectOption[];
};

export function HomeSelect({
  label,
  icon,
  value,
  onChange,
  groups,
  ariaLabel,
  disabled = false,
  className,
}: {
  label?: string;
  icon: IconName;
  value: string;
  onChange: (value: string) => void;
  groups: HomeSelectGroup[];
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = groups.flatMap((group) => group.options).find((option) => option.value === value);
  const selectGroups: StandardSelectGroup<string>[] = groups.map((group) => ({
    label: group.label ?? "",
    options: group.options,
  }));

  return (
    <StandardSelect
      label={ariaLabel}
      value={value}
      onChange={onChange}
      options={selectGroups}
      className={["hc-familiar-selector", "hc-home-select-trigger", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      title={selected?.detail ?? selected?.label ?? ariaLabel}
      popoverClassName="hc-home-select-popover"
      groupClassName="hc-home-select-group"
      showCaret={false}
      renderValue={(selectedOption) => (
        <>
          {selectedOption?.leading ?? (
            <Icon
              name={selectedOption?.icon ?? icon}
              width={13}
              className="hc-familiar-glyph"
              aria-hidden
            />
          )}
          {label ? <span className="hc-command-select-label">{label}</span> : null}
          <span className="hc-home-select-value">{selectedOption?.label ?? "None"}</span>
          <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
        </>
      )}
    />
  );
}
