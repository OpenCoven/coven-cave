"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { Icon } from "@/lib/icon";
import { MarkdownBlock } from "@/components/message-bubble";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { SalemPathfinderCard } from "./salem-pathfinder-card";
import type { SalemPathfinderCard as SalemPathfinderCardData } from "@/lib/salem/pathfinder-types";

type Message = { role: "user" | "salem"; text: string };

type SalemMood = "idle" | "thinking" | "happy" | "listening";

const GREETING = "I'm Salem, your Coven docs familiar. Yes, the black-cat-in-the-corner thing is intentional. I'm preloaded with Coven docs, tool context, guide skills, and Cave route awareness. Ask me about familiars, plugins, roles, the marketplace, or how Cave works.";

export function SalemChatPanel({ familiarId, model }: { familiarId?: string | null; model?: string | null } = {}) {
  const [mood, setMood] = useState<SalemMood>("idle");
  const [messages, setMessages] = useState<Message[]>([
    { role: "salem", text: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pathfinderCard, setPathfinderCard] = useState<SalemPathfinderCardData | null>(null);
  const [pathfinding, setPathfinding] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const coarse = useIsCoarsePointer();

  // Find your next path — deterministic, registry-backed recommendation. Uses
  // the current input as intent (or a neutral prompt) and renders a card.
  const findPath = async () => {
    if (pathfinding) return;
    setPathfinding(true);
    setMood("thinking");
    try {
      const res = await fetch("/api/salem/pathfinder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "home", userMessage: input.trim() || "help me choose where to start" }),
      });
      const data = (await res.json()) as { card?: SalemPathfinderCardData };
      if (data.card) setPathfinderCard(data.card);
      setMood("happy");
      setTimeout(() => setMood("idle"), 1800);
    } catch {
      setMood("idle");
    } finally {
      setPathfinding(false);
    }
  };

  // Record LOCAL pathfinder feedback (never egresses — see pathfinder-feedback).
  const recordFeedback = (input: {
    pathId: string;
    mode: "setup" | "home";
    helpful?: boolean;
    savedToBoard?: boolean;
    correctionNote?: string;
  }) => {
    void fetch("/api/salem/pathfinder/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => {});
  };

  // Save a recommended path to the Board as a card + checklist (design §"Data
  // Flow" step 8). The card requires an explicit confirm before calling this.
  const saveCardToBoard = async (card: SalemPathfinderCardData): Promise<boolean> => {
    const notes = [
      card.summary,
      card.assumptions.length ? `Assumptions: ${card.assumptions.join("; ")}` : "",
      card.links.length ? `Links: ${card.links.map((l) => l.url).join(", ")}` : "",
      "Source: Salem pathfinder",
    ].filter(Boolean).join("\n\n");
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Salem path: ${card.title}`,
          notes,
          labels: ["salem", "happy-path", card.recommendedPathId],
          links: card.links.map((l) => l.url),
          steps: card.steps.map((s) => ({ text: `${s.title} — ${s.body}` })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      const ok = res.ok && data.ok !== false;
      if (ok) void recordFeedback({ pathId: card.recommendedPathId, mode: card.mode, savedToBoard: true });
      return ok;
    } catch {
      return false;
    }
  };

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
        body: JSON.stringify({
          message: text,
          ...(familiarId ? { familiarId } : {}),
          ...(model ? { model } : {}),
        }),
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
          <div>
            <div className="salem-panel__name">Salem</div>
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
        {pathfinderCard ? (
          <div className="salem-msg salem-msg--salem">
            <SalemPathfinderCard card={pathfinderCard}
              density="full"
              onSave={saveCardToBoard}
              onFeedback={(fb) =>
                recordFeedback({
                  pathId: pathfinderCard.recommendedPathId,
                  mode: pathfinderCard.mode,
                  helpful: fb.helpful,
                  correctionNote: fb.correctionNote,
                })
              }
            />
          </div>
        ) : null}
        {(loading || pathfinding) && (
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
        <button type="submit" className="salem-panel__send" disabled={loading || !input.trim()} aria-label="Send">
          <Icon name="ph:paw-print-fill" width={16} aria-hidden />
        </button>
      </form>
    </section>
  );
}
