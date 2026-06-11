"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/lib/icon";
import type { SalemPreloadContext } from "./salem-context";
import { MarkdownBlock } from "@/components/message-bubble";
import { useIsCoarsePointer } from "@/lib/use-viewport";

// Salem's 3D cat avatar shows up in two places — the floating perch
// (88px) and the chat panel (40px). Dynamic-import so Three.js doesn't
// land in the initial bundle for users who never open Salem. SSR off
// because WebGL needs a real canvas. The loading placeholder is the
// same size as the rendered canvas so layout doesn't shift.
const SalemCat3D = dynamic(
  () => import("./salem-cat-3d").then((m) => m.SalemCat3D),
  {
    ssr: false,
    loading: () => null,
  },
);

type Message = { role: "user" | "salem"; text: string };

type SalemMood = "idle" | "thinking" | "happy" | "listening";

const GREETING = "I'm Salem, your Coven docs familiar. Yes, the black-cat-in-the-corner thing is intentional. I'm preloaded with Coven docs, tool context, guide skills, and Cave route awareness. Ask me about familiars, plugins, roles, the marketplace, or how Cave works.";

function openSalemPanel() {
  window.dispatchEvent(new CustomEvent("cave:salem-open"));
}

export function SalemWidget() {
  const [mood, setMood] = useState<SalemMood>("idle");
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    const dock = () => setDocked(true);
    const undock = () => setDocked(false);
    window.addEventListener("cave:salem-open", dock);
    window.addEventListener("cave:salem-undock", undock);
    return () => {
      window.removeEventListener("cave:salem-open", dock);
      window.removeEventListener("cave:salem-undock", undock);
    };
  }, []);

  const open = () => {
    setDocked(true);
    openSalemPanel();
    setMood("happy");
    setTimeout(() => setMood("idle"), 1800);
  };

  if (docked) return null;

  return (
    <button type="button" className="salem-perch" onClick={open} aria-label="Open Salem docs familiar">
      <SalemCat3D mood={mood} size={88} />
      <span className="salem-perch__label">Salem</span>
    </button>
  );
}

export function SalemChatPanel() {
  const [mood, setMood] = useState<SalemMood>("idle");
  const [messages, setMessages] = useState<Message[]>([
    { role: "salem", text: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [preload, setPreload] = useState<SalemPreloadContext | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const coarse = useIsCoarsePointer();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let alive = true;
    fetch("/api/salem")
      .then((res) => res.json())
      .then((data: { preload?: SalemPreloadContext }) => {
        if (alive && data.preload) {
          setPreload(data.preload);
        }
      })
      .catch(() => { if (alive) setPreload(null); });
    return () => { alive = false; };
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
      const raw = data.reply ?? data.error ?? "Hmm, I couldn't find that one. Try rephrasing?";
      setMessages((m) => [...m, { role: "salem", text: raw }]);
      setMood("happy");
      setTimeout(() => setMood("idle"), 2000);
    } catch {
      setMessages((m) => [...m, { role: "salem", text: "I had a hairball moment — couldn't reach my docs brain right now." }]);
      setMood("idle");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="salem-panel salem-panel--rail" aria-label="Salem docs familiar">
      {/* Header */}
      <div className="salem-panel__header">
        <div className="salem-panel__header-identity">
          <SalemCat3D mood={mood} size={40} />
          <div>
            <div className="salem-panel__name">Salem</div>
            <div className="salem-panel__subtitle">
              {preload?.persona.archetype ?? "Male docs familiar"}
            </div>
          </div>
        </div>
        <div className="salem-panel__header-actions">
          <Icon name="ph:book-open" width={14} />
        </div>
      </div>

      {/* Messages */}
      <div className="salem-panel__messages">
        {messages.map((m, i) => (
          <div key={i} className={`salem-msg salem-msg--${m.role}`}>
            {m.role === "salem" ? (
              <div className="salem-msg__md">
                <MarkdownBlock text={m.text} />
              </div>
            ) : (
              <span className="salem-msg__text">{m.text}</span>
            )}
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
          autoFocus={!coarse}
          aria-label="Search Salem docs"
          inputMode="text"
          enterKeyHint="send"
        />
        <button type="submit" className="salem-panel__send salem-panel__send--label" disabled={loading || !input.trim()} aria-label="Send">
          <span className="salem-panel__send-text">SALEM</span>
          <Icon name="ph:arrow-up" width={14} />
        </button>
      </form>
    </section>
  );
}
