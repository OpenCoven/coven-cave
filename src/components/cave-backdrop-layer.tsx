"use client";

import { useEffect, useRef, useState } from "react";
import "@/styles/backdrop.css";
import {
  applyBackdropToDocument,
  readBackdropImage,
  useBackdropPrefs,
} from "@/lib/cave-backdrop";

/**
 * Mounts once in the workspace: loads the stored backdrop image from
 * IndexedDB into an object URL, keeps <html>'s backdrop state in sync with
 * the prefs store, and renders the fixed image layer. `active` says whether
 * the frontmost surface wants the backdrop (home/chat) — the layer stays
 * mounted and crossfades via CSS.
 *
 * The derived accent is re-fit whenever the theme mode flips (dark ↔ light
 * changes --bg-base, and the contrast fit depends on it).
 */
export function CaveBackdropLayer({ active }: { active: boolean }) {
  const prefs = useBackdropPrefs();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  // Load (or clear) the stored image whenever the backdrop is toggled.
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
  }, [prefs.enabled]);

  // Push prefs + image to <html>; re-fit the accent when the mode flips.
  useEffect(() => {
    applyBackdropToDocument(prefs, imageUrl);
    const observer = new MutationObserver(() => applyBackdropToDocument(prefs, undefined));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => observer.disconnect();
  }, [prefs, imageUrl]);

  // Flag the document while a backdrop surface is frontmost, so the shell's
  // opaque panes (shell-root/detail, chat roots) go translucent only then.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.enabled && active) root.dataset.backdropOn = "1";
    else delete root.dataset.backdropOn;
    return () => {
      delete root.dataset.backdropOn;
    };
  }, [prefs.enabled, active]);

  // Revoke the object URL when the layer unmounts for good.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  if (!prefs.enabled) return null;
  return <div className="cave-backdrop-layer" data-on={active ? "true" : "false"} aria-hidden />;
}
