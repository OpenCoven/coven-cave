"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { ProjectPicker } from "@/components/project-picker";
import type { CaveProject } from "@/lib/cave-projects-types";
import { buildSeedRequest, summarizeSeedResult, validateSubfolderInput } from "@/lib/knowledge-pack-ui";
import type { KnowledgePackManifest, KnowledgePackSeedResult } from "@/lib/knowledge-pack-types";

export type SkillInstallResult = {
  skillId: string;
  installedTo: string[];
  alreadyInstalled?: boolean;
};

type Props = {
  open: boolean;
  manifest: KnowledgePackManifest;
  alreadyInstalled: boolean;
  onClose: () => void;
  onTrackedInstalled?: () => void;
};

type Target = "vault" | "project";
type StepError = { step: string; message: string } | null;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!json.ok) throw new Error(json.error ?? `${url} failed with ${res.status}`);
  return json;
}

export function KnowledgePackSeedModal({ open, manifest, alreadyInstalled, onClose, onTrackedInstalled }: Props) {
  const [target, setTarget] = useState<Target>("vault");
  const [projects, setProjects] = useState<CaveProject[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [subfolder, setSubfolder] = useState(manifest.defaultRoot ?? "");
  const [selectedSkills, setSelectedSkills] = useState<ReadonlySet<string>>(() => new Set(manifest.skills));
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<StepError>(null);
  const [seedResult, setSeedResult] = useState<KnowledgePackSeedResult | null>(null);
  const [skillResults, setSkillResults] = useState<SkillInstallResult[]>([]);
  const { announce } = useAnnouncer();

  useEffect(() => {
    if (!open) return;
    setSubfolder(manifest.defaultRoot ?? "");
    setSelectedSkills(new Set(manifest.skills));
    setStepError(null);
    setSeedResult(null);
    setSkillResults([]);
  }, [manifest, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setProjectsLoading(true);
    setProjectsError(null);
    fetch("/api/projects", { cache: "no-store", signal: controller.signal })
      .then((res) => res.json().then((json) => ({ res, json })))
      .then(({ res, json }) => {
        if (controller.signal.aborted) return;
        if (!json?.ok || !Array.isArray(json.projects)) throw new Error(json?.error ?? `projects http ${res.status}`);
        const next = json.projects as CaveProject[];
        setProjects(next);
        setProjectId((current) => current && next.some((project) => project.id === current) ? current : next[0]?.id ?? null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setProjects([]);
          setProjectsError(error instanceof Error ? error.message : "Projects unavailable");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false);
      });
    return () => controller.abort();
  }, [open]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? projects[0] ?? null,
    [projectId, projects],
  );
  const subfolderValidation = validateSubfolderInput(subfolder);
  const subfolderError = target === "project" && !subfolderValidation.ok ? subfolderValidation.error : null;
  const canConfirm = !busy && (target === "vault" || Boolean(selectedProject)) && !subfolderError;

  const toggleSkill = (skillId: string, checked: boolean) => {
    setSelectedSkills((current) => {
      const next = new Set(current);
      if (checked) next.add(skillId);
      else next.delete(skillId);
      return next;
    });
  };

  const confirm = async () => {
    setBusy(true);
    setStepError(null);
    setSeedResult(null);
    setSkillResults([]);
    try {
      try {
        await postJson<{ ok: true; installedAt?: string; alreadyInstalled?: boolean }>("/api/marketplace/install", { id: manifest.id });
        onTrackedInstalled?.();
      } catch (error) {
        throw { step: "Track install", message: error instanceof Error ? error.message : "Marketplace install failed" };
      }

      let seed: KnowledgePackSeedResult;
      try {
        const request = target === "vault"
          ? buildSeedRequest(manifest.id, "vault")
          : buildSeedRequest(manifest.id, "project", selectedProject?.root, subfolder);
        seed = await postJson<KnowledgePackSeedResult>("/api/knowledge/packs/seed", request);
        setSeedResult(seed);
      } catch (error) {
        throw { step: "Seed folders", message: error instanceof Error ? error.message : "Seed failed" };
      }

      const installedSkills: SkillInstallResult[] = [];
      for (const skillId of manifest.skills.filter((id) => selectedSkills.has(id))) {
        try {
          const result = await postJson<{ ok: true; installedTo?: string[]; alreadyInstalled?: boolean }>(
            "/api/skills/packages/install",
            { packId: manifest.id, skillId },
          );
          installedSkills.push({ skillId, installedTo: result.installedTo ?? [], alreadyInstalled: result.alreadyInstalled });
        } catch (error) {
          throw { step: `Install ${skillId}`, message: error instanceof Error ? error.message : "Skill install failed" };
        }
      }
      setSkillResults(installedSkills);
      const summary = summarizeSeedResult(seed);
      announce(`Knowledge pack seeded. ${summary}`, "polite");
    } catch (error) {
      const next = typeof error === "object" && error && "step" in error && "message" in error
        ? error as Exclude<StepError, null>
        : { step: "Install", message: error instanceof Error ? error.message : "Install failed" };
      setStepError(next);
      announce(`${next.step}: ${next.message}`, "assertive");
    } finally {
      setBusy(false);
    }
  };

  const footerActions = seedResult ? (
    <Button variant="primary" onClick={onClose}>Done</Button>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="primary" loading={busy} disabled={!canConfirm} onClick={() => void confirm()}>
        {alreadyInstalled ? "Seed again" : "Install & seed"}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      breadcrumb={["Marketplace", manifest.displayName, "Seed"]}
      footerActions={footerActions}
      dismissOnBackdrop={!busy}
    >
      <div className="flex flex-col gap-5" aria-live="polite">
        <section className="flex flex-col gap-2">
          <h3 className="text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">1. Choose where the pack should seed</h3>
          <div className="grid gap-2 @min-[620px]:grid-cols-2">
            <label className="focus-within:ring-2 focus-within:ring-[var(--focus-ring)] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] p-3">
              <input className="focus-ring mr-2" type="radio" name="knowledge-pack-target" checked={target === "vault"} onChange={() => setTarget("vault")} />
              <span className="text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">Knowledge vault</span>
              <p className="mt-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">Collections appear in the Grimoire; entries start disabled for prompt injection — agents look them up on demand.</p>
            </label>
            <label className="focus-within:ring-2 focus-within:ring-[var(--focus-ring)] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] p-3">
              <input className="focus-ring mr-2" type="radio" name="knowledge-pack-target" checked={target === "project"} onChange={() => setTarget("project")} />
              <span className="text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">Project folder</span>
              <p className="mt-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">Seed folders into a project tree, like <code>ok seed</code>.</p>
            </label>
          </div>

          {target === "project" ? (
            <div className="mt-2 flex flex-col gap-3 rounded-lg border border-[var(--border-hairline)] p-3">
              <div>
                <span className="mb-1 block text-[length:var(--text-xs)] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Project</span>
                {projectsLoading ? <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">Loading projects…</p> : null}
                {projectsError ? <p role="alert" className="text-[length:var(--text-sm)] text-[var(--danger-text)]">{projectsError}</p> : null}
                {!projectsLoading && !projectsError && projects.length === 0 ? (
                  <p role="alert" className="text-[length:var(--text-sm)] text-[var(--danger-text)]">No registered projects are available.</p>
                ) : (
                  <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} ariaLabel="Choose project for knowledge pack seed" disabled={busy || projectsLoading} />
                )}
              </div>
              <label className="flex flex-col gap-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text-secondary)]">Subfolder</span>
                <input
                  className="focus-ring rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-[length:var(--text-base)] text-[var(--text-primary)]"
                  value={subfolder}
                  onChange={(event) => setSubfolder(event.target.value)}
                  placeholder="project root"
                  aria-invalid={Boolean(subfolderError)}
                  aria-describedby={subfolderError ? "knowledge-pack-subfolder-error" : undefined}
                />
                <span>Use up to 3 lowercase slug segments. Empty seeds into the project root.</span>
                {subfolderError ? <span id="knowledge-pack-subfolder-error" role="alert" className="text-[var(--danger-text)]">{subfolderError}</span> : null}
              </label>
            </div>
          ) : null}
        </section>

        {manifest.skills.length ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">2. Install bundled skills</h3>
            <div className="flex flex-col gap-2">
              {manifest.skills.map((skillId) => (
                <label key={skillId} className="inline-flex items-start gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] p-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                  <input className="focus-ring mt-0.5" type="checkbox" checked={selectedSkills.has(skillId)} onChange={(event) => toggleSkill(skillId, event.target.checked)} />
                  <span><span className="font-medium text-[var(--text-primary)]">Install the {skillId} skill</span> for local agents.</span>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {stepError ? (
          <p role="alert" className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] p-2 text-[length:var(--text-sm)] text-[var(--danger-text)]">
            <strong>{stepError.step} failed:</strong> {stepError.message}
          </p>
        ) : null}

        {seedResult ? (
          <section className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] p-3" aria-live="polite">
            <h3 className="text-[length:var(--text-base)] font-semibold text-[var(--text-primary)]">Seed complete</h3>
            <p className="mt-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">{summarizeSeedResult(seedResult)}</p>
            {seedResult.target === "vault" ? (
              <a href="#grimoire" className="mt-2 inline-block text-[length:var(--text-sm)] text-[var(--text-primary)] underline underline-offset-2">Open the Grimoire to browse your new collections</a>
            ) : null}
            {skillResults.length ? (
              <ul className="mt-3 flex flex-col gap-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {skillResults.map((result) => (
                  <li key={result.skillId}>
                    <span className="text-[var(--text-secondary)]">{result.skillId}</span>: {result.alreadyInstalled ? "already installed" : (result.installedTo.length ? result.installedTo.join(", ") : "installed")}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
