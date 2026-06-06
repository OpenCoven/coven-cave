# Plugins, Skills & Capabilities — World-Class Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Plugins / Skills / Capabilities view in coven-cave fully functional, dynamically data-driven, and delightful — covering plugin launch actions, skill detail + per-familiar assignment drawer, capability deep-dives, version display, and polished empty/loading states throughout.

**Architecture:** Each tab gets its own focused sub-component with live data from existing daemon APIs (`/api/harnesses`, `/api/skills`, `/api/capabilities`). New components (PluginCard, SkillCard, SkillDetailDrawer, CapabilityCard) are extracted from the monolithic `plugins-view.tsx`. State is local per-tab with a shared refresh mechanism; no global store needed. The workspace passes `familiars` through to `PluginsView` so the skill drawer can show per-familiar assignment.

**Tech Stack:** Next.js 15 app router, React 18 hooks, Tailwind v4 (`[var(--token)]`), Phosphor icons via `Icon` component (`ph:*`), TypeScript strict, existing `callDaemon` helper at `src/lib/coven-daemon.ts`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/components/plugins-view.tsx` | Wire new components; remove inlined card/capability code |
| Create | `src/components/plugin-card.tsx` | Single harness card: install status, version, Launch button |
| Create | `src/components/skill-card.tsx` | Single skill card with description + version, opens drawer |
| Create | `src/components/skill-detail-drawer.tsx` | Slide-in drawer: stats, tags, per-familiar assignment scaffold |
| Create | `src/components/capability-card.tsx` | Harness capability manifest card (extracted from plugins-view) + `CapabilitiesGrid` |
| Modify | `src/components/workspace.tsx` | Pass `familiars` prop to `PluginsView` |
| Modify | `src/lib/icon.tsx` | Add `ph:toggle-left-bold`, `ph:rocket-launch-bold`, `ph:info-bold`, `ph:x-bold`, `ph:tag-bold`, `ph:arrow-square-out-bold` |

---

## Task 1: Icon allowlist

**Files:**
- Modify: `src/lib/icon.tsx`

- [ ] **1.1 Add after `"ph:plug"` in the allowlist array:**

```typescript
  "ph:toggle-left-bold",
  "ph:rocket-launch-bold",
  "ph:info-bold",
  "ph:x-bold",
  "ph:tag-bold",
  "ph:arrow-square-out-bold",
```

- [ ] **1.2 Typecheck**
```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave && pnpm typecheck 2>&1 | grep -v "eval-loop-panel" | grep "error TS"
```
Expected: no output (exit code 1 = clean).

- [ ] **1.3 Commit**
```bash
git add src/lib/icon.tsx && git commit -m "feat(icons): add toggle, rocket, info, x, tag, arrow-square-out"
```

---

## Task 2: `plugin-card.tsx` — harness card with launch + status

**Files:**
- Create: `src/components/plugin-card.tsx`

- [ ] **2.1 Create the file with this exact content:**

```typescript
"use client";
import { Icon } from "@/lib/icon";

export type HarnessReport = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
};

const HARNESS_TAGLINE: Record<string, string> = {
  codex: "Run Codex sessions from this Cave",
  claude: "Drive Claude Code from a familiar",
  openclaw: "Bring OpenClaw into the Coven",
  copilot: "Wire up GitHub Copilot CLI",
  opencode: "Run OpenCode locally",
  gemini: "Talk to Google Gemini CLI",
  hermes: "Light a Hermes runtime",
  openhands: "Open up OpenHands tasks",
  aider: "Pair with Aider in-repo",
};

export function PluginCard({ harness, onLaunch }: { harness: HarnessReport; onLaunch: () => void }) {
  const initial = (harness.label.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const tagline = HARNESS_TAGLINE[harness.id] ?? `Run ${harness.label} from a familiar`;
  return (
    <div className={`group flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)] px-4 py-4 transition-colors ${harness.installed ? "hover:border-[var(--border-strong)]" : "opacity-60"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[15px] font-semibold text-[var(--text-primary)]">{initial}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{harness.label}</p>
          <p className="truncate text-[12px] text-[var(--text-muted)]">{tagline}</p>
        </div>
        {harness.installed ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--accent-presence)]" title="Installed">
            <Icon name="ph:check-bold" width={12} />
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-[var(--border-hairline)] px-2 py-px text-[10px] text-[var(--text-muted)]">not found</span>
        )}
      </div>
      {harness.installed && (harness.version || harness.path) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
          {harness.version && <span>{harness.version}</span>}
          {harness.path && <span className="truncate font-mono opacity-60">{harness.path.replace(/^\/Users\/[^/]+/, "~")}</span>}
        </div>
      )}
      {harness.installed ? (
        <div className="flex items-center gap-2 pt-1">
          {harness.chatSupported ? (
            <button onClick={onLaunch} className="flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-85">
              <Icon name="ph:rocket-launch-bold" width={11} /> Launch
            </button>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">Chat not yet wired</span>
          )}
          <a href={`https://github.com/search?q=${encodeURIComponent(harness.label)}`} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <Icon name="ph:arrow-square-out-bold" width={11} /> Docs
          </a>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--text-muted)]">Install <code className="font-mono">{harness.binary}</code> on your PATH to enable.</p>
      )}
    </div>
  );
}
```

- [ ] **2.2 Typecheck** — `pnpm typecheck 2>&1 | grep -v "eval-loop-panel" | grep "error TS"` — no output expected.

- [ ] **2.3 Commit** — `git add src/components/plugin-card.tsx && git commit -m "feat(plugins): PluginCard with launch button, version, install status"`

---

## Task 3: `skill-detail-drawer.tsx`

**Files:**
- Create: `src/components/skill-detail-drawer.tsx`

Skills from `/api/skills` have: `id`, `name`, `owner?`, `category?`, `tags?[]`, `score?`, `description?`, `version?`, `effective_rate?`, `applied_rate?`, `completion_rate?`, `fallback_rate?`.

- [ ] **3.1 Create the file:**

```typescript
"use client";
import { useEffect } from "react";
import { Icon } from "@/lib/icon";

export type SkillEntry = {
  id: string; name: string; owner?: string; category?: string; tags?: string[];
  score?: number; description?: string; version?: string;
  effective_rate?: number; applied_rate?: number; completion_rate?: number; fallback_rate?: number;
};
export type FamiliarForSkill = { id: string; display_name: string };

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-[var(--bg-raised)] px-3 py-2 text-center">
      <span className="text-[15px] font-semibold text-[var(--text-primary)] tabular-nums">{Math.round(value * 100)}%</span>
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
    </div>
  );
}

export function SkillDetailDrawer({ skill, familiars, onClose }: { skill: SkillEntry | null; familiars: FamiliarForSkill[]; onClose: () => void }) {
  useEffect(() => {
    if (!skill) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [skill, onClose]);
  if (!skill) return null;
  const initial = (skill.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const hasStats = skill.effective_rate !== undefined || skill.applied_rate !== undefined || skill.completion_rate !== undefined || skill.fallback_rate !== undefined;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-sm flex-col bg-[var(--bg-panel)] shadow-2xl sm:max-w-[380px]">
        <div className="flex items-start gap-3 border-b border-[var(--border-hairline)] px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[15px] font-semibold text-[var(--text-primary)]">{initial}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[var(--text-primary)]">{skill.name}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{[skill.owner, skill.category, skill.version ? `v${skill.version}` : undefined].filter(Boolean).join(" · ")}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]" aria-label="Close">
            <Icon name="ph:x-bold" width={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-5 px-5 py-4">
          {skill.description && <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{skill.description}</p>}
          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skill.tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                  <Icon name="ph:tag-bold" width={9} />{tag}
                </span>
              ))}
            </div>
          )}
          {hasStats && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">Performance</p>
              <div className="grid grid-cols-2 gap-2">
                {skill.effective_rate !== undefined && <StatPill label="Effective" value={skill.effective_rate} />}
                {skill.applied_rate !== undefined && <StatPill label="Applied" value={skill.applied_rate} />}
                {skill.completion_rate !== undefined && <StatPill label="Completion" value={skill.completion_rate} />}
                {skill.fallback_rate !== undefined && <StatPill label="Fallback" value={skill.fallback_rate} />}
              </div>
            </div>
          )}
          {familiars.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">Assigned to</p>
              <div className="space-y-1">
                {familiars.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[var(--bg-raised)]">
                    <span className="text-[12px] text-[var(--text-secondary)]">{f.display_name}</span>
                    <span className="text-[var(--text-muted)] opacity-40"><Icon name="ph:toggle-left-bold" width={20} /></span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-[var(--text-muted)] opacity-60">Assignment writes to daemon config — coming soon.</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
```

- [ ] **3.2 Typecheck** — no output expected.

- [ ] **3.3 Commit** — `git add src/components/skill-detail-drawer.tsx && git commit -m "feat(skills): SkillDetailDrawer — stats, tags, familiar assignment scaffold"`

---

## Task 4: `skill-card.tsx`

**Files:**
- Create: `src/components/skill-card.tsx`

- [ ] **4.1 Create the file:**

```typescript
"use client";
import { Icon } from "@/lib/icon";
import type { SkillEntry } from "@/components/skill-detail-drawer";

export function SkillCard({ skill, onClick }: { skill: SkillEntry; onClick: () => void }) {
  const initial = (skill.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const meta = [skill.owner, skill.category].filter(Boolean).join(" · ") || "Skill";
  return (
    <button onClick={onClick} className="group flex min-w-0 items-center gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)] px-4 py-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[15px] font-semibold text-[var(--text-primary)]">{initial}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">{skill.name}</span>
        <span className="block truncate text-[12px] text-[var(--text-muted)]">{meta}</span>
        {skill.description && <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)] opacity-70">{skill.description}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {skill.version && <span className="rounded-full bg-[var(--bg-raised)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">v{skill.version}</span>}
        <Icon name="ph:info-bold" width={13} className="text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </button>
  );
}
```

- [ ] **4.2 Typecheck** — no output expected.

- [ ] **4.3 Commit** — `git add src/components/skill-card.tsx && git commit -m "feat(skills): SkillCard with description preview and version badge"`

---

## Task 5: `capability-card.tsx`

**Files:**
- Create: `src/components/capability-card.tsx`

Extract `HarnessCapabilityCard` + `CapabilitiesView` out of `plugins-view.tsx`. Use `[var(--token)]` tokens (Tailwind v4) instead of Tailwind semantic names.

- [ ] **5.1 Create the file:**

```typescript
"use client";
import { Icon } from "@/lib/icon";

export type GlobalInstructions = { present: boolean; path?: string; byte_count?: number };
export type HarnessCapSkill = { id: string; name: string; description?: string; path: string };
export type HarnessCapPlugin = { id: string; name: string; kind: string; enabled: boolean; command?: string; args?: string[] };
export type CapWarning = { kind: string; path: string; message: string };
export type HarnessCapabilityManifest = {
  harness_id: string; scanned_at: string;
  global_instructions: GlobalInstructions;
  skills: HarnessCapSkill[]; plugins: HarnessCapPlugin[]; warnings: CapWarning[];
};

const HARNESS_LABEL: Record<string, string> = { codex: "Codex", claude: "Claude Code", openclaw: "OpenClaw", copilot: "GitHub Copilot" };

export function CapabilityCard({ manifest }: { manifest: HarnessCapabilityManifest }) {
  const label = HARNESS_LABEL[manifest.harness_id] ?? manifest.harness_id;
  const initial = label[0]?.toUpperCase() ?? "?";
  const total = (manifest.global_instructions.present ? 1 : 0) + manifest.skills.length + manifest.plugins.length;
  return (
    <div className="min-w-0 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-hairline)] px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[13px] font-semibold text-[var(--text-primary)]">{initial}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">{label}</p>
          <p className="text-[11px] text-[var(--text-muted)]">{total === 0 ? "No config found" : `${total} item${total === 1 ? "" : "s"} configured`}</p>
        </div>
        <span className="text-[10px] text-[var(--text-muted)] sm:ml-auto">{new Date(manifest.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="divide-y divide-[var(--border-hairline)]">
        {manifest.global_instructions.present ? (
          <div className="flex items-start gap-3 px-4 py-3">
            <Icon name="ph:note-pencil" className="mt-0.5 shrink-0 text-[var(--text-muted)]" width="0.85rem" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[var(--text-primary)]">Global instructions</p>
              <p className="break-all text-[11px] text-[var(--text-muted)] sm:truncate">{manifest.global_instructions.path?.replace(/^\/Users\/[^/]+/, "~") ?? "—"}</p>
              {manifest.global_instructions.byte_count !== undefined && <p className="text-[10px] text-[var(--text-muted)]">{(manifest.global_instructions.byte_count / 1024).toFixed(1)} KB</p>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3 text-[12px] text-[var(--text-muted)]">
            <Icon name="ph:note-pencil" className="shrink-0" width="0.85rem" /><span>No global instructions file found</span>
          </div>
        )}
        {manifest.skills.length > 0 && (
          <div className="px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">Automations / skills · {manifest.skills.length}</p>
            <ul className="space-y-1.5">
              {manifest.skills.map((s) => (
                <li key={s.id} className="flex items-start gap-2">
                  <Icon name="ph:sparkle" className="mt-0.5 shrink-0 text-[var(--text-muted)]" width="0.75rem" />
                  <div className="min-w-0">
                    <p className="break-words text-[12px] text-[var(--text-primary)]">{s.name}</p>
                    {s.description && <p className="break-words text-[11px] text-[var(--text-muted)]">{s.description}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {manifest.plugins.length > 0 && (
          <div className="px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">Plugins · {manifest.plugins.length}</p>
            <ul className="space-y-1.5">
              {manifest.plugins.map((p) => (
                <li key={p.id} className="flex items-start gap-2">
                  <Icon name="ph:plug" className="mt-0.5 shrink-0 text-[var(--text-muted)]" width="0.75rem" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 break-words text-[12px] text-[var(--text-primary)]">{p.name}</p>
                      <span className="rounded-full bg-[var(--bg-raised)] px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--text-muted)]">{p.kind}</span>
                      {!p.enabled && <span className="rounded-full bg-[var(--bg-raised)] px-1.5 py-px text-[9px] text-[var(--text-muted)]">disabled</span>}
                    </div>
                    {p.command && <p className="break-all font-mono text-[11px] text-[var(--text-muted)] sm:truncate">{p.command} {p.args?.join(" ")}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {manifest.warnings.length > 0 && (
          <div className="px-4 py-3">
            {manifest.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--text-muted)]">
                <Icon name="ph:warning-fill" width={11} aria-hidden /><span className="min-w-0 break-words">{w.message}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CapabilitiesGrid({ items, loaded, error, onRefresh }: { items: HarnessCapabilityManifest[]; loaded: boolean; error: string | null; onRefresh: () => void }) {
  if (!loaded) return (
    <div className="flex flex-col gap-4">
      {[0, 1].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]" />)}
    </div>
  );
  if (error) return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-card)] px-4 py-6">
      <p className="mb-3 text-[13px] text-[var(--text-muted)]">{error === "daemon offline" ? "Coven daemon is offline — harness capabilities require a running daemon." : `Could not load capabilities: ${error}`}</p>
      <button onClick={onRefresh} className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-card)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)]">Retry</button>
    </div>
  );
  if (items.length === 0) return (
    <p className="rounded-lg border border-[var(--border-hairline)] px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">No harness capabilities found. Install Codex or Claude Code and restart the daemon.</p>
  );
  return (
    <div className="flex flex-col gap-6">
      {items.map((m) => <CapabilityCard key={m.harness_id} manifest={m} />)}
      <div className="flex justify-end">
        <button onClick={onRefresh} className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <Icon name="ph:arrows-clockwise-bold" width="0.75rem" />Refresh
        </button>
      </div>
    </div>
  );
}
```

- [ ] **5.2 Typecheck** — no output expected.

- [ ] **5.3 Commit** — `git add src/components/capability-card.tsx && git commit -m "feat(capabilities): extract CapabilityCard + CapabilitiesGrid, migrate to CSS vars"`

---

## Task 6: Wire new components into `plugins-view.tsx`

**Files:**
- Modify: `src/components/plugins-view.tsx`

Replace the inlined `PluginGrid` card, `SkillGrid` card, `CapabilitiesView`, and `HarnessCapabilityCard` bodies with the new focused components. Add `familiars` prop and `SkillDetailDrawer` state.

- [ ] **6.1 Update the imports at the top of `plugins-view.tsx`:**

Replace the existing imports block with:

```typescript
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { PluginCard, type HarnessReport } from "@/components/plugin-card";
import { SkillCard } from "@/components/skill-card";
import { SkillDetailDrawer, type SkillEntry, type FamiliarForSkill } from "@/components/skill-detail-drawer";
import { CapabilitiesGrid, type HarnessCapabilityManifest } from "@/components/capability-card";
```

- [ ] **6.2 Add `familiars` to the `Props` type:**

Change:
```typescript
type Props = {
  onOpenChat: () => void;
  onCreateReminder?: () => void;
  onCreateSkill?: () => void;
  onCreatePlugin?: () => void;
};
```
To:
```typescript
type Props = {
  onOpenChat: () => void;
  onCreateReminder?: () => void;
  onCreateSkill?: () => void;
  onCreatePlugin?: () => void;
  familiars?: FamiliarForSkill[];
};
```

- [ ] **6.3 Add `selectedSkill` state and pass `familiars` through:**

Inside `PluginsView`, after the existing `useState` declarations, add:
```typescript
const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null);
```

Destructure `familiars = []` from props.

- [ ] **6.4 Replace `PluginGrid` body** (the `items.map(...)` returning the inline card) with:

```typescript
{filteredHarnesses.map((h) => (
  <PluginCard key={h.id} harness={h} onLaunch={onOpenChat} />
))}
```

Keep the surrounding `<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">` wrapper.

- [ ] **6.5 Replace `SkillGrid` body** (the `items.map(...)` returning the inline card) with:

```typescript
{filteredSkills.map((s) => (
  <SkillCard key={s.id} skill={s} onClick={() => setSelectedSkill(s)} />
))}
```

Keep the surrounding `<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">` wrapper.

- [ ] **6.6 Replace `CapabilitiesView` render** in the `tab === "capabilities"` branch:

```typescript
<CapabilitiesGrid
  items={capabilities.filter((c) => !query || c.harness_id.toLowerCase().includes(query.toLowerCase()))}
  loaded={capabilitiesLoaded}
  error={capabilitiesError}
  onRefresh={() => { setCapabilitiesRefresh(true); setCapabilitiesLoaded(false); }}
/>
```

- [ ] **6.7 Add `SkillDetailDrawer` at the bottom of the `PluginsView` return, just before the closing `</div>`:**

```typescript
<SkillDetailDrawer
  skill={selectedSkill}
  familiars={familiars}
  onClose={() => setSelectedSkill(null)}
/>
```

- [ ] **6.8 Remove the now-unused inlined components** from `plugins-view.tsx`:
  - Delete `function PluginGrid(...)` and its inner card `<button>` block
  - Delete `function SkillGrid(...)` and its inner card `<div>` block
  - Delete `function CapabilitiesView(...)`
  - Delete `function HarnessCapabilityCard(...)`
  - Keep `GridSkeleton`, `CreateDropdown`, and the type declarations at the top that aren't moved

- [ ] **6.9 Typecheck**
```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave && pnpm typecheck 2>&1 | grep -v "eval-loop-panel" | grep "error TS"
```
Expected: no output.

- [ ] **6.10 Commit**
```bash
git add src/components/plugins-view.tsx && git commit -m "refactor(plugins-view): wire PluginCard, SkillCard, CapabilitiesGrid, SkillDetailDrawer"
```

---

## Task 7: Pass `familiars` from `workspace.tsx` to `PluginsView`

**Files:**
- Modify: `src/components/workspace.tsx`

`workspace.tsx` already has `familiars` state. It just needs to pass it down.

- [ ] **7.1 Find the `<PluginsView` block (around line 718) and add the `familiars` prop:**

Change:
```typescript
<PluginsView
  onOpenChat={() => {
    setMode("chats");
    setTimeout(() => routerRef.current?.newChat(), 0);
  }}
/>
```
To:
```typescript
<PluginsView
  onOpenChat={() => {
    setMode("chats");
    setTimeout(() => routerRef.current?.newChat(), 0);
  }}
  familiars={familiars.map((f) => ({ id: f.id, display_name: f.display_name }))}
/>
```

- [ ] **7.2 Typecheck**
```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave && pnpm typecheck 2>&1 | grep -v "eval-loop-panel" | grep "error TS"
```
Expected: no output.

- [ ] **7.3 Commit**
```bash
git add src/components/workspace.tsx && git commit -m "feat(workspace): pass familiars to PluginsView for skill assignment drawer"
```

---

## Task 8: Visual polish — headline, empty state, section headers

**Files:**
- Modify: `src/components/plugins-view.tsx`

The "Make Cave work your way" headline is nice but the page below it feels empty on first load. Add a subtle subheading and move the filter chips to sit closer to the content.

- [ ] **8.1 Update the headline block** in `plugins-view.tsx`:

Change:
```typescript
<h1 className="text-center text-[26px] font-normal tracking-tight text-foreground sm:text-[34px]">
  Make Cave work your way
</h1>
```
To:
```typescript
<div className="text-center">
  <h1 className="text-[26px] font-normal tracking-tight text-[var(--text-primary)] sm:text-[34px]">
    Make Cave work your way
  </h1>
  <p className="mt-2 text-[13px] text-[var(--text-muted)]">
    {tab === "plugins"
      ? "Connect harnesses and tools to extend what your familiars can do."
      : tab === "skills"
      ? "Skills teach your familiars how to handle specific tasks consistently."
      : "What each harness knows about — its instructions, skills, and plugins."}
  </p>
</div>
```

- [ ] **8.2 Typecheck** — no output expected.

- [ ] **8.3 Commit**
```bash
git add src/components/plugins-view.tsx && git commit -m "polish(plugins): contextual subheading per tab, use CSS var tokens on headline"
```

---

## Task 9: Push and verify

- [ ] **9.1 Final typecheck**
```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave && pnpm typecheck 2>&1 | grep -v "eval-loop-panel" | grep "error TS"
```
Expected: no output.

- [ ] **9.2 Dev server smoke test**

Ensure `pnpm dev` is running at `http://localhost:3000`. Open the Plugins mode, check:
- Plugins tab: cards render with Launch / install status / version
- Skills tab: cards render, clicking one opens the drawer with tags + stats + familiar list
- Capabilities tab: manifests render (or "daemon offline" gracefully)

- [ ] **9.3 Push**
```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave && git push
```

---

## Board card

After saving this plan, add it to the coven-cave GitHub board as a card under the `In Progress` column with the title:
**"feat: world-class Plugins / Skills / Capabilities view"**

Reference this file: `docs/superpowers/plans/2026-06-05-plugins-skills-capabilities.md`
