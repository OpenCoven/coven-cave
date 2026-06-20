"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { relativeTime } from "@/lib/daily-report";
import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  buildSketchPrompt,
  clampArtifactCode,
  titleFromPrompt,
  type CanvasArtifact,
} from "@/lib/canvas-artifacts";
import { buildReactSrcDoc } from "@/lib/canvas-react-harness";
import { generateArtifactCode } from "@/lib/canvas-generate";
import type { Familiar } from "@/lib/types";

function srcDocFor(art: CanvasArtifact): string {
  return art.kind === "react" ? buildReactSrcDoc(art.code) : buildPreviewSrcDoc(art.code);
}

export function CanvasList({
  familiars,
  activeFamiliarId,
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
}) {
  const [artifacts, setArtifacts] = useState<CanvasArtifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isDemoModeEnabled()) {
      setArtifacts([]);
      return;
    }
    try {
      const res = await fetch("/api/canvas", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      const list: CanvasArtifact[] = Array.isArray(json.artifacts) ? json.artifacts : [];
      setArtifacts(list);
      setSelectedId((prev) => prev ?? list[list.length - 1]?.id ?? null);
    } catch {
      setArtifacts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback((art: CanvasArtifact) => {
    void fetch("/api/canvas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifact: art }),
    }).catch(() => undefined);
  }, []);

  const runGeneration = useCallback(
    async (id: string, ask: string, refineOf?: CanvasArtifact) => {
      const familiarId = activeFamiliarId ?? familiars[0]?.id ?? null;
      if (!familiarId) {
        setError("Pick a familiar first — generation runs through it.");
        return;
      }
      setError(null);
      setGenerating((prev) => new Set(prev).add(id));
      const sendPrompt = refineOf
        ? buildRefinePrompt(refineOf.code, ask, refineOf.kind ?? "html")
        : buildSketchPrompt(ask);
      const result = await generateArtifactCode({ prompt: sendPrompt, familiarId });
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (result.error || !result.code) {
        setError(result.error ?? "The familiar didn't return a renderable UI.");
        return;
      }
      const code = clampArtifactCode(result.code);
      setArtifacts((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const next: CanvasArtifact = {
            ...a,
            code,
            kind: result.kind ?? a.kind,
            updatedAt: new Date().toISOString(),
          };
          persist(next);
          return next;
        }),
      );
      setView("preview");
    },
    [activeFamiliarId, familiars, persist],
  );

  const createArtifact = useCallback(
    (ask: string) => {
      const text = ask.trim();
      if (!text) return;
      const id = `art-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const art: CanvasArtifact = {
        id,
        title: titleFromPrompt(text),
        prompt: text,
        code: "",
        kind: "html",
        createdAt: now,
        updatedAt: now,
      };
      setArtifacts((prev) => [...prev, art]);
      setSelectedId(id);
      persist(art);
      void runGeneration(id, text);
    },
    [persist, runGeneration],
  );

  const removeArtifact = useCallback((id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
    void fetch("/api/canvas", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  }, []);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const canGenerate = Boolean(activeFamiliarId ?? familiars[0]?.id);

  return (
    <div className="journal-list">
      <aside className="journal-list__rail">
        <form
          className="journal-composer"
          onSubmit={(e) => {
            e.preventDefault();
            createArtifact(prompt);
            setPrompt("");
          }}
        >
          <input
            className="journal-composer__input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={canGenerate ? "Describe a sketch to generate…" : "Pick a familiar to generate"}
            disabled={!canGenerate}
            aria-label="Describe a sketch to generate"
          />
          <button type="submit" className="journal-composer__btn" disabled={!canGenerate || !prompt.trim()}>
            <Icon name="ph:plus" aria-hidden /> New
          </button>
        </form>
        {error ? (
          <div className="journal-list__error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="journal-list__cap">Generated sketches</div>
        {artifacts.length === 0 ? (
          <div className="journal-empty">No sketches yet. Generate one above.</div>
        ) : (
          <ul className="journal-list__items">
            {[...artifacts].reverse().map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`journal-art${a.id === selectedId ? " is-selected" : ""}`}
                  onClick={() => {
                    setSelectedId(a.id);
                    setView("preview");
                  }}
                >
                  <span className="journal-art__title">{a.title || "Untitled sketch"}</span>
                  <span className="journal-art__meta">
                    <span className={`journal-kind journal-kind--${a.kind ?? "html"}`}>{a.kind ?? "html"}</span>
                    {generating.has(a.id) ? " · generating…" : ` · ${relativeTime(a.updatedAt)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="journal-detail" aria-label="Sketch preview">
        {selected ? (
          <>
            <div className="journal-detail__bar">
              <div className="journal-seg" role="tablist" aria-label="Preview or code">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "preview"}
                  className={view === "preview" ? "on" : ""}
                  onClick={() => setView("preview")}
                >
                  Preview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "code"}
                  className={view === "code" ? "on" : ""}
                  onClick={() => setView("code")}
                >
                  Code
                </button>
              </div>
              <div className="journal-detail__actions">
                <button
                  type="button"
                  className="journal-act"
                  disabled={!canGenerate || generating.has(selected.id)}
                  onClick={() => runGeneration(selected.id, selected.prompt, selected)}
                >
                  <Icon name="ph:arrows-clockwise" aria-hidden /> Refine
                </button>
                <button
                  type="button"
                  className="journal-act journal-act--danger"
                  onClick={() => removeArtifact(selected.id)}
                  aria-label="Delete sketch"
                >
                  <Icon name="ph:trash" aria-hidden />
                </button>
              </div>
            </div>
            {view === "preview" ? (
              <iframe
                className="journal-detail__frame"
                title={selected.title || "Sketch preview"}
                sandbox="allow-scripts"
                srcDoc={srcDocFor(selected)}
              />
            ) : (
              <textarea className="journal-detail__code" readOnly value={selected.code} aria-label="Sketch code" />
            )}
            <div className="journal-detail__prompt">Prompt: “{selected.prompt}”</div>
          </>
        ) : (
          <div className="journal-empty journal-empty--pane">Select a sketch to preview it.</div>
        )}
      </section>
    </div>
  );
}
