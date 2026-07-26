"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { Icon } from "@/lib/icon";
import { smoothScrollBehavior } from "@/lib/use-prefers-reduced-motion";
import { MarkdownBlock } from "@/components/message-bubble";
import { useIsCoarsePointer } from "@/lib/use-viewport";

type Message = { role: "user" | "salem"; text: string };

const GREETING = "I'm Salem, your Coven docs familiar. Yes, the black-cat-in-the-corner thing is intentional. I'm preloaded with Coven docs, tool context, guide skills, and Cave route awareness. Ask me about familiars, plugins, roles, the marketplace, or how Cave works.";

export function SalemChatPanel({ familiarId, model }: { familiarId?: string | null; model?: string | null } = {}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "salem", text: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const coarse = useIsCoarsePointer();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: smoothScrollBehavior() });
  }, [messages]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/salem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          ...(familiarId ? { familiarId } : {}),
          ...(model ? { model } : {}),
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      const raw = data.reply ?? data.error ?? "Hmm, I couldn't find that one. Try rephrasing?";
      setMessages((m) => [...m, { role: "salem", text: raw }]);
    } catch {
      setMessages((m) => [...m, { role: "salem", text: "I had a hairball moment — couldn't reach my docs brain right now." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="salem-panel salem-panel--rail" aria-label="Salem docs familiar">
      {/* Header */}
      <div className="salem-panel__header">
        <div className="salem-panel__header-identity">
          <div>
            <div className="salem-panel__name">Salem</div>
          </div>
        </div>
        <div className="salem-panel__header-actions">
          <button
            type="button"
            className="salem-btn-icon focus-ring"
            title="Open full view"
            aria-label="Open Ask Salem full view"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("cave:navigate-mode", { detail: { mode: "salem" } }),
              )
            }
          >
            <Icon name="ph:arrows-out-simple" width={14} aria-hidden />
          </button>
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
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          autoFocus={!coarse}
          aria-label="Search Salem docs"
          inputMode="text"
          enterKeyHint="send"
        />
        <button type="submit" className="salem-panel__send" disabled={loading || !input.trim()} aria-label="Send">
          <Icon name="ph:paw-print-fill" width={16} aria-hidden />
        </button>
      </form>
    </section>
  );
}
