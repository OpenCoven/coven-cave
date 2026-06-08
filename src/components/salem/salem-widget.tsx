"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { Icon } from "@/lib/icon";
import type { SalemPreloadContext } from "./salem-context";
import { SalemCat3D } from "./salem-cat-3d";

type Message = { role: "user" | "salem"; text: string };

type SalemMood = "idle" | "thinking" | "happy" | "listening";
type PreloadSummary = { docs: number; tools: number; skills: number; context: number };

const GREETING = "I'm Salem, your sassy Coven docs familiar. Yes, the black-cat-in-the-corner thing is intentional. I'm preloaded with Coven docs, tool context, guide skills, and Cave route awareness. Ask me about familiars, plugins, roles, the marketplace, or how Cave works.";

/**
 * Salem — floating bottom-right docs familiar for CovenCave.
 *
 * Three states:
 * - perch: tiny 3D kitty sitting quietly, click to open
 * - open: 360×480 docs chat panel anchored bottom-right
 * - expanded: full-viewport panel
 */
export function SalemWidget() {
  const [state, setState] = useState<"perch" | "open" | "expanded">("perch");
  const [mood, setMood] = useState<SalemMood>("idle");
  const [messages, setMessages] = useState<Message[]>([
    { role: "salem", text: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [preload, setPreload] = useState<{
    summary: PreloadSummary;
    preload: SalemPreloadContext;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let alive = true;

    fetch("/api/salem")
      .then((res) => res.json())
      .then((data: { summary?: PreloadSummary; preload?: SalemPreloadContext }) => {
        if (alive && data.summary && data.preload) {
          setPreload({ summary: data.summary, preload: data.preload });
        }
      })
      .catch(() => {
        if (alive) {
          setPreload(null);
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);
    setMood("thinking");

    try {
      const res = await fetch("/api/salem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setMessages((m) => [
        ...m,
        { role: "salem", text: data.reply ?? data.error ?? "Hmm, I couldn't find that one. Try rephrasing?" },
      ]);
      setMood("happy");
      setTimeout(() => setMood("idle"), 2000);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "salem", text: "I had a hairball moment - couldn't reach my docs brain right now." },
      ]);
      setMood("idle");
    } finally {
      setLoading(false);
    }
  };

  // Perch state — tiny floating kitty
  if (state === "perch") {
    return (
      <div className="salem-perch" onClick={() => { setState("open"); setMood("happy"); setTimeout(() => setMood("idle"), 1800); }} role="button" tabIndex={0} aria-label="Open Salem docs familiar" onKeyDown={(e) => e.key === "Enter" && setState("open")}>
        <SalemCat3D mood={mood} size={88} />
        <span className="salem-perch__label">Salem</span>
      </div>
    );
  }

  const isExpanded = state === "expanded";

  return (
    <div className={`salem-panel${isExpanded ? " salem-panel--expanded" : ""}`} role="dialog" aria-label="Salem docs familiar">
      {/* Header */}
      <div className="salem-panel__header">
        <div className="salem-panel__header-identity">
          <SalemCat3D mood={mood} size={40} />
          <div>
            <div className="salem-panel__name">Salem</div>
            <div className="salem-panel__subtitle">
              {preload?.preload.persona.archetype ?? "Sassy male docs familiar"}
            </div>
          </div>
        </div>
        <div className="salem-panel__header-actions">
          <button
            type="button"
            className="salem-btn-icon"
            onClick={() => setState(isExpanded ? "open" : "expanded")}
            aria-label={isExpanded ? "Shrink" : "Expand"}
            title={isExpanded ? "Shrink" : "Expand"}
          >
            <Icon name={isExpanded ? "ph:arrows-in-simple" : "ph:arrows-out-simple"} width={14} />
          </button>
          <button
            type="button"
            className="salem-btn-icon"
            onClick={() => { setState("perch"); setMood("idle"); }}
            aria-label="Close Salem"
            title="Close"
          >
            <Icon name="ph:x" width={14} />
          </button>
        </div>
      </div>

      {preload ? (
        <div className="salem-panel__preload" aria-label="Salem loaded context">
          <span title={preload.preload.docsCorpus.map((item) => item.label).join(", ")}>
            Docs {preload.summary.docs}
          </span>
          <span title={preload.preload.toolLoadout.map((item) => item.label).join(", ")}>
            Tools {preload.summary.tools}
          </span>
          <span title={preload.preload.skillLoadout.map((item) => item.label).join(", ")}>
            Skills {preload.summary.skills}
          </span>
          <span title={preload.preload.routeContext.map((item) => item.label).join(", ")}>
            Context {preload.summary.context}
          </span>
        </div>
      ) : null}

      {/* Messages */}
      <div className="salem-panel__messages">
        {messages.map((m, i) => (
          <div key={i} className={`salem-msg salem-msg--${m.role}`}>
            <span className="salem-msg__text">{m.text}</span>
          </div>
        ))}
        {loading && (
          <div className="salem-msg salem-msg--salem">
            <span className="salem-msg__text salem-thinking">thinking<span className="dots" /></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form className="salem-panel__input-row" onSubmit={send}>
        <input
          className="salem-panel__input"
          placeholder="Ask about Coven, familiars, plugins…"
          value={input}
          onChange={(e) => { setInput(e.target.value); if (e.target.value) setMood("listening"); else setMood("idle"); }}
          disabled={loading}
          autoFocus
        />
        <button type="submit" className="salem-panel__send" disabled={loading || !input.trim()} aria-label="Send">
          <Icon name="ph:arrow-up" width={14} />
        </button>
      </form>
    </div>
  );
}
