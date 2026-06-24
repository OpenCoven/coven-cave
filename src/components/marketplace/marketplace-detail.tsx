"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { pluginBadgeState, type MarketplacePlugin } from "@/lib/marketplace-catalog";

const TRUST_LABEL: Record<string, string> = {
  "official-remote": "Official remote",
  "reference-local": "Reference (local)",
  "preview-local": "Preview (local)",
  "local-tool": "Local tool",
};

type Props = {
  plugin: MarketplacePlugin;
  busy: boolean;
  onClose: () => void;
  onAdd: () => void;
  onRemove: () => void;
};

export function MarketplaceDetail({ plugin, busy, onClose, onAdd, onRemove }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, ref, { onEscape: onClose });
  const state = pluginBadgeState(plugin);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${plugin.displayName} details`}
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-[var(--border-hairline)] bg-[var(--bg-base)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
              <Icon name="ph:plug-bold" width={18} className="text-[var(--text-muted)]" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold text-[var(--text-primary)]">{plugin.displayName}</h2>
              <p className="truncate text-[12px] text-[var(--text-muted)]">By {plugin.author} · {plugin.category}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <Icon name="ph:x" width={16} />
          </button>
        </div>

        {plugin.description ? <p className="text-[13px] text-[var(--text-primary)]">{plugin.description}</p> : null}

        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
            <Icon name="ph:seal-check" width={11} aria-hidden /> {TRUST_LABEL[plugin.trust] ?? plugin.trust}
          </span>
          {plugin.policy.authentication === "ON_INSTALL" ? (
            <span className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5">Auth on install</span>
          ) : null}
          {plugin.requiresSetup ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
              <Icon name="ph:warning" width={11} aria-hidden /> Needs setup
            </span>
          ) : null}
        </div>

        {plugin.capabilities.length ? (
          <Section title="Capabilities">
            <div className="flex flex-wrap gap-1.5">
              {plugin.capabilities.map((c) => (
                <span key={c} className="rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">{c}</span>
              ))}
            </div>
          </Section>
        ) : null}

        {plugin.roleAffinity.length ? (
          <Section title="Role affinity">
            <ul className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
              {plugin.roleAffinity.map((ra) => (
                <li key={ra.familiar}><span className="text-[var(--text-primary)]">{ra.familiar}</span> · {ra.roles.join(", ")}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {plugin.requiresSetup ? (
          <Section title="Required configuration">
            <p className="text-[12px] text-[var(--text-muted)]">
              This plugin needs credentials before it can run. Adding it now records your choice; credential setup is a later step.
            </p>
          </Section>
        ) : null}

        {plugin.homepage || plugin.repository ? (
          <Section title="Links">
            <div className="flex flex-col gap-1 text-[12px]">
              {plugin.homepage ? <a className="text-[var(--text-primary)] underline" href={plugin.homepage} target="_blank" rel="noreferrer">Homepage</a> : null}
              {plugin.repository ? <a className="text-[var(--text-primary)] underline" href={plugin.repository} target="_blank" rel="noreferrer">Repository</a> : null}
            </div>
          </Section>
        ) : null}

        <div className="mt-auto pt-2">
          {state === "added" ? (
            <Button variant="secondary" fullWidth leadingIcon="ph:check" loading={busy} onClick={onRemove}>Added — remove</Button>
          ) : state === "unavailable" ? (
            <Button variant="ghost" fullWidth disabled>Unavailable</Button>
          ) : (
            <Button variant="primary" fullWidth leadingIcon="ph:plus" loading={busy} onClick={onAdd}>Add to Cave</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">{title}</h3>
      {children}
    </section>
  );
}
