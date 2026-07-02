"use client";

// Skill Browser — a three-column view of local skills: a category rail (All /
// Claude Code / Generic with counts), a searchable card list, and a detail pane
// that renders the selected skill's SKILL.md. Replaces the old flat list + slide
// -over drawer for the Roles → Skills tab.

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { MarkdownBlock } from "@/components/message-bubble";
import { copyText } from "@/lib/clipboard";

export type SkillBrowserEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: string;
  tags?: string[];
  /** Absolute path to the skill's SKILL.md. */
  path: string;
  /** Scan scope: "user" (~/.claude/skills) or "global" (Coven shared skills). */
  familiar: string;
};

type Category = "all" | "claude" | "generic";
type PreviewState = {
  status: "idle" | "loading" | "loaded" | "error";
  text: string | null;
  error: string | null;
};

// The scan tags user skills (~/.claude/skills) as "user" and shared Coven skills
// as "global"; surface those as "Claude Code" vs "Generic".
function categoryOf(skill: SkillBrowserEntry): "claude" | "generic" {
  return skill.familiar === "user" ? "claude" : "generic";
}
const CATEGORY_LABEL: Record<"claude" | "generic", string> = {
  claude: "Claude Code",
  generic: "Generic",
};

const RAIL: { id: Category; label: string; icon: IconName }[] = [
  { id: "all", label: "All Skills", icon: "ph:squares-four" },
  { id: "claude", label: "Claude Code", icon: "ph:terminal-window" },
  { id: "generic", label: "Generic", icon: "ph:puzzle-piece" },
];

function skillKey(skill: SkillBrowserEntry): string {
  return `${skill.familiar}:${skill.id}:${skill.path}`;
}

// SKILL.md opens with a YAML frontmatter block (name/description/tags) already
// surfaced as the title/badges — strip it so the body reads as prose.
function stripFrontmatter(text: string): string {
  return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "").trimStart();
}

function matchesQuery(skill: SkillBrowserEntry, query: string): boolean {
  if (!query) return true;
  const hay = [skill.id, skill.name, skill.description, skill.kind, skill.familiar, ...(skill.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(query.toLowerCase());
}

// Collapse the absolute SKILL.md path to a friendly directory (drops /SKILL.md,
// tildes the home prefix) for the detail header.
function displayPath(path: string): string {
  const dir = path.replace(/\/SKILL\.md$/i, "");
  return dir.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

// Reveal a directory in the OS file manager. On desktop this shells out via
// Tauri; on the web there is no filesystem bridge, so we copy the path to the
// clipboard instead and report which happened so the UI can say so.
async function revealDir(dir: string): Promise<"revealed" | "copied"> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("shell_open", { url: dir });
      return "revealed";
    } catch {
      // fall through to clipboard
    }
  }
  await copyText(dir);
  return "copied";
}

export function SkillBrowser({
  skills,
  loaded,
  query,
  onClearQuery,
  onCreateSkill,
  onChanged,
}: {
  skills: SkillBrowserEntry[];
  loaded: boolean;
  query: string;
  onClearQuery: () => void;
  onCreateSkill?: () => void;
  /** Called after a skill is deleted so the parent can re-scan. */
  onChanged?: () => void;
}) {
  const [category, setCategory] = useState<Category>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle", text: null, error: null });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<"reveal" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: skills.length,
      claude: skills.filter((s) => categoryOf(s) === "claude").length,
      generic: skills.filter((s) => categoryOf(s) === "generic").length,
    }),
    [skills],
  );

  const visible = useMemo(
    () => skills.filter((s) => (category === "all" || categoryOf(s) === category) && matchesQuery(s, query)),
    [skills, category, query],
  );

  // Keep a valid selection: fall back to the first visible skill when the
  // current pick is filtered out (or nothing is selected yet).
  const selected = useMemo(
    () => visible.find((s) => skillKey(s) === selectedKey) ?? visible[0] ?? null,
    [visible, selectedKey],
  );
  const selectedPath = selected?.path ?? null;

  // Load the selected skill's SKILL.md for the detail pane. Only paths under the
  // allow-listed roots return content; anything else 403s → fall back to the
  // scanned description so the pane never goes blank.
  useEffect(() => {
    if (!selectedPath) {
      setPreview({ status: "idle", text: null, error: null });
      return;
    }
    let cancelled = false;
    setPreview({ status: "loading", text: null, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/skills/file?path=${encodeURIComponent(selectedPath)}`, { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; text?: string; error?: string };
        if (cancelled) return;
        if (!json.ok) setPreview({ status: "error", text: null, error: json.error ?? `http ${res.status}` });
        else setPreview({ status: "loaded", text: json.text ?? "", error: null });
      } catch (err) {
        if (!cancelled) setPreview({ status: "error", text: null, error: err instanceof Error ? err.message : "fetch failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  const body = preview.text ? stripFrontmatter(preview.text) : "";

  // Reset the transient action state whenever the selection changes so a stale
  // "confirm delete" or notice never carries over to a different skill.
  useEffect(() => {
    setConfirmingDelete(false);
    setNotice(null);
  }, [selectedPath]);

  async function handleReveal() {
    if (!selectedPath || busy) return;
    setBusy("reveal");
    try {
      const dir = selectedPath.replace(/\/SKILL\.md$/i, "");
      const how = await revealDir(dir);
      setNotice(how === "revealed" ? "Opened in file manager" : "Path copied to clipboard");
    } catch {
      setNotice("Could not open folder");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!selectedPath || busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setNotice(null);
      return;
    }
    setBusy("delete");
    try {
      const res = await fetch(`/api/skills/local?path=${encodeURIComponent(selectedPath)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setNotice(json.error ? `Delete failed: ${json.error}` : `Delete failed (${res.status})`);
        return;
      }
      setConfirmingDelete(false);
      setSelectedKey(null);
      onChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? `Delete failed: ${err.message}` : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="skill-browser" role="group" aria-label="Skill browser">
      {/* ── Category rail ────────────────────────────────────────────── */}
      <nav className="skill-browser__rail" aria-label="Skill categories">
        {RAIL.map((cat) => {
          const count = counts[cat.id === "all" ? "all" : cat.id];
          const active = category === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              className={`skill-browser__cat${active ? " is-active" : ""}`}
              aria-pressed={active}
              onClick={() => setCategory(cat.id)}
            >
              <Icon name={cat.icon} width={15} className="skill-browser__cat-icon" aria-hidden />
              <span className="skill-browser__cat-label">{cat.label}</span>
              <span className="skill-browser__cat-count">{count}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Card list ────────────────────────────────────────────────── */}
      <div className="skill-browser__list" role="listbox" aria-label="Skills">
        {!loaded ? (
          <div className="skill-browser__note" aria-hidden>
            Loading skills…
          </div>
        ) : skills.length === 0 ? (
          <div className="skill-browser__empty">
            <Icon name="ph:puzzle-piece" width={22} aria-hidden />
            <p>No local skills found.</p>
            {onCreateSkill ? (
              <button type="button" className="skill-browser__empty-action" onClick={onCreateSkill}>
                Open Capabilities
              </button>
            ) : null}
          </div>
        ) : visible.length === 0 ? (
          <div className="skill-browser__empty">
            <p>No skills match “{query.trim()}”.</p>
            <button type="button" className="skill-browser__empty-action" onClick={onClearQuery}>
              Clear search
            </button>
          </div>
        ) : (
          visible.map((skill) => {
            const key = skillKey(skill);
            const isSel = selected != null && skillKey(selected) === key;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={isSel}
                className={`skill-browser__card${isSel ? " is-active" : ""}`}
                onClick={() => setSelectedKey(key)}
              >
                <span className="skill-browser__card-main">
                  <span className="skill-browser__card-name">{skill.name}</span>
                  {skill.description ? (
                    <span className="skill-browser__card-desc">{skill.description}</span>
                  ) : null}
                </span>
                <span className="skill-browser__badge">{CATEGORY_LABEL[categoryOf(skill)]}</span>
              </button>
            );
          })
        )}
      </div>

      {/* ── Detail pane ──────────────────────────────────────────────── */}
      <div className="skill-browser__detail">
        {selected ? (
          <>
            <div className="skill-browser__detail-head">
              <div className="skill-browser__detail-titlerow">
                <h2 className="skill-browser__detail-name">{selected.name}</h2>
                <div className="skill-browser__actions">
                  <button
                    type="button"
                    className="skill-browser__action"
                    onClick={handleReveal}
                    disabled={busy != null}
                    title="Reveal skill folder"
                    aria-label="Reveal skill folder"
                  >
                    <Icon name="ph:folder-open" width={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={`skill-browser__action skill-browser__action--danger${confirmingDelete ? " is-confirming" : ""}`}
                    onClick={handleDelete}
                    disabled={busy != null}
                    title={confirmingDelete ? "Confirm delete" : "Delete skill"}
                    aria-label={confirmingDelete ? "Confirm delete skill" : "Delete skill"}
                  >
                    <Icon name="ph:trash" width={16} aria-hidden />
                    {confirmingDelete ? <span className="skill-browser__action-label">Delete?</span> : null}
                  </button>
                </div>
              </div>
              <p className="skill-browser__detail-path" title={selected.path}>
                {displayPath(selected.path)}
              </p>
              <div className="skill-browser__detail-meta">
                <span className="skill-browser__badge">{CATEGORY_LABEL[categoryOf(selected)]}</span>
                {selected.version ? <span className="skill-browser__badge">v{selected.version}</span> : null}
                {(selected.tags ?? []).slice(0, 6).map((t) => (
                  <span key={t} className="skill-browser__tag">
                    {t}
                  </span>
                ))}
              </div>
              {notice ? (
                <p className="skill-browser__notice" role="status">
                  {notice}
                </p>
              ) : null}
            </div>
            <div className="skill-browser__detail-body">
              {preview.status === "loading" ? (
                <div className="skill-browser__skeleton" aria-hidden>
                  {["90%", "96%", "70%", "88%", "60%"].map((w, i) => (
                    <span key={i} style={{ width: w }} />
                  ))}
                </div>
              ) : preview.status === "loaded" && body ? (
                <MarkdownBlock text={body} className="cave-md--expanded" />
              ) : (
                // 403 (path outside allow-listed roots), empty file, or error —
                // show the scanned description so the pane is never blank.
                <p className="skill-browser__fallback">
                  {selected.description || "No preview available for this skill."}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="skill-browser__detail-empty">Select a skill to view its details.</div>
        )}
      </div>
    </div>
  );
}
