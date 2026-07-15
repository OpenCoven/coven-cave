"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { buildCraftAgentPrompt } from "@/lib/craft-agent-prompt";
import { buildCraftDraftFromRoles } from "@/lib/craft-draft";
import {
  CraftDraftPreview,
  extractionLedgerGroups,
} from "@/components/marketplace/craft-draft-preview";
import type { RoleEntry } from "@/app/api/roles/route";

type RolesResponse = {
  ok?: boolean;
  roles?: RoleEntry[];
  error?: string;
};

type DraftResponse = {
  ok?: boolean;
  draft?: { id: string };
  error?: string;
};

/** Two ways in: describe the Craft and let a familiar build it agentically
 *  through the drafts API, or hand-pick roles. Describe leads for first-time
 *  users; the last-used mode is remembered so power users land back on
 *  Pick roles (docs/craft-ux.md, CP2). */
type CreateMode = "extract" | "describe";

const CREATE_MODES: ReadonlyArray<TabItem<CreateMode>> = [
  { id: "describe", label: "Describe it", icon: "ph:sparkle" },
  { id: "extract", label: "Pick roles", icon: "ph:stack" },
];

const MODE_MEMORY_KEY = "cave:craft-create:mode";

function initialCreateMode(): CreateMode {
  if (typeof window === "undefined") return "describe";
  try {
    return window.localStorage.getItem(MODE_MEMORY_KEY) === "extract" ? "extract" : "describe";
  } catch {
    return "describe";
  }
}

/** Pick-roles is a two-step flow: select roles, then preview the real
 *  extraction ledger before anything is written. */
type ExtractStep = "select" | "preview";

/** Seed for editing an existing draft in place (docs/craft-ux.md F5):
 *  the drawer opens on the preview step with the draft's familiar, roles,
 *  and name; saving replaces the stored draft (delete + recreate — the
 *  drafts store's native semantics). */
export type CraftDrawerSeed = {
  draftId: string;
  familiar: string;
  roleIds: string[];
  displayName?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  seed?: CraftDrawerSeed | null;
};

export function CraftCreateDrawer({ open, onClose, onCreated, seed = null }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<CreateMode>(initialCreateMode);
  const [step, setStep] = useState<ExtractStep>("select");
  const [roles, setRoles] = useState<RoleEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familiar, setFamiliar] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [goal, setGoal] = useState("");
  // Describe-mode arrival (cave-46wg): after the brief dispatches, the drawer
  // stays open and polls the drafts store (visibility-paused via the shared
  // hook, refreshing the moment the user returns from the chat); a NEW draft
  // id (vs the snapshot at dispatch) is the familiar's build landing, handed
  // to the same onCreated the manual path uses.
  const [awaiting, setAwaiting] = useState(false);
  const baselineDraftIds = useRef<ReadonlySet<string>>(new Set());
  // Rename (F12): empty means "use the derived name". Seeded edits start from
  // the stored draft's name so a rename survives an adjust-roles round trip.
  const [customName, setCustomName] = useState("");
  // Per-familiar selection retention (F9): switching familiars stashes the
  // current picks instead of destroying them.
  const selectionsByFamiliar = useRef(new Map<string, ReadonlySet<string>>());
  const appliedSeedId = useRef<string | null>(null);
  useFocusTrap(open, ref, { onEscape: onClose });

  useEffect(() => {
    if (!open) {
      setAwaiting(false);
      setStep("select");
      setCustomName("");
      selectionsByFamiliar.current = new Map();
      appliedSeedId.current = null;
    }
  }, [open]);

  // Editing an existing draft (F5): apply the seed once per open — mode
  // flips to pick-roles (without touching the remembered preference), the
  // draft's roles pre-select, and the flow lands on the preview step.
  useEffect(() => {
    if (!open || !seed || appliedSeedId.current === seed.draftId) return;
    appliedSeedId.current = seed.draftId;
    setMode("extract");
    setFamiliar(seed.familiar);
    setSelectedRoleIds(new Set(seed.roleIds));
    setCustomName(seed.displayName ?? "");
    setStep("preview");
  }, [open, seed]);

  const chooseMode = useCallback((next: CreateMode) => {
    setMode(next);
    setStep("select");
    try {
      window.localStorage.setItem(MODE_MEMORY_KEY, next);
    } catch {
      // Mode memory is a convenience; private mode may refuse it.
    }
  }, []);

  const checkForArrivedDraft = useCallback(async () => {
    try {
      const res = await fetch("/api/marketplace/crafts/drafts", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; drafts?: Array<{ id?: string }> };
      if (!json.ok || !Array.isArray(json.drafts)) return;
      const arrived = json.drafts.find((d) => d.id && !baselineDraftIds.current.has(d.id));
      if (arrived?.id) {
        setAwaiting(false);
        setGoal("");
        onCreated(arrived.id);
      }
    } catch {
      // Keep polling — the drafts API is local and the next tick retries.
    }
  }, [onCreated]);
  usePausablePoll(() => void checkForArrivedDraft(), 5000, { enabled: open && awaiting });

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    setLoaded(false);
    setError(null);
    fetch("/api/roles", { cache: "no-store", signal: ctl.signal })
      .then(async (res) => {
        const json = (await res.json()) as RolesResponse;
        if (!json.ok) throw new Error(json.error ?? `roles http ${res.status}`);
        const nextRoles = json.roles ?? [];
        setRoles(nextRoles);
        setFamiliar((current) => current || nextRoles[0]?.familiar || "");
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "roles unavailable");
        setRoles([]);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoaded(true);
      });
    return () => ctl.abort();
  }, [open]);

  const familiarOptions = useMemo(
    () => [...new Set(roles.map((role) => role.familiar))].sort().map((id) => ({ value: id, label: id })),
    [roles],
  );
  const visibleRoles = useMemo(
    () => roles.filter((role) => role.familiar === familiar),
    [roles, familiar],
  );
  const selectedRoles = useMemo(
    () => visibleRoles.filter((role) => selectedRoleIds.has(role.id)),
    [visibleRoles, selectedRoleIds],
  );
  const counts = useMemo(() => {
    const unique = {
      skills: new Set<string>(),
      components: new Set<string>(),
      workflows: new Set<string>(),
      capabilities: new Set<string>(),
    };
    for (const role of selectedRoles) {
      for (const skill of [...role.skills, ...role.effective.skills.map((entry) => entry.id)]) unique.skills.add(skill);
      for (const component of [
        ...role.mcpServers,
        ...role.plugins,
        ...role.effective.mcpServers.map((entry) => entry.id),
        ...role.effective.plugins.map((entry) => entry.id),
      ]) unique.components.add(component);
      for (const workflow of [...role.workflows, ...role.effective.workflows.map((entry) => entry.id)]) unique.workflows.add(workflow);
      for (const capability of [
        ...role.tools,
        ...role.effective.tools.map((entry) => entry.id),
        ...role.effective.capabilities.map((entry) => entry.id),
      ]) unique.capabilities.add(capability);
    }
    return {
      skills: unique.skills.size,
      components: unique.components.size,
      workflows: unique.workflows.size,
      capabilities: unique.capabilities.size,
    };
  }, [selectedRoles]);

  const chooseFamiliar = useCallback((next: string) => {
    setFamiliar((current) => {
      if (current) selectionsByFamiliar.current.set(current, selectedRoleIds);
      return next;
    });
    setSelectedRoleIds(selectionsByFamiliar.current.get(next) ?? new Set());
  }, [selectedRoleIds]);

  const toggleRole = useCallback((roleId: string) => {
    setSelectedRoleIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }, []);

  // Preview-before-save (docs/craft-ux.md F3): the extraction builder is pure
  // and client-importable, so the real ledger renders before anything is
  // written. Save still POSTs; the server rebuild stays authoritative.
  const previewDraft = useMemo(() => {
    if (!familiar || selectedRoles.length === 0) return null;
    try {
      return buildCraftDraftFromRoles({
        familiar,
        roles: selectedRoles,
        displayName: customName.trim() || undefined,
      });
    } catch {
      return null;
    }
  }, [customName, familiar, selectedRoles]);

  const save = useCallback(async () => {
    if (!familiar || selectedRoleIds.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Seeded edits are recreate-and-replace (F5): drop the stored draft
      // first so a role change that shifts the derived id leaves no orphan.
      if (seed && appliedSeedId.current === seed.draftId) {
        await fetch(`/api/marketplace/crafts/drafts?id=${encodeURIComponent(seed.draftId)}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      const res = await fetch("/api/marketplace/crafts/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiar,
          roleIds: [...selectedRoleIds],
          ...(customName.trim() ? { displayName: customName.trim() } : {}),
        }),
      });
      const json = (await res.json()) as DraftResponse;
      if (!json.ok || !json.draft?.id) throw new Error(json.error ?? "draft create failed");
      onCreated(json.draft.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "draft create failed");
    } finally {
      setSaving(false);
    }
  }, [customName, familiar, onCreated, seed, selectedRoleIds]);

  /** Describe mode: hand the goal to a familiar as a complete agentic build
   *  prompt (role discovery → draft → plan verification), the same
   *  chat-dispatch contract the skills "Use" action rides — then wait for the
   *  draft to land instead of closing the story here (cave-46wg). */
  const draftWithFamiliar = useCallback(async () => {
    const description = goal.trim();
    if (!description) return;
    // Snapshot the drafts that already exist so arrival = a NEW id, even if
    // the familiar rebuilds an old draft under the same name.
    try {
      const res = await fetch("/api/marketplace/crafts/drafts", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; drafts?: Array<{ id?: string }> };
      baselineDraftIds.current = new Set(
        json.ok && Array.isArray(json.drafts)
          ? json.drafts.map((d) => d.id).filter((id): id is string => Boolean(id))
          : [],
      );
    } catch {
      baselineDraftIds.current = new Set();
    }
    window.dispatchEvent(
      new CustomEvent("cave:agents-new-chat", {
        detail: { initialPrompt: buildCraftAgentPrompt({ description, familiar: familiar || undefined }) },
      }),
    );
    setAwaiting(true);
  }, [familiar, goal]);

  if (!open) return null;

  return (
    <div className="craft-create-drawer__backdrop" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Create Craft"
        tabIndex={-1}
        className="craft-create-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="craft-create-drawer__header">
          <div className="craft-create-drawer__headline">
            <p className="craft-create-drawer__eyebrow">Craft authoring</p>
            <h2 className="craft-create-drawer__title">Create Craft</h2>
            <p className="craft-create-drawer__subtitle">
              {mode === "extract"
                ? step === "preview"
                  ? "Review the extracted bundle before saving the draft."
                  : "Extract a reusable bundle from a familiar's roles."
                : "Describe the Craft — a familiar builds and verifies the draft for you."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring craft-create-drawer__close">
            <Icon name="ph:x" width={16} />
          </button>
        </div>

        <Tabs
          items={CREATE_MODES}
          value={mode}
          onChange={chooseMode}
          ariaLabel="How to create this Craft"
          variant="segment"
          size="sm"
          className="craft-create-drawer__modes"
        />

        {error ? (
          <p role="alert" className="craft-create-drawer__alert">
            {error}
          </p>
        ) : null}

        {mode === "describe" ? (
          <>
            <label className="craft-create-drawer__field">
              <span>What should this Craft equip?</span>
              <textarea
                className="focus-ring craft-create-drawer__goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={4}
                placeholder="e.g. Everything my reviewer uses to triage PRs — the review skills, the GitHub tools, and the weekly summary workflow."
              />
            </label>
            <label className="craft-create-drawer__field">
              <span>Preferred familiar (optional)</span>
              <StandardSelect
                label="Preferred familiar"
                value={familiar}
                onChange={chooseFamiliar}
                options={[{ value: "", label: "Let the familiar decide" }, ...familiarOptions]}
                className="focus-ring craft-create-drawer__select"
              />
            </label>
            <section className="craft-create-drawer__how" aria-label="How agentic drafting works">
              <h3>What happens next</h3>
              <ol>
                <li>A chat opens with the build brief and the drafts API contract.</li>
                <li>The familiar inspects your roles, creates the draft, and verifies its install plan.</li>
                <li>The finished draft appears here in Crafts, ready to review and equip.</li>
              </ol>
            </section>
            {awaiting ? (
              <div role="status" className="craft-create-drawer__awaiting">
                <Icon
                  name="ph:circle-notch-bold"
                  width={14}
                  aria-hidden
                  className="craft-create-drawer__awaiting-spin animate-spin motion-reduce:animate-none"
                />
                <span>
                  Waiting for the familiar&apos;s draft — watch the chat or keep browsing. The draft opens here when it
                  lands.
                </span>
                <button
                  type="button"
                  onClick={() => setAwaiting(false)}
                  className="focus-ring craft-create-drawer__awaiting-stop"
                >
                  Stop waiting
                </button>
              </div>
            ) : null}
          </>
        ) : step === "preview" ? (
          <>
            <section className="craft-create-drawer__roles" aria-label="Draft preview">
              <h3>Draft preview</h3>
              {previewDraft ? (
                <>
                  <p className="craft-create-drawer__status">
                    <strong>{previewDraft.plugin.displayName}</strong>
                    {" · "}
                    {selectedRoles.length} {selectedRoles.length === 1 ? "role" : "roles"} from {familiar}.
                    Review the extracted bundle, then save.
                  </p>
                  <label className="craft-create-drawer__field">
                    <span>Name (optional)</span>
                    <input
                      type="text"
                      className="focus-ring craft-create-drawer__name"
                      value={customName}
                      maxLength={120}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder={previewDraft.plugin.displayName}
                    />
                  </label>
                  <CraftDraftPreview
                    groups={extractionLedgerGroups(previewDraft.extraction.ledger)}
                    ariaLabel="Extraction preview"
                  />
                </>
              ) : (
                <p className="craft-create-drawer__status">Select at least one role to preview the draft.</p>
              )}
            </section>
          </>
        ) : (
          <>
            <label className="craft-create-drawer__field">
              <span>Familiar</span>
              <StandardSelect
                label="Familiar"
                value={familiar}
                onChange={chooseFamiliar}
                options={familiarOptions}
                className="focus-ring craft-create-drawer__select"
              />
            </label>

            <section className="craft-create-drawer__roles" aria-label="Roles to extract">
              <h3>Roles</h3>
              {!loaded ? (
                <p className="craft-create-drawer__status">Loading roles...</p>
              ) : visibleRoles.length === 0 ? (
                <p className="craft-create-drawer__status">No roles found for this familiar.</p>
              ) : (
                <div className="craft-create-drawer__role-list">
                  {visibleRoles.map((role) => (
                    <label key={`${role.familiar}:${role.id}`} className="craft-create-drawer__role">
                      <input
                        type="checkbox"
                        checked={selectedRoleIds.has(role.id)}
                        onChange={() => toggleRole(role.id)}
                      />
                      <span>
                        <strong>{role.name}</strong>
                        <em>{role.description ?? `${role.skills.length} skills · ${role.tools.length} capabilities`}</em>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="craft-draft-ledger" aria-label="Selection summary">
              <h3>Selection summary</h3>
              <div className="craft-draft-ledger__stats">
                <span><strong>{counts.components}</strong> components</span>
                <span><strong>{counts.skills}</strong> skills</span>
                <span><strong>{counts.workflows}</strong> workflows</span>
                <span><strong>{counts.capabilities}</strong> capabilities</span>
              </div>
            </section>
          </>
        )}

        <div className="craft-create-drawer__actions">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          {mode === "describe" ? (
            <Button
              variant="primary"
              size="sm"
              leadingIcon="ph:sparkle"
              disabled={!goal.trim() || awaiting}
              onClick={() => void draftWithFamiliar()}
            >
              {awaiting ? "Drafting…" : "Draft with familiar"}
            </Button>
          ) : step === "preview" ? (
            <>
              <Button variant="secondary" size="sm" leadingIcon="ph:arrow-left" onClick={() => setStep("select")}>
                Adjust roles
              </Button>
              <Button
                variant="primary"
                size="sm"
                leadingIcon="ph:package-bold"
                loading={saving}
                disabled={!previewDraft}
                onClick={save}
              >
                {seed && appliedSeedId.current === seed.draftId ? "Save changes" : "Save draft"}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leadingIcon="ph:magnifying-glass-bold"
              disabled={!familiar || selectedRoleIds.size === 0}
              onClick={() => setStep("preview")}
            >
              Preview draft
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
