"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  prepareBackdropImage,
  readBackdropImage,
  useBackdropPrefs,
  writeBackdropImage,
  writeBackdropPrefs,
} from "@/lib/cave-backdrop";
import { useArmedConfirm } from "@/lib/use-armed-confirm";

/**
 * Settings → Appearance → Backdrop: pick an image that shows behind Home and
 * Chat, tune how much of it shows through, and let the app's accent take on
 * the image's dominant color ("match the vibe"). The heavy lifting lives in
 * cave-backdrop.ts; this card is pure controls + preview.
 */
export function BackdropSettings() {
  const prefs = useBackdropPrefs();
  const { announce } = useAnnouncer();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Clearing discards the stored image with no undo — two-step (cave-5lsj).
  const clearConfirm = useArmedConfirm();
  const urlRef = useRef<string | null>(null);

  // Thumbnail of whatever is stored — follows enable/replace/clear.
  useEffect(() => {
    let cancelled = false;
    void readBackdropImage().then((blob) => {
      if (cancelled) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = blob ? URL.createObjectURL(blob) : null;
      setPreviewUrl(urlRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [prefs.enabled, busy]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function pickImage(file: File) {
    setBusy(true);
    try {
      const { blob, accentSeed } = await prepareBackdropImage(file);
      await writeBackdropImage(blob);
      writeBackdropPrefs({ enabled: true, accentSeed });
      announce(
        accentSeed
          ? "Backdrop set — accent matched to the image."
          : "Backdrop set. The image has no dominant color, so the theme accent stays.",
      );
    } catch (err) {
      // createImageBitmap rejects when the engine can't decode the format —
      // most commonly HEIC photos outside the desktop app. Name the fix
      // instead of surfacing the engine's opaque decode error.
      const heicLike = /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
      announce(
        heicLike
          ? "Couldn't decode that HEIC photo here. It works in the desktop app — elsewhere, convert it to JPEG first."
          : err instanceof Error && err.message
            ? err.message
            : "Could not read that image.",
        "assertive",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearBackdrop() {
    setBusy(true);
    try {
      await writeBackdropImage(null);
      writeBackdropPrefs({ enabled: false, accentSeed: null });
      announce("Backdrop cleared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label={previewUrl ? "Replace backdrop image" : "Choose backdrop image"}
          className="focus-ring grid h-20 w-32 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] bg-[var(--bg-base)]/40 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent-presence)]/60"
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>{busy ? "Reading…" : "Choose image"}</span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            if (file) void pickImage(file);
            e.target.value = "";
          }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">Backdrop</p>
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            Shows behind Home and Chat. The accent tints to the image’s dominant color, kept
            readable against your theme.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {previewUrl ? (
            <Button
              size="xs"
              variant="ghost"
              leadingIcon="ph:x"
              onClick={() => clearConfirm.trigger(() => void clearBackdrop())}
              disabled={busy}
            >
              {clearConfirm.armed ? "Really clear?" : "Clear"}
            </Button>
          ) : null}
        </div>
      </div>

      {prefs.enabled ? (
        <div className="flex flex-col gap-3 border-l border-[var(--border-hairline)] pl-3">
          <label className="flex items-center gap-3 text-[12px] text-[var(--text-secondary)]">
            <span className="w-16 shrink-0">Intensity</span>
            <input
              type="range"
              min={10}
              max={80}
              value={prefs.intensity}
              onChange={(e) => writeBackdropPrefs({ intensity: Number(e.target.value) })}
              className="cave-backdrop-intensity min-w-0 flex-1"
              aria-label="Backdrop intensity"
            />
            <span className="w-8 text-right font-mono text-[11px] text-[var(--text-muted)]">
              {prefs.intensity}
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 text-[12px] text-[var(--text-secondary)]">
            <span>Match accent to the image</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.matchAccent}
              onClick={() => writeBackdropPrefs({ matchAccent: !prefs.matchAccent })}
              className={`focus-ring rounded-[var(--radius-control)] border px-3 py-1 text-[12px] transition-colors ${
                prefs.matchAccent
                  ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                  : "border-[var(--border-hairline)] text-[var(--text-secondary)]"
              }`}
            >
              {prefs.matchAccent ? "On" : "Off"}
            </button>
          </label>
        </div>
      ) : null}
    </div>
  );
}
