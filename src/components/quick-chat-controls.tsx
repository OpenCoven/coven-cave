"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";

export type QuickChatSelectOption<T extends string> = StandardSelectOption<T>;

function initials(familiar: Familiar): string {
  return (familiar.display_name || familiar.id)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function FamiliarMark({ familiar, size = "sm" }: { familiar: Familiar; size?: "sm" | "md" }) {
  const sizeClass = size === "md" ? "h-6 w-6 text-[10px]" : "h-5 w-5 text-[9px]";
  return familiar.avatarUrl ? (
    <img src={familiar.avatarUrl} alt="" className={`${sizeClass} rounded-[var(--radius-control)] object-cover`} />
  ) : (
    <span className={`grid ${sizeClass} place-items-center rounded-[var(--radius-control)] bg-[var(--bg-elevated)] font-semibold text-[var(--fg-primary)]`}>
      {initials(familiar)}
    </span>
  );
}

export function QuickChatSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: QuickChatSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <StandardSelect
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      showCaret={false}
      className={[
        "quick-chat-select__trigger min-w-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-left text-xs outline-none disabled:cursor-not-allowed disabled:opacity-55",
        className ?? "",
      ].filter(Boolean).join(" ")}
      renderValue={(selected) => (
        <>
          <span className="flex min-w-0 items-center gap-2">
            {selected?.leading ?? (selected?.icon ? <Icon name={selected.icon} width={13} aria-hidden className="shrink-0 text-[var(--fg-muted)]" /> : null)}
            <span className="min-w-0 truncate">{selected?.label ?? label}</span>
          </span>
          <Icon name="ph:caret-down" width={13} aria-hidden className="shrink-0 text-[var(--fg-muted)]" />
        </>
      )}
    />
  );
}
