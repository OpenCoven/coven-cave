"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { SalemCat3D } from "./salem-cat-3d";

type Message = { role: "user" | "salem"; text: string };

type SalemMood = "idle" | "thinking" | "happy" | "listening";

const GREETING = "Hey there ✨ I'm Salem, your Coven docs familiar. Ask me anything about familiars, plugins, roles, the marketplace, or how Cave works!";

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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        { role: "salem", text: "I had a hairball moment 😅 — couldn't reach my docs brain right now." },
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
        <SalemCat3D mood={mood} size={80} />
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
            <div className="salem-panel__subtitle">Coven docs familiar</div>
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
            {isExpanded ? "⊡" : "⊞"}
          </button>
          <button
            type="button"
            className="salem-btn-icon"
            onClick={() => { setState("perch"); setMood("idle"); }}
            aria-label="Close Salem"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="salem-panel__messages">
        {messages.map((m, i) => (
          <div key={i} className={`salem-msg salem-msg--${m.role}`}>
            {m.role === "salem" && <span className="salem-msg__glyph">🐱</span>}
            <span className="salem-msg__text">{m.text}</span>
          </div>
        ))}
        {loading && (
          <div className="salem-msg salem-msg--salem">
            <span className="salem-msg__glyph">🐱</span>
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
          ↑
        </button>
      </form>
    </div>
  );
}
