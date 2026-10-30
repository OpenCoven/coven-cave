"use client";

import "@/styles/cave-md.css";

import { useEffect, useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { MarkdownBlock } from "@/components/message-bubble";
import { copyText } from "@/lib/clipboard";
import { Icon } from "@/lib/icon";
import type { SkillBrowserEntry } from "@/lib/skill-directory";
import { stripFrontmatter } from "@/lib/skill-directory";
import { Modal } from "@/components/ui/modal";
import { MarketplaceLogo } from "@/components/marketplace/marketplace-logo";

export type SkillExploreDrawerProps = {
  skill: SkillBrowserEntry | null;
  onClose: () => void;
  onChanged?: () => void;
};

type BodyState = {
  status: "idle" | "loading" | "loaded" | "error";
  text: string | null;
  error: string | null;
};

export function SkillExploreDrawer({
  skill,
  onClose,
  onChanged,
}: SkillExploreDrawerProps): JSX.Element | null {

  const [body, setBody] = useState<BodyState>({ status: "idle", text: null, error: null });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const skillPath = skill?.local?.path ?? skill?.path ?? null;
  const skillId = skill?.id ?? null;

  useEffect(() => {
    if (!skill || !skillPath) {
      setBody({ status: "idle", text: null, error: null });
      return;
    }
    const controller = new AbortController();
    setBody({ status: "loading", text: null, error: null });
    void fetch(`/api/skills/file?path=${encodeURIComponent(skillPath)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((json: { ok?: boolean; text?: string; error?: string }) => {
        if (controller.signal.aborted) return;
        if (!json.ok) {
          setBody({ status: "error", text: null, error: json.error ?? "read failed" });
          return;
        }
        setBody({ status: "loaded", text: json.text ?? "", error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setBody({
            status: "error",
            text: null,
            error: error instanceof Error ? error.message : "read failed",
          });
        }
      });
    return () => controller.abort();
  }, [skill, skillPath]);

  useEffect(() => {
    setConfirmingDelete(false);
    setNotice(null);
  }, [skillId, skillPath]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!skill) return null;

  const prose = body.text ? stripFrontmatter(body.text) : "";
  const canDelete = Boolean(skillPath);

  async function handlePrompt() {
    if (deleting || !skillPath || !skillId) return;
    setNotice(null);
    try {
      const response = await fetch("/api/skills/directory/use", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          id: skillId,
          scope: "local",
          path: skillPath,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        prompt?: string;
        error?: string;
      };
      if (!response.ok || !json.ok || !json.prompt) {
        setNotice(json.error ? `Prompt failed: ${json.error}` : "Couldn't fetch the skill prompt. Try again.");
        return;
      }
      await copyText(json.prompt);
      setNotice("Skill prompt copied");
    } catch (error) {
      setNotice(error instanceof Error ? `Prompt failed: ${error.message}` : "Prompt failed");
    }
  }

  async function handleDelete() {
    if (!skillPath || deleting) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setNotice(null);
      return;
    }
    setDeleting(true);
    try {
      const response = await fetch(`/api/skills/local?path=${encodeURIComponent(skillPath)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) {
        setNotice(json.error ? `Delete failed: ${json.error}` : "Delete failed. Try again.");
        return;
      }
      setConfirmingDelete(false);
      onChanged?.();
      onClose();
    } catch (error) {
      setNotice(error instanceof Error ? `Delete failed: ${error.message}` : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal open onClose={onClose} presentation="sheet-right" size="standard"
      title={skill.name} description={`Local skill · ${skill.local?.scope ?? "local"}`} busy={deleting}
      headerIcon={<MarketplaceLogo id={skill.id} displayName={skill.name} size="detail" />}
      footerActions={<>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:clipboard-text"
            disabled={deleting} onClick={handlePrompt}
            title="Copy the generated skill prompt"
          >
            Prompt
          </Button>
          {canDelete ? (
            confirmingDelete ? (
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
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
</>}
    >
        <div className="space-y-5">
          <div className="marketplace-card__decision" aria-label="Installed local skill">
            <span className="marketplace-card__decision-chip">
              <Icon name="ph:check-circle" width={11} aria-hidden /> Installed
            </span>
            <span className="marketplace-card__decision-chip">
              <Icon name="ph:folder-open" width={11} aria-hidden /> Local skill
            </span>
            {skill.local?.version ? (
              <span className="marketplace-card__decision-chip">
                <Icon name="ph:tag" width={11} aria-hidden /> {skill.local.version}
              </span>
            ) : null}
          </div>

          <div>
            {body.status === "loading" ? (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">Loading SKILL.md…</p>
            ) : body.status === "loaded" && prose ? (
              <MarkdownBlock text={prose} className="cave-md--expanded" />
            ) : (
              <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
                {body.status === "error"
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

    </Modal>
  );
}
