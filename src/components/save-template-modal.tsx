"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAnnouncer } from "@/components/ui/live-region";
import type { PromptOption } from "@/lib/slash-prompt";

// Save-as-template (cave-jg6k): turn the current draft into a reusable
// ~/.coven/prompts template, or edit an existing user template in place. One
// form for both — `editing` prefills and pins the id (overwrite), create mode
// derives the id from the name server-side. Success broadcasts
// `cave:prompts-refresh` so every mounted picker re-scans.

export const PROMPTS_REFRESH_EVENT = "cave:prompts-refresh";

export function broadcastPromptsRefresh(): void {
  window.dispatchEvent(new Event(PROMPTS_REFRESH_EVENT));
}

type SaveTemplateModalProps = {
  open: boolean;
  onClose: () => void;
  /** Seed for the template body — the composer draft. */
  initialBody?: string;
  /** Duplicate mode: prefill every field from a builtin/pack template but
   *  save as a NEW user template (fresh id from the name). */
  seed?: PromptOption | null;
  /** Editing an existing USER template: prefills every field and saves back
   *  to the same id. */
  editing?: PromptOption | null;
  /** Fired after a successful save with the scanned template. */
  onSaved?: (prompt: PromptOption) => void;
};

export function SaveTemplateModal({
  open,
  onClose,
  initialBody,
  seed,
  editing,
  onSaved,
}: SaveTemplateModalProps) {
  const { announce } = useAnnouncer();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A 409 (name collision on create) arms an explicit second confirm — the
  // button relabels to "Overwrite" rather than silently replacing.
  const [overwriteArmed, setOverwriteArmed] = useState(false);

  // (Re)seed whenever the modal opens — edits prefill from the template,
  // creates from the draft.
  useEffect(() => {
    if (!open) return;
    const from = editing ?? seed;
    setName(from?.name ?? "");
    setDescription(from?.description ?? "");
    setTags((from?.tags ?? []).join(", "));
    setBody(from?.body ?? initialBody ?? "");
    setError(null);
    setOverwriteArmed(false);
  }, [open, editing, seed, initialBody]);

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    if (!body.trim()) {
      setError("The template body is empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          body,
          // Edits keep their id and always overwrite; creates only overwrite
          // after the user confirmed the 409.
          ...(editing ? { id: editing.id, overwrite: true } : {}),
          ...(!editing && overwriteArmed ? { overwrite: true } : {}),
          ...((editing ?? seed)?.icon ? { icon: (editing ?? seed)?.icon } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as {
        ok: boolean;
        prompt?: PromptOption;
        error?: string;
      };
      if (res.status === 409) {
        setOverwriteArmed(true);
        setError(json.error ?? "A template with this name already exists.");
        return;
      }
      if (!json.ok || !json.prompt) {
        setError(json.error ?? "Couldn't save the template.");
        return;
      }
      broadcastPromptsRefresh();
      announce(editing ? "Template updated." : "Template saved.", "polite");
      onSaved?.(json.prompt);
      onClose();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "focus-ring w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-sunken)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]";

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["Prompts", editing ? "Edit template" : "Save as template"]}
      footerActions={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : overwriteArmed ? "Overwrite" : editing ? "Save changes" : "Save template"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <p className="text-sm text-[var(--color-warning)]" role="alert">
            {error}
          </p>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Name
          <input
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setOverwriteArmed(false);
            }}
            placeholder="Release notes"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Description
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this template is for (shown in the picker)"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Tags
          <input
            className={inputClass}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="release, writing (comma-separated)"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Template
          <textarea
            className={`${inputClass} min-h-32 resize-y font-mono text-[length:var(--text-base)] leading-5`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Draft release notes since {{last release|the last tag}}…"}
          />
        </label>
        <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
          Wrap the parts to fill in as{" "}
          <code className="rounded bg-[var(--bg-raised)] px-1">{"{{placeholder}}"}</code> or{" "}
          <code className="rounded bg-[var(--bg-raised)] px-1">{"{{name|default}}"}</code> — Tab
          cycles through them after inserting.
        </p>
      </div>
    </Modal>
  );
}
