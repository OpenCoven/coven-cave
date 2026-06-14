"use client";
import { useEffect, useState } from "react";

export type MemoryFileState = { text: string | null; error: string | null; loading: boolean };

export function useMemoryFile(path: string | null): MemoryFileState {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) { setText(null); setError(null); setLoading(false); return; }
    let cancelled = false;
    setText(null); setError(null); setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/memory/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) setText(typeof json.text === "string" ? json.text : "");
        else setError(json.error ?? "Failed to load memory");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load memory");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  return { text, error, loading };
}
