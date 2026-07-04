"use client";

import { useMemo, useRef, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { COMPATIBILITY_ADAPTERS } from "@/lib/harness-adapters";
import { slugifyFamiliarId } from "@/lib/onboarding-familiars";

// Curated starter glyphs — every name is verified present in the trimmed
// ph-glyph-catalog.json, so none render blank. Users can fine-tune the icon
// later in Familiar Studio's full picker; this is the quick-create shortlist.
const STARTER_GLYPHS = [
  "ph:sparkle-fill",
  "ph:cat-fill",
  "ph:robot-fill",
  "ph:ghost-fill",
  "ph:brain-fill",
  "ph:flask-fill",
  "ph:rocket-fill",
  "ph:magic-wand-fill",
  "ph:code-fill",
  "ph:books-fill",
  "ph:palette-fill",
  "ph:chart-bar-fill",
  "ph:compass-fill",
  "ph:detective-fill",
  "ph:planet-fill",
  "ph:butterfly-fill",
] as const;

const DEFAULT_GLYPH = "ph:sparkle-fill";

const inputClass =
  "focus-ring h-9 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]";
const labelClass = "mb-1 block text-[11px] font-medium text-[var(--text-secondary)]";

type Props = {
  open: boolean;
  onClose: () => void;
  /** ids already in the roster — used to flag a duplicate before submitting. */
  existingIds: string[];
  /** Current global default harness, used to preselect the dropdown. */
  defaultHarness?: string;
  /** Called with the new familiar's id after a successful create. */
  onCreated: (id: string) => void;
};

export function CreateFamiliarDialog({
  open,
  onClose,
  existingIds,
  defaultHarness,
  onCreated,
}: Props) {
  const { announce } = useAnnouncer();
  const [name, setName] = useState("");
  const [idOverride, setIdOverride] = useState<string | null>(null);
  const [glyph, setGlyph] = useState<string>(DEFAULT_GLYPH);
  const [glyphOpen, setGlyphOpen] = useState(false);
  const [harness, setHarness] = useState<string>(
    defaultHarness && COMPATIBILITY_ADAPTERS.some((a) => a.id === defaultHarness)
      ? defaultHarness
      : "codex",
  );
  const [showMore, setShowMore] = useState(false);
  const [role, setRole] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function pickAvatar(file: File | null) {
    setAvatarFile(file);
  }

  const derivedId = slugifyFamiliarId(idOverride ?? name);
  const existing = useMemo(() => new Set(existingIds), [existingIds]);
  const idTaken = derivedId.length > 0 && existing.has(derivedId);
  const canCreate = name.trim().length > 0 && derivedId.length > 0 && !idTaken && !submitting;

  function reset() {
    setName("");
    setIdOverride(null);
    setGlyph(DEFAULT_GLYPH);
    setGlyphOpen(false);
    setHarness(
      defaultHarness && COMPATIBILITY_ADAPTERS.some((a) => a.id === defaultHarness)
        ? defaultHarness
        : "codex",
    );
    setShowMore(false);
    setRole("");
    setModel("");
    setDescription("");
    pickAvatar(null);
    setError(null);
    setSubmitting(false);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleCreate() {
    if (!canCreate) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/familiars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiar: {
            id: derivedId,
            displayName: name.trim(),
            glyph,
            harness,
            ...(role.trim() ? { role: role.trim() } : {}),
            ...(model.trim() ? { model: model.trim() } : {}),
            ...(description.trim() ? { description: description.trim() } : {}),
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok || !json.ok) {
        const msg = json.error ?? `Could not create familiar (HTTP ${res.status}).`;
        setError(msg);
        announce(msg, "assertive");
        setSubmitting(false);
        return;
      }
      const newId = json.id ?? derivedId;
      // Avatar is best-effort: the familiar already exists, so a failed image
      // upload must not block creation — the user can set one later in Studio.
      if (avatarFile) {
        try {
          await fetch(`/api/familiars/${encodeURIComponent(newId)}/avatar`, {
            method: "POST",
            headers: { "content-type": avatarFile.type || "application/octet-stream" },
            body: avatarFile,
          });
        } catch {
          /* non-blocking */
        }
      }
      reset();
      onCreated(newId);
      announce(`${name.trim() || "Familiar"} created`, "polite");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create familiar.";
      setError(msg);
      announce(msg, "assertive");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      breadcrumb={["Familiars", "New familiar"]}
      dismissOnBackdrop={!submitting}
      footerActions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            leadingIcon="ph:plus"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            loading={submitting}
          >
            Create familiar
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        {/* Name + glyph swatch */}
        <div>
          <label className={labelClass} htmlFor="create-familiar-name">
            Name
          </label>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => setGlyphOpen((v) => !v)}
              aria-label="Pick an icon or photo"
              aria-expanded={glyphOpen}
              title="Pick an icon or photo"
              className="focus-ring grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 hover:border-[var(--accent-presence)]"
            >
              {avatarFile ? (
                <Icon name="ph:camera" width={16} className="text-[var(--accent-presence)]" />
              ) : (
                <FamiliarGlyph glyph={{ kind: "icon", name: glyph }} size="sm" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file) pickAvatar(file);
                e.target.value = "";
              }}
            />
            <input
              id="create-familiar-name"
              ref={nameRef}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nova"
              className={inputClass}
            />
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            {derivedId ? (
              idTaken ? (
                <span className="text-[var(--color-warning)]">
                  id “{derivedId}” is already taken — pick another name
                </span>
              ) : (
                <>id: {derivedId}</>
              )
            ) : (
              <>A name creates the familiar’s id automatically.</>
            )}
          </p>
        </div>

        {/* Icon / photo picker */}
        {glyphOpen ? (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 p-2">
            <div className="flex items-center justify-between">
              <span className="truncate text-[11px] font-medium text-[var(--text-secondary)]">
                {avatarFile ? `Photo attached · ${avatarFile.name}` : "Pick an icon"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-hairline)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                >
                  <Icon name="ph:camera" width={11} />
                  Upload photo
                </button>
                {avatarFile ? (
                  <button
                    type="button"
                    onClick={() => pickAvatar(null)}
                    className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <Icon name="ph:x" width={11} />
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
            <div role="listbox" aria-label="Starter icons" className="grid grid-cols-8 gap-1">
              {STARTER_GLYPHS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="option"
                  aria-selected={!avatarFile && glyph === g}
                  onClick={() => {
                    setGlyph(g);
                    pickAvatar(null);
                    setGlyphOpen(false);
                  }}
                  title={g.replace(/^ph:/, "").replace(/-fill$/, "")}
                  className={`focus-ring grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--bg-raised)] ${
                    !avatarFile && glyph === g
                      ? "bg-[var(--accent-presence)]/15 ring-1 ring-[var(--accent-presence)]"
                      : ""
                  }`}
                >
                  <FamiliarGlyph glyph={{ kind: "icon", name: g }} size="sm" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Harness */}
        <div>
          <label className={labelClass} htmlFor="create-familiar-harness">
            Harness
          </label>
          <select
            id="create-familiar-harness"
            value={harness}
            onChange={(e) => setHarness(e.target.value)}
            className={inputClass}
          >
            {COMPATIBILITY_ADAPTERS.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.label}
              </option>
            ))}
          </select>
        </div>

        {/* More options */}
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="focus-ring inline-flex w-fit items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Icon name={showMore ? "ph:caret-down" : "ph:caret-right"} width={11} />
          More options
        </button>

        {showMore ? (
          <div className="flex flex-col gap-3 border-l border-[var(--border-hairline)] pl-3">
            <div>
              <label className={labelClass} htmlFor="create-familiar-id">
                id
              </label>
              <input
                id="create-familiar-id"
                value={idOverride ?? derivedId}
                onChange={(e) => setIdOverride(e.target.value)}
                placeholder="auto from name"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="create-familiar-role">
                Role
              </label>
              <input
                id="create-familiar-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Familiar"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="create-familiar-model">
                Model
              </label>
              <input
                id="create-familiar-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Default for this runtime"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="create-familiar-description">
                What it does
              </label>
              <textarea
                id="create-familiar-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short description of this familiar’s focus."
                rows={3}
                className={`${inputClass} h-auto resize-y py-2`}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="flex items-center gap-1.5 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2.5 py-1.5 text-[11px] text-[var(--color-warning)]">
            <Icon name="ph:warning-circle" width={12} />
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
