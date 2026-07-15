"use client";

import { useEffect, useRef, useState } from "react";
import "@/styles/backdrop.css";
import {
  applyBackdropToDocument,
  readBackdropImage,
  readFamiliarBackdropImage,
  useBackdropImageRevision,
  useBackdropPrefs,
  useFamiliarBackdropRevision,
} from "@/lib/cave-backdrop";

/**
 * Mounts once in the workspace: loads the durable backdrop image into an
 * object URL, keeps <html>'s backdrop state in sync with
 * the prefs store, and renders the fixed image layer. `active` says whether
 * the frontmost surface wants the backdrop (home/chat) — the layer stays
 * mounted and crossfades via CSS.
 *
 * `familiarId` is the active chat scope: a familiar with its own backdrop
 * override takes over the layer while it is selected (even when the app-wide
 * backdrop is off); everything else falls back to the generic image.
 *
 * The derived accent is re-fit whenever the theme mode flips (dark ↔ light
 * changes --bg-base, and the contrast fit depends on it).
 */
export function CaveBackdropLayer({
  active,
  familiarId = null,
}: {
  active: boolean;
  familiarId?: string | null;
}) {
  const prefs = useBackdropPrefs();
  const imageRevision = useBackdropImageRevision();
  const familiarRevision = useFamiliarBackdropRevision(familiarId);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [familiarUrl, setFamiliarUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const familiarUrlRef = useRef<string | null>(null);

  // Load (or clear) the stored image whenever the backdrop is toggled or its
  // bytes change. writeBackdropImage publishes the latter independently from
  // the enabled preference, so replacing an enabled image updates live.
  useEffect(() => {
    let cancelled = false;
    if (!prefs.enabled) {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      setImageUrl(null);
      return;
    }
    void readBackdropImage().then((blob) => {
      if (cancelled) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = blob ? URL.createObjectURL(blob) : null;
      setImageUrl(urlRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [prefs.enabled, imageRevision]);

  // Load (or clear) the active familiar's override. Independent of the
  // app-wide enablement: a familiar backdrop shows even when the generic one
  // is off — that's the per-familiar opt-in.
  useEffect(() => {
    let cancelled = false;
    if (!familiarId) {
      if (familiarUrlRef.current) URL.revokeObjectURL(familiarUrlRef.current);
      familiarUrlRef.current = null;
      setFamiliarUrl(null);
      return;
    }
    void readFamiliarBackdropImage(familiarId)
      .catch(() => null)
      .then((blob) => {
        if (cancelled) return;
        if (familiarUrlRef.current) URL.revokeObjectURL(familiarUrlRef.current);
        familiarUrlRef.current = blob ? URL.createObjectURL(blob) : null;
        setFamiliarUrl(familiarUrlRef.current);
      });
    return () => {
      cancelled = true;
    };
  }, [familiarId, familiarRevision]);

  // The familiar override wins while present; the generic image is the
  // fallback/default. Enablement follows the same rule.
  const effectiveUrl = familiarUrl ?? imageUrl;
  const effectiveEnabled = prefs.enabled || familiarUrl !== null;

  // Push prefs + image to <html>; re-fit the accent when the mode flips.
  // Under a familiar override the generic image's sampled accent seed is
  // suppressed — the familiar's own accent (Look tab) governs its color.
  useEffect(() => {
    const effectivePrefs = familiarUrl
      ? { ...prefs, enabled: true, matchAccent: false, accentSeed: null }
      : { ...prefs, enabled: effectiveEnabled };
    applyBackdropToDocument(effectivePrefs, effectiveUrl);
    const observer = new MutationObserver(() => applyBackdropToDocument(effectivePrefs, undefined));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => observer.disconnect();
  }, [prefs, familiarUrl, effectiveUrl, effectiveEnabled]);

  // Flag the document while a backdrop surface is frontmost, so the shell's
  // opaque panes (shell-root/detail, chat roots) go translucent only then.
  useEffect(() => {
    const root = document.documentElement;
    if (effectiveEnabled && active) root.dataset.backdropOn = "1";
    else delete root.dataset.backdropOn;
    return () => {
      delete root.dataset.backdropOn;
    };
  }, [effectiveEnabled, active]);

  // Revoke the object URLs when the layer unmounts for good.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (familiarUrlRef.current) URL.revokeObjectURL(familiarUrlRef.current);
    },
    [],
  );

  if (!effectiveEnabled) return null;
  return <div className="cave-backdrop-layer" data-on={active ? "true" : "false"} aria-hidden />;
}
