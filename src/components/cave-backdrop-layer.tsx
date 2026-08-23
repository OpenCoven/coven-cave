"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import "@/styles/backdrop.css";
import {
  applyBackdropToDocument,
  isFamiliarBackdropOn,
  readBackdropImage,
  readFamiliarBackdropImage,
  useBackdropImageRevision,
  useBackdropPrefs,
  useFamiliarBackdropRevision,
} from "@/lib/cave-backdrop";
import { CaveBackdropBlaze } from "@/components/cave-backdrop-blaze";

/**
 * Mounts once in the workspace: loads the durable backdrop image into an
 * object URL, keeps <html>'s backdrop state in sync with
 * the prefs store, and renders the fixed image layer. `active` says whether
 * the frontmost surface wants the backdrop (home/chat) — the layer stays
 * mounted and crossfades via CSS.
 *
 * `familiarId` is the active chat scope: a familiar switched on (explicitly,
 * or by having its own backdrop image) takes over the layer while it is
 * selected — even when the app-wide backdrop is off. Its own image wins;
 * the app image is the fallback. Explicitly-off familiars are dormant and
 * follow the app-wide prefs.
 *
 * The derived accent is re-fit whenever the theme mode flips (dark ↔ light
 * changes --bg-base, and the contrast fit depends on it).
 */
export function CaveBackdropLayer({
  active,
  familiarId = null,
  accent = null,
}: {
  active: boolean;
  familiarId?: string | null;
  /** The active familiar's resolved accent color. Paints a wash derived from
   *  it when the familiar is switched on but no image — theirs or the app's —
   *  is available to show. Without this that state renders an enabled layer
   *  with nothing in it, so the switch looked broken (cave-vyp3e follow-up). */
  accent?: string | null;
}) {
  const prefs = useBackdropPrefs();
  const imageRevision = useBackdropImageRevision();
  const familiarRevision = useFamiliarBackdropRevision(familiarId);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [familiarUrl, setFamiliarUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const familiarUrlRef = useRef<string | null>(null);

  // Per-familiar enablement (cave-kf8p): the explicit switch wins; with no
  // entry, an uploaded image means on (cave-j0dz compat). The switch only
  // ADDS enablement — off means the app-wide prefs govern (dormant).
  const familiarOn = familiarId
    ? isFamiliarBackdropOn(prefs, familiarId, familiarUrl !== null)
    : false;
  // The app image is wanted when the app backdrop is on, or for any familiar
  // explicitly switched on — even one whose own image is showing, so the
  // fallback stays warm. Deliberately keyed on prefs alone (not the async
  // familiarUrl): gating on image absence would churn the fetch on every
  // mount and blank-flash when a familiar image is removed. With the Blaze
  // style selected the layer never paints the app image, so its bytes are
  // not fetched at all (cave-99s9).
  const wantsAppImage =
    prefs.style === "image" &&
    (prefs.enabled || (familiarId ? prefs.familiars[familiarId] === true : false));
  const familiarImageShowing = familiarOn && familiarUrl !== null;
  const effectiveUrl = familiarImageShowing ? familiarUrl : imageUrl;
  const effectiveEnabled = prefs.enabled || familiarOn;
  // Blaze fills the layer app-wide; a familiar's own image (an explicit
  // per-familiar opt-in) still takes the layer over while it is showing.
  const blazeShowing =
    effectiveEnabled && prefs.style === "blaze" && !familiarImageShowing;
  // Last resort in the fallback chain: familiar image → app image → accent
  // wash. Reached only when the layer is enabled and BOTH images are absent,
  // which is exactly the state a familiar lands in when it is switched on
  // without an upload — previously an enabled-but-empty layer, so the toggle
  // appeared to do nothing. Blaze owns the layer when selected, so it is
  // checked first and the wash never competes with it.
  const accentWash = accent?.trim() || null;
  const accentShowing =
    effectiveEnabled && !blazeShowing && effectiveUrl === null && accentWash !== null;

  // Load (or clear) the stored image whenever the backdrop is toggled or its
  // bytes change. writeBackdropImage publishes the latter independently from
  // the enabled preference, so replacing an enabled image updates live.
  useEffect(() => {
    let cancelled = false;
    if (!wantsAppImage) {
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
  }, [wantsAppImage, imageRevision]);

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

  // Push prefs + image to <html>; re-fit the accent when the mode flips.
  // While the familiar's own image shows, the generic image's sampled accent
  // seed is suppressed — the familiar's accent (Look tab) governs its color.
  // Under the app-image fallback, app-wide accent matching applies as usual.
  useEffect(() => {
    const effectivePrefs =
      familiarImageShowing || blazeShowing
        ? { ...prefs, enabled: true, matchAccent: false, accentSeed: null }
        : { ...prefs, enabled: effectiveEnabled };
    applyBackdropToDocument(effectivePrefs, blazeShowing ? null : effectiveUrl);
    const observer = new MutationObserver(() => applyBackdropToDocument(effectivePrefs, undefined));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => observer.disconnect();
  }, [prefs, familiarImageShowing, blazeShowing, effectiveUrl, effectiveEnabled]);

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
  return (
    <div
      className="cave-backdrop-layer"
      data-on={active ? "true" : "false"}
      data-backdrop-style={blazeShowing ? "blaze" : accentShowing ? "accent" : "image"}
      // Custom property, not a background shorthand: the gradient's shape and
      // stops live in backdrop.css next to the rest of the layer's painting,
      // so only the seed color crosses from JS. React writes custom properties
      // through style.setProperty, which takes the value as a single
      // declaration — a stray ";" makes it invalid rather than injecting.
      style={accentShowing ? ({ "--cave-backdrop-accent": accentWash } as CSSProperties) : undefined}
      aria-hidden
    >
      {blazeShowing && active ? <CaveBackdropBlaze /> : null}
    </div>
  );
}
