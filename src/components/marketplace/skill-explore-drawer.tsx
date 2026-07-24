"use client";

import "@/styles/cave-md.css";

import { useEffect, useRef, useState, type JSX } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { MarkdownBlock } from "@/components/message-bubble";
import { copyText } from "@/lib/clipboard";
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { SkillBrowserEntry } from "@/components/skill-browser";
import { installCommand, sourceTarget, stripFrontmatter } from "@/lib/skill-directory";

export type SkillExploreDrawerProps = {
  /** null closes the drawer. */
  skill: SkillBrowserEntry | null;
  installed: boolean;
  busy: boolean;
  onClose: () => void;
  onInstallToggle: (skill: SkillBrowserEntry) => void;
  /** Called after a successful delete of a local skill so the parent re-scans. */
  onChanged?: () => void;
};

type BodyState = {
  status: "idle" | "loading" | "loaded" | "error";
  text: string | null;
  error: string | null;
};

const DEFAULT_AGENTS = ["codex", "claude-code", "cursor", "copilot", "windsurf", "gemini"];

export function SkillExploreDrawer({
  skill,
  installed,
  busy,
  onClose,
  onInstallToggle,
  onChanged,
}: SkillExploreDrawerProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(Boolean(skill), panelRef, { onEscape: onClose });

  const [body, setBody] = useState<BodyState>({ status: "idle", text: null, error: null });
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const skillPath = skill?.local?.path ?? skill?.path ?? null;
  // Re-fetching keys: identity + path settle the effect without re-running on
  // unrelated parent renders.
  const skillId = skill?.id ?? null;

  // Load SKILL.md for the open skill, replicating the browser's fetch: local
  // files come from /api/skills/file, registry entries from the directory
  // endpoint (which returns the body under text or preview.text). Anything
  // outside the allow-listed roots 403s → fall back to the description.
  useEffect(() => {
    if (!skill) {
      setBody({ status: "idle", text: null, error: null });
      return;
    }
    const controller = new AbortController();
    setBody({ status: "loading", text: null, error: null });
    void (async () => {
      try {
        const source = sourceTarget(skill);
        const url = skillPath
          ? `/api/skills/file?path=${encodeURIComponent(skillPath)}`
          : `/api/skills/directory/${encodeURIComponent(skill.id)}?source=${encodeURIComponent(source)}`;
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        const json = (await res.json()) as {
          ok?: boolean;
          text?: string;
          error?: string;
          preview?: { text?: string } | null;
        };
        if (controller.signal.aborted) return;
        if (!json.ok) {
          setBody({ status: "error", text: null, error: json.error ?? `http ${res.status}` });
        } else {
          setBody({ status: "loaded", text: json.text ?? json.preview?.text ?? "", error: null });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setBody({ status: "error", text: null, error: err instanceof Error ? err.message : "fetch failed" });
        }
      }
    })();
    return () => controller.abort();
  }, [skill, skillId, skillPath]);

  // Reset transient action state whenever the open skill changes.
  useEffect(() => {
    setConfirmingDelete(false);
    setNotice(null);
    setCopied(false);
  }, [skillId, skillPath]);

  // Notices are transient feedback, not state.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!skill) return null;

  const source = sourceTarget(skill);
  const official = Boolean(skill.trust?.official);
  const isLocal = Boolean(skill.local?.installed);
  const topicLabel = skill.topics?.[0] ?? skill.tags?.[0] ?? "Skill";
  const installs = skill.installsAllTime ?? 0;
  const agents = skill.agents && skill.agents.length > 0 ? skill.agents : DEFAULT_AGENTS;
  const command = installCommand(skill);
  const prose = body.text ? stripFrontmatter(body.text) : "";
  const canDelete = Boolean(skill.local?.installed && skill.path);

  const stats: { icon: IconName; label: string; value: string }[] = [
    { icon: "ph:check-circle", label: "Install", value: installed ? "Installed" : "Available" },
    { icon: "ph:seal-check", label: "Trust", value: official ? "Official" : "Community" },
    { icon: "ph:folder-open", label: "Source", value: isLocal ? "Local skill" : "Registry" },
  ];

  async function handleCopyCommand() {
    try {
      await copyText(command);
      setCopied(true);
    } catch {
      setNotice("Could not copy install command");
    }
  }

  async function handleShare() {
    try {
      await copyText(skill!.sourceUrl ?? skill!.registryUrl ?? command);
      setNotice("Copied to clipboard");
    } catch {
      setNotice("Could not copy");
    }
  }

  async function handlePrompt() {
    if (deleting || busy) return;
    setNotice(null);
    try {
      const res = await fetch("/api/skills/directory/use", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: skill!.id, source: sourceTarget(skill!) }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; prompt?: string; error?: string };
      if (!res.ok || !json.ok || !json.prompt) {
        setNotice(json.error ? `Prompt failed: ${json.error}` : "Couldn't fetch the skill prompt. Try again.");
        return;
      }
      await copyText(json.prompt);
      setNotice("Skill prompt copied");
    } catch (err) {
      setNotice(err instanceof Error ? `Prompt failed: ${err.message}` : "Prompt failed");
    }
  }

  async function handleDelete() {
    if (!skill?.path || deleting) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setNotice(null);
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/skills/local?path=${encodeURIComponent(skill.path)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setNotice(json.error ? `Delete failed: ${json.error}` : "Delete failed. Try again.");
        return;
      }
      setConfirmingDelete(false);
      onChanged?.();
      onClose();
    } catch (err) {
      setNotice(err instanceof Error ? `Delete failed: ${err.message}` : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--backdrop-scrim)]" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${skill.name} details`}
        className="flex h-full w-[min(560px,96vw)] flex-col border-l border-[var(--border-hairline)] bg-[var(--bg-base)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-[var(--border-hairline)] px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
            <Icon name="ph:sparkle" width={18} className="text-[var(--text-muted)]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-serif text-[length:var(--text-xl)] font-medium text-[var(--text-primary)]">
              {skill.name}
            </h2>
            <p className="truncate font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {source} · {topicLabel}
            </p>
          </div>
          <IconButton
            icon="ph:share-network"
            size="sm"
            aria-label="Copy share link"
            onClick={handleShare}
            title="Copy a link to this skill"
          />
          <IconButton icon="ph:x-bold" size="sm" aria-label="Close" onClick={onClose} />
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col gap-1 rounded-lg bg-[var(--bg-raised)] px-3 py-2"
              >
                <span className="flex items-center gap-1 text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
                  <Icon name={stat.icon} width={11} aria-hidden />
                  {stat.label}
                </span>
                <strong className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--text-primary)]">
                  {stat.value}
                </strong>
              </div>
            ))}
          </div>

          {/* Install command — the code line is the copy affordance. */}
          <button
            type="button"
            onClick={handleCopyCommand}
            className="focus-ring flex w-full items-center justify-between gap-3 rounded-md bg-[var(--code-surface)] px-3 py-2 text-left font-mono text-[length:var(--text-xs)] text-[var(--text-primary)]"
            aria-label={copied ? "Install command copied" : `Copy install command: ${command}`}
            title={copied ? "Copied!" : "Click to copy the install command"}
          >
            <code className="min-w-0 truncate">{command}</code>
            <span className="flex shrink-0 items-center gap-1 text-[var(--text-muted)]">
              <Icon name={copied ? "ph:check-bold" : "ph:copy"} width={13} aria-hidden />
              {copied ? "Copied" : "Copy"}
            </span>
          </button>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5">
            {installed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                <Icon name="ph:check" width={10} aria-hidden /> Installed
              </span>
            ) : null}
            {installs > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                <Icon name="ph:download-simple" width={10} aria-hidden /> Installs: {installs.toLocaleString()}
              </span>
            ) : null}
            {official ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                <Icon name="ph:seal-check" width={10} aria-hidden /> Official
              </span>
            ) : null}
          </div>

          {/* Supported agents */}
          <div>
            <p className="mb-2 text-[length:var(--text-xs)] font-medium uppercase tracking-widest text-[var(--text-muted)]">
              Supported agents
            </p>
            <div className="flex flex-wrap gap-1.5">
              {agents.map((agent) => (
                <span
                  key={agent}
                  className="rounded-full bg-[var(--bg-raised)] px-2 py-0.5 font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]"
                >
                  {agent}
                </span>
              ))}
            </div>
          </div>

          {/* SKILL.md body */}
          <div>
            {body.status === "loading" ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">Loading SKILL.md…</p>
            ) : body.status === "loaded" && prose ? (
              <MarkdownBlock text={prose} className="cave-md--expanded" />
            ) : (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                {body.status === "error" && skillPath
                  ? `Couldn't read this skill's SKILL.md.${skill.description ? ` ${skill.description}` : ""}`
                  : skill.description || "No preview available for this skill."}
              </p>
            )}
          </div>

          {notice ? (
            <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]" role="status">
              {notice}
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-hairline)] bg-[var(--bg-panel)] px-5 py-4">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:clipboard-text"
            onClick={handlePrompt}
            title="Copy the generated skill prompt"
          >
            Prompt
          </Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon={installed ? "ph:check" : "ph:download-simple"}
            loading={busy}
            onClick={() => onInstallToggle(skill)}
          >
            {installed ? "Installed" : "Install skill"}
          </Button>
          {canDelete ? (
            confirmingDelete ? (
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  leadingIcon="ph:trash"
                  loading={deleting}
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              </div>
            ) : (
              <IconButton
                icon="ph:trash"
                size="sm"
                danger
                className="ml-auto"
                aria-label="Delete this local skill"
                onClick={handleDelete}
                disabled={deleting}
                title="Delete this local skill"
              />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
