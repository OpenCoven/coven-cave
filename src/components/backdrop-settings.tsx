"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Segmented } from "@/components/ui/settings-controls";
import { readAppPreferences } from "@/lib/app-preferences";
import {
  prepareBackdropImage,
  readBackdropImage,
  useBackdropPrefs,
  writeBackdropImage,
  writeBackdropPrefs,
} from "@/lib/cave-backdrop";
import { BACKDROP_STYLES, type CaveBackdropStyle } from "@/lib/preferences-schema";
import { useArmedConfirm } from "@/lib/use-armed-confirm";

const STYLE_LABELS: Record<CaveBackdropStyle, string> = { off: "Off", image: "Image", blaze: "Blaze" };
const STYLE_TITLES: Record<CaveBackdropStyle, string> = {
  off: "No backdrop — Home and Chat stay solid",
  image: "A picture you choose shows behind Home and Chat",
  blaze: "Animated embers and smoke, tinted to your theme accent",
};

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

  function setStyle(style: CaveBackdropStyle) {
    if (style === "off") {
      // Explicit off (cave-kbh1): non-destructive — the stored image and
      // accent seed survive, so Image/Blaze restore the previous look.
      if (prefs.style === "off" && !prefs.enabled) return;
      writeBackdropPrefs({ style, enabled: false });
      announce("Backdrop off.");
      return;
    }
    if (style === "blaze") {
      // No early return on prefs.style: re-clicking the active segment
      // re-asserts enablement, healing a stomped enabled:false (e.g. a
      // clear-in-flight that finished after a switch to Blaze).
      if (prefs.style === "blaze" && prefs.enabled) return;
      writeBackdropPrefs({ style, enabled: true });
      announce("Backdrop set to Blaze — embers and smoke follow your theme accent.");
      return;
    }
    // Store truth, not the async-hydrating thumbnail: previewUrl can lag the
    // stored image (cold cache) and would wrongly disable a present backdrop.
    const imagePresent = readAppPreferences().appearance.backdrop.image.present;
    if (prefs.style === "image" && prefs.enabled === imagePresent) return;
    writeBackdropPrefs({ style, enabled: imagePresent });
    announce(
      imagePresent
        ? "Backdrop set to your image."
        : "Backdrop style set to Image — choose an image to turn it on.",
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">Backdrop</p>
          <p className="text-[length:var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
            Shows behind Home and Chat — a picture of yours, or animated Blaze embers tinted to
            your theme.
          </p>
        </div>
        <Segmented
          ariaLabel="Backdrop style"
          options={BACKDROP_STYLES}
          value={prefs.style}
          onChange={setStyle}
          getLabel={(option) => STYLE_LABELS[option]}
          getTitle={(option) => STYLE_TITLES[option]}
        />
      </div>

      {prefs.style === "image" ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label={previewUrl ? "Replace backdrop image" : "Choose backdrop image"}
            className="focus-ring grid h-20 w-32 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] bg-[var(--bg-base)]/40 text-[length:var(--text-xs)] text-[var(--text-muted)] hover:border-[var(--accent-presence)]/60"
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
          <p className="min-w-0 flex-1 text-[length:var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
            The accent tints to the image’s dominant color, kept readable against your theme.
          </p>
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
      ) : null}

      {prefs.enabled ? (
        <div className="flex flex-col gap-3 border-l border-[var(--border-hairline)] pl-3">
          <label className="flex items-center gap-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
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
            <span className="w-8 text-right font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {prefs.intensity}
            </span>
          </label>
          {prefs.style === "image" ? (
            <label className="flex items-center justify-between gap-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
              <span>Match accent to the image</span>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.matchAccent}
                aria-label="Match accent to the image"
                onClick={() => writeBackdropPrefs({ matchAccent: !prefs.matchAccent })}
                className={`focus-ring rounded-[var(--radius-control)] border px-3 py-1 text-[length:var(--text-sm)] transition-colors ${
                  prefs.matchAccent
                    ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                    : "border-[var(--border-hairline)] text-[var(--text-secondary)]"
                }`}
              >
                {prefs.matchAccent ? "On" : "Off"}
              </button>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
