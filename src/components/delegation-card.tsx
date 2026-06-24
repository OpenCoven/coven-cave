"use client";

import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import type { CovenCall } from "@/lib/coven-calls-types";

// DelegationCard — primitive that renders a single Coven Call as
// caller → callee · request · status · return artifact link.
// Used in the calls list, the cross-familiar timeline, and (future)
// the inspector's calls tab.

type Props = {
  call: CovenCall;
  familiars: Map<string, Familiar>;
  /** Optional click handler for the artifact link (file path, session, etc.). */
  onOpenArtifact?: (call: CovenCall) => void;
};

function avatar(f: Familiar | undefined): string {
  if (!f) return "?";
  return (f.display_name ?? f.id).slice(0, 1).toUpperCase();
}

function statusPill(status: CovenCall["status"]): string {
  switch (status) {
    case "running":
      return "bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]";
    case "completed":
      return "bg-[var(--bg-raised)] text-[var(--text-secondary)]";
    case "failed":
      return "bg-[color-mix(in_oklch,var(--color-danger)_20%,transparent)] text-[var(--color-danger)]";
    case "cancelled":
      return "bg-[color-mix(in_oklch,var(--color-warning)_20%,transparent)] text-[var(--color-warning)]";
  }
}

export function DelegationCard({ call, familiars, onOpenArtifact }: Props) {
  const caller = familiars.get(call.callerFamiliarId);
  const callee = familiars.get(call.calleeFamiliarId);
  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12px]">
        <span
          className="grid h-6 w-6 place-items-center rounded-full bg-[var(--bg-raised)] text-[10px] font-semibold text-[var(--text-primary)]"
          title={caller?.display_name ?? call.callerFamiliarId}
        >
          {avatar(caller)}
        </span>
        <span className="text-[var(--text-secondary)]">
          {caller?.display_name ?? call.callerFamiliarId}
        </span>
        <Icon
          name="ph:caret-right-bold"
          width={10}
          className="text-[var(--text-muted)]"
        />
        <span
          className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent-presence)]/30 text-[10px] font-semibold text-[var(--text-primary)]"
          title={callee?.display_name ?? call.calleeFamiliarId}
        >
          {avatar(callee)}
        </span>
        <span className="font-medium text-[var(--text-primary)]">
          {callee?.display_name ?? call.calleeFamiliarId}
        </span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusPill(call.status)}`}
        >
          {call.status}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-[var(--text-secondary)]">
        {call.request}
      </p>
      {call.artifact ? (
        <button
          type="button"
          onClick={() => onOpenArtifact?.(call)}
          className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--accent-presence-soft)] hover:underline"
        >
          <Icon name="ph:arrow-square-out" width={10} />
          <span className="truncate">{call.artifact}</span>
        </button>
      ) : null}
    </div>
  );
}
