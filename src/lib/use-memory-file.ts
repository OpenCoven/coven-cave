"use client";
import { useEffect, useState } from "react";

export type MemoryFileState = {
  text: string | null;
  error: string | null;
  loading: boolean;
  /** File mtime from the server — the optimistic-concurrency baseline for edits. */
  mtimeMs: number | null;
};

export type MemoryFileOptions = {
  /** Fetch the un-redacted file (required before editing, so a save can never
   *  clobber real secrets with `[REDACTED:…]` placeholders). */
  reveal?: boolean;
  /** Bump to re-fetch the same path (e.g. after a save or an edit session). */
  refreshToken?: number;
};

export function useMemoryFile(path: string | null, opts?: MemoryFileOptions): MemoryFileState {
  const reveal = Boolean(opts?.reveal);
  const refreshToken = opts?.refreshToken ?? 0;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mtimeMs, setMtimeMs] = useState<number | null>(null);

  useEffect(() => {
    if (!path) { setText(null); setError(null); setLoading(false); setMtimeMs(null); return; }
    let cancelled = false;
    setText(null); setError(null); setLoading(true); setMtimeMs(null);
    void (async () => {
      try {
        const query = `path=${encodeURIComponent(path)}${reveal ? "&reveal=1" : ""}`;
        const res = await fetch(`/api/memory/file?${query}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setText(typeof json.text === "string" ? json.text : "");
          setMtimeMs(typeof json.mtimeMs === "number" ? json.mtimeMs : null);
        } else setError(json.error ?? "Failed to load memory");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load memory");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path, reveal, refreshToken]);

  return { text, error, loading, mtimeMs };
}
