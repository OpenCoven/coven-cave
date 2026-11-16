"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";

type Entry = { name: string; path: string; isDir: boolean };

/** The desktop human previews their chosen folder. No familiar receives access. */
export function FirstUseProjectPreview({ name, root }: { name: string; root: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void fetch(`/api/project-tree?${new URLSearchParams({ root, depth: "0" })}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.entries)) throw new Error(data.error ?? "Couldn't preview this folder.");
      if (!controller.signal.aborted) setEntries(data.entries.filter((entry: Entry) => typeof entry.name === "string" && typeof entry.path === "string").slice(0, 8));
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Couldn't preview this folder."); });
    return () => controller.abort();
  }, [root, epoch]);
  useEffect(() => {
    setContent(null);
    if (!selected || selected.isDir) return;
    const controller = new AbortController();
    setError(null);
    void fetch(`/api/project-file?${new URLSearchParams({ path: selected.path })}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Couldn't preview this file.");
      if (!controller.signal.aborted) setContent(data.kind === "text" && typeof data.content === "string" ? data.content.slice(0, 1600) : "Open this file in the project browser to inspect its format.");
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Couldn't preview this file."); });
    return () => controller.abort();
  }, [selected, epoch]);
  return <div className="first-use-workbench">
    <div className="first-use-workbench-title"><Icon name="ph:folder" aria-hidden /><strong>{name}</strong><span>Preview</span></div>
    <div className="first-use-workbench-body"><nav aria-label="Preview project files">{entries === null ? <p role="status">Loading files…</p> : entries.length === 0 ? <p>This folder is ready for your first idea.</p> : entries.map((entry) => <button type="button" key={entry.path} className="focus-ring" aria-pressed={selected?.path === entry.path} onClick={() => setSelected(entry)}><Icon name={entry.isDir ? "ph:folder" : "ph:file-text"} aria-hidden />{entry.name}</button>)}</nav><div className="first-use-file-preview" aria-live="polite">{selected ? <><h3>{selected.name}</h3>{selected.isDir ? <p>A folder in this project. Your familiar can help you explore it after you review access.</p> : content === null ? <p>Loading preview…</p> : <pre>{content}</pre>}</> : <><p className="first-use-eyebrow">A place for your next idea</p><h2>{name}</h2><p>Click a file to peek inside. This preview stays in Cave; nothing is sent to a model.</p><code>{root}</code></>}</div></div>
    {error ? <div className="first-use-error" role="alert"><p>{error}</p><Button variant="ghost" size="xs" onClick={() => setEpoch((value) => value + 1)}>Retry preview</Button></div> : null}
  </div>;
}
