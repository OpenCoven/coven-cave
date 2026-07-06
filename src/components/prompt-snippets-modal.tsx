"use client";

import { Modal } from "@/components/ui/modal";
import { Icon, ICON_NAMES, type IconName } from "@/lib/icon";
import type { PromptOption } from "@/lib/slash-prompt";

const FALLBACK_ICON: IconName = "ph:chat-centered-text";

/** Prompt icons come from data (frontmatter / catalog), so validate against
 *  the curated icon set and fall back rather than trusting the string. */
export function promptIconName(icon?: string): IconName {
  return icon && (ICON_NAMES as readonly string[]).includes(icon)
    ? (icon as IconName)
    : FALLBACK_ICON;
}

type PromptSnippetsModalProps = {
  open: boolean;
  onClose: () => void;
  prompts: PromptOption[];
  /** Picking a template drops it into the composer — the caller inserts. */
  onPick: (prompt: PromptOption) => void;
};

/** "Prompt snippets" picker — a starter prompt dropped into the composer for
 *  editing, never sent. Dumb component: fetching stays in the caller. */
export function PromptSnippetsModal({ open, onClose, prompts, onPick }: PromptSnippetsModalProps) {
  return (
    <Modal open={open} onClose={onClose} breadcrumb={["Chat", "Prompt snippets"]}>
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        Pick a starter prompt to drop into the composer.
      </p>
      {prompts.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No prompt templates found. Add .md files under ~/.coven/prompts or install a prompt
          pack from the Marketplace.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Prompt snippets">
          {prompts.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="focus-ring flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bg-raised)]"
                onClick={() => onPick(p)}
              >
                <Icon
                  name={promptIconName(p.icon)}
                  width={16}
                  className="mt-0.5 shrink-0 text-[var(--text-muted)]"
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {p.name}
                  </span>
                  {p.description ? (
                    <span className="block text-xs text-[var(--text-muted)]">{p.description}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
