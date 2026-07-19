"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon, ICON_NAMES, type IconName } from "@/lib/icon";
import {
  orderPrompts,
  promptTags,
  readPromptFavorites,
  readPromptRecents,
  togglePromptFavorite,
} from "@/lib/prompt-prefs";
import type { PromptOption } from "@/lib/slash-prompt";
import { SaveTemplateModal, broadcastPromptsRefresh } from "@/components/save-template-modal";

const FALLBACK_ICON: IconName = "ph:chat-centered-text";

/** Prompt icons come from data (frontmatter / catalog), so validate against
 *  the curated icon set and fall back rather than trusting the string. */
export function promptIconName(icon?: string): IconName {
  return icon && (ICON_NAMES as readonly string[]).includes(icon)
    ? (icon as IconName)
    : FALLBACK_ICON;
}

/** Muted origin chip for non-user rows ("built-in" / the pack id). */
function originLabel(source: PromptOption["source"]): string | null {
  if (source === "builtin") return "built-in";
  if (source.startsWith("pack:")) return source.slice(5);
  return null;
}

type PromptSnippetsModalProps = {
  open: boolean;
  onClose: () => void;
  prompts: PromptOption[];
  /** Picking a template drops it into the composer — the caller inserts. */
  onPick: (prompt: PromptOption) => void;
};

/** "Prompt snippets" picker + manager (cave-jg6k). Picking still just inserts;
 *  rows now carry favorite stars, user templates get edit/delete, and
 *  builtin/pack templates can be duplicated into ~/.coven/prompts. The list
 *  itself stays caller-fetched — saves/deletes broadcast cave:prompts-refresh
 *  and the caller's picker hook re-scans. */
export function PromptSnippetsModal(props: PromptSnippetsModalProps) {
  return <PromptSnippetsModalInner key={String(props.open)} {...props} />;
}

function PromptSnippetsModalInner({ open, onClose, prompts, onPick }: PromptSnippetsModalProps) {
  const confirm = useConfirm();
  const { announce } = useAnnouncer();
  const [favorites, setFavorites] = useState<string[]>(() => readPromptFavorites());
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // The nested save modal serves both flows: `editing` (user rows' pencil)
  // and `seed` (builtin/pack rows' duplicate).
  const [editing, setEditing] = useState<PromptOption | null>(null);
  const [duplicating, setDuplicating] = useState<PromptOption | null>(null);
  const [confirming, setConfirming] = useState(false);

  const tags = useMemo(() => promptTags(prompts), [prompts]);
  const ordered = useMemo(
    () =>
      orderPrompts(prompts, favorites, readPromptRecents()).filter(
        (p) => !activeTag || (p.tags ?? []).includes(activeTag),
      ),
    [prompts, favorites, activeTag],
  );

  const removeTemplate = async (p: PromptOption) => {
    // The confirm dialog and this modal both trap focus on window keydown —
    // hide this one while the dialog is up so Escape only addresses one trap.
    setConfirming(true);
    const ok = await confirm({
      title: `Delete "${p.name}"?`,
      body: "Removes the template file from ~/.coven/prompts. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    setConfirming(false);
    if (!ok) return;
    const res = await fetch(`/api/prompts?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
    if (json.ok) {
      broadcastPromptsRefresh();
      announce("Template deleted.", "polite");
    } else {
      announce(json.error ?? "Couldn't delete the template.", "assertive");
    }
  };

  const tagPill = (selected: boolean) =>
    `focus-ring rounded-full border border-[var(--border-hairline)] px-2.5 py-0.5 text-[length:var(--text-xs)] transition-colors ${
      selected
        ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    }`;

  const rowAction =
    "focus-ring grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]";

  // The nested save/confirm dialogs replace (not stack on) this modal — two
  // simultaneous focus traps would both fire on Escape and fight over Tab.
  const listOpen = open && editing === null && duplicating === null && !confirming;

  return (
    <>
    <Modal open={listOpen} onClose={onClose} breadcrumb={["Chat", "Prompt snippets"]}>
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        Pick a starter prompt to drop into the composer — Tab cycles any{" "}
        <code className="rounded bg-[var(--bg-raised)] px-1">{"{{placeholders}}"}</code> after
        inserting.
      </p>
      {tags.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
          <button
            type="button"
            className={tagPill(activeTag === null)}
            aria-pressed={activeTag === null}
            onClick={() => setActiveTag(null)}
          >
            All
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={tagPill(activeTag === tag)}
              aria-pressed={activeTag === tag}
              onClick={() => setActiveTag((cur) => (cur === tag ? null : tag))}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
      {ordered.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          {prompts.length === 0
            ? "No prompt templates found. Add .md files under ~/.coven/prompts or install a prompt pack from the Marketplace."
            : "No templates carry this tag."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Prompt snippets">
          {ordered.map((p) => {
            const isFavorite = favorites.includes(p.id);
            const origin = originLabel(p.source);
            return (
              <li key={p.id} className="group flex items-start gap-1">
                <button
                  type="button"
                  className="focus-ring flex min-w-0 flex-1 items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bg-raised)]"
                  onClick={() => onPick(p)}
                >
                  <Icon
                    name={promptIconName(p.icon)}
                    width={16}
                    className="mt-0.5 shrink-0 text-[var(--text-muted)]"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                      <span className="truncate">{p.name}</span>
                      {origin ? (
                        <span className="shrink-0 rounded-full border border-[var(--border-hairline)] px-1.5 text-[length:var(--text-2xs)] font-normal text-[var(--text-muted)]">
                          {origin}
                        </span>
                      ) : null}
                    </span>
                    {p.description ? (
                      <span className="block text-xs text-[var(--text-muted)]">{p.description}</span>
                    ) : null}
                  </span>
                </button>
                <span className="mt-1.5 flex items-center gap-0.5">
                  <button
                    type="button"
                    className={rowAction}
                    aria-pressed={isFavorite}
                    aria-label={isFavorite ? `Unfavorite ${p.name}` : `Favorite ${p.name}`}
                    title={isFavorite ? "Unfavorite" : "Favorite"}
                    onClick={() => setFavorites((cur) => togglePromptFavorite(cur, p.id))}
                  >
                    <Icon
                      name={isFavorite ? "ph:bookmark-simple-fill" : "ph:bookmark-simple"}
                      width={13}
                      aria-hidden
                    />
                  </button>
                  {p.source === "user" ? (
                    <>
                      <button
                        type="button"
                        className={rowAction}
                        aria-label={`Edit ${p.name}`}
                        title="Edit template"
                        onClick={() => setEditing(p)}
                      >
                        <Icon name="ph:pencil-simple" width={13} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={rowAction}
                        aria-label={`Delete ${p.name}`}
                        title="Delete template"
                        onClick={() => void removeTemplate(p)}
                      >
                        <Icon name="ph:trash" width={13} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={rowAction}
                      aria-label={`Duplicate ${p.name} to my templates`}
                      title="Duplicate to my templates"
                      onClick={() => setDuplicating(p)}
                    >
                      <Icon name="ph:copy" width={13} aria-hidden />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
    {/* The edit/duplicate form is a SIBLING, never nested (focus-trap note
        above) — while it is open, listOpen hides the list; closing it
        restores the list modal. */}
    <SaveTemplateModal
      open={editing !== null || duplicating !== null}
      onClose={() => {
        setEditing(null);
        setDuplicating(null);
      }}
      editing={editing}
      seed={duplicating}
    />
    </>
  );
}
