"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import type { KnowledgePackManifest, KnowledgePackTemplateMeta } from "@/lib/knowledge-pack-types";
import { pluginBadgeState, type MarketplacePlugin } from "@/lib/marketplace-catalog";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { KnowledgePackSeedModal } from "@/components/marketplace/knowledge-pack-seed-modal";

type Props = {
  plugin: MarketplacePlugin;
  busy: boolean;
  onClose: () => void;
};

const TRUST_LABEL: Record<string, string> = {
  "official-remote": "Official remote",
  "official-local": "Official (local)",
  "reference-local": "Reference (local)",
  "preview-local": "Preview (local)",
  "local-tool": "Local tool",
};

function DossierSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="craft-dossier__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ChipList({ ids, empty = "None bundled." }: { ids: readonly string[]; empty?: string }) {
  if (!ids.length) return <p className="craft-dossier__quiet">{empty}</p>;
  return <ul className="craft-dossier__resource-list">{ids.map((id) => <li key={id}>{id}</li>)}</ul>;
}

function TemplateList({ templates }: { templates: KnowledgePackTemplateMeta[] }) {
  if (!templates.length) return <p className="craft-dossier__quiet">No templates declared.</p>;
  return (
    <ul className="craft-dossier__source-list">
      {templates.map((template) => (
        <li key={template.id}>
          <strong>{template.id} · {template.name}</strong>
          {template.description ? <span>{template.description}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function KnowledgePackDetail({ plugin, busy, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [manifest, setManifest] = useState<KnowledgePackManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [seedOpen, setSeedOpen] = useState(false);
  const [trackedInstalled, setTrackedInstalled] = useState(plugin.installed);
  useFocusTrap(true, dialogRef, { onEscape: onClose });

  useEffect(() => setTrackedInstalled(plugin.installed), [plugin.installed]);

  useEffect(() => {
    const controller = new AbortController();
    setManifest(null);
    setManifestError(null);
    fetch("/api/knowledge/packs", { cache: "no-store", signal: controller.signal })
      .then((res) => res.json().then((json) => ({ res, json })))
      .then(({ res, json }) => {
        if (controller.signal.aborted) return;
        if (!json?.ok || !Array.isArray(json.packs)) throw new Error(json?.error ?? `packs http ${res.status}`);
        const found = (json.packs as KnowledgePackManifest[]).find((pack) => pack.id === plugin.id) ?? null;
        if (!found) {
          setManifestError("Pack manifest unavailable.");
          return;
        }
        setManifest(found);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setManifestError(error instanceof Error ? error.message : "Pack manifest unavailable");
      });
    return () => controller.abort();
  }, [plugin.id]);

  const templatesByFolder = useMemo(() => {
    const grouped = new Map<string, KnowledgePackTemplateMeta[]>();
    for (const template of manifest?.templates ?? []) {
      grouped.set(template.folder, [...(grouped.get(template.folder) ?? []), template]);
    }
    return grouped;
  }, [manifest?.templates]);
  const state = pluginBadgeState({ ...plugin, installed: trackedInstalled });
  const installLabel = trackedInstalled ? "Seed again…" : "Install & seed…";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--backdrop-scrim)]" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${plugin.displayName} Knowledge pack details`}
        tabIndex={-1}
        className="craft-dossier"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="craft-dossier__header">
          <span className="craft-dossier__sigil" aria-hidden><Icon name="ph:books" width={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="craft-dossier__eyebrow">Knowledge pack · v{manifest?.version ?? plugin.version}</p>
            <h2>{manifest?.displayName ?? plugin.displayName}</h2>
            <p>{manifest?.description ?? plugin.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5"><Icon name="ph:books" width={11} aria-hidden /> Knowledge pack</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5"><Icon name="ph:seal-check" width={11} aria-hidden /> {TRUST_LABEL[plugin.trust] ?? plugin.trust}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Knowledge pack details" className="focus-ring craft-dossier__close">
            <Icon name="ph:x" width={16} />
          </button>
        </header>

        <div className="craft-dossier__body">
          <div className="craft-dossier__runtime" aria-live="polite">
            <span><Icon name={state === "added" ? "ph:seal-check" : "ph:books"} width={14} aria-hidden /></span>
            <div>
              <strong>{trackedInstalled ? "Installed — seeding is idempotent" : "Ready to seed"}</strong>
              <p>Seeds linked folders, markdown templates, prompts, workflows, and optional local-agent skills.</p>
            </div>
          </div>

          {manifestError ? <p role="alert" className="craft-dossier__alert">{manifestError}</p> : null}
          {!manifest && !manifestError ? <p className="craft-dossier__quiet">Loading pack manifest…</p> : null}
          {!manifest && manifestError ? (
            <DossierSection title="Pack manifest unavailable">
              <p className="craft-dossier__quiet">{plugin.description || "This listing is available, but its compiled pack manifest could not be loaded."}</p>
            </DossierSection>
          ) : null}

          {manifest ? (
            <div className="craft-dossier__ledger">
              <DossierSection title="Folders">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-[11px]">
                    <thead className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                      <tr><th className="pb-2">Name</th><th className="pb-2">Entity</th><th className="pb-2">Fields</th><th className="pb-2">Templates</th></tr>
                    </thead>
                    <tbody className="align-top text-[var(--text-secondary)]">
                      {manifest.folders.map((folder) => (
                        <tr key={folder.id} className="border-t border-[var(--border-hairline)]">
                          <td className="py-2 pr-3"><strong className="block text-[var(--text-primary)]">{folder.name}</strong><span className="text-[var(--text-muted)]">{folder.storyQuestion ?? folder.description}</span></td>
                          <td className="py-2 pr-3"><span className="rounded-md border border-[var(--border-hairline)] px-1.5 py-0.5">{folder.entityType}</span></td>
                          <td className="py-2 pr-3 text-[var(--text-muted)]">{folder.fields.map((field) => field.key).join(", ") || "—"}</td>
                          <td className="py-2">{folder.templates.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DossierSection>

              <DossierSection title="Templates">
                {manifest.folders.map((folder) => (
                  <div key={folder.id} className="mb-3 last:mb-0">
                    <h4 className="mb-1 text-[11px] font-semibold text-[var(--text-primary)]">{folder.name}</h4>
                    <TemplateList templates={templatesByFolder.get(folder.id) ?? []} />
                  </div>
                ))}
              </DossierSection>

              <DossierSection title="Bundled skills">
                <ChipList ids={manifest.skills} />
                <p className="craft-dossier__quiet">Installing copies checked skills into local skill roots for agents to load.</p>
              </DossierSection>

              <DossierSection title="Prompts & workflows">
                <p className="craft-dossier__quiet">Prompts</p>
                <ChipList ids={manifest.prompts} empty="No prompts bundled." />
                <p className="craft-dossier__quiet">Workflows</p>
                <ChipList ids={manifest.workflows} empty="No workflows bundled." />
              </DossierSection>
            </div>
          ) : null}
        </div>

        <footer className="craft-dossier__footer">
          <div>
            <strong>{trackedInstalled ? "Track-installed" : "Not installed"}</strong>
            <span>{manifest ? `${manifest.folders.length} folders · ${manifest.templates.length} templates` : "Manifest pending"}</span>
          </div>
          <Button variant="primary" leadingIcon="ph:books" loading={busy} disabled={!manifest} onClick={() => setSeedOpen(true)}>{installLabel}</Button>
        </footer>
      </div>
      {manifest ? (
        <KnowledgePackSeedModal
          open={seedOpen}
          manifest={manifest}
          alreadyInstalled={trackedInstalled}
          onClose={() => setSeedOpen(false)}
          onTrackedInstalled={() => setTrackedInstalled(true)}
        />
      ) : null}
    </div>
  );
}
