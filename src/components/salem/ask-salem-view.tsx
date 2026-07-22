"use client";

// Ask Salem — the dedicated full-screen docs section (mode "salem").
//
// Queries the index in two layers: the hosted docs RAG index (via /api/salem)
// plus the local Cave index (conversation search, board cards, coven + fs
// memory) gathered here and sent as untrusted context. The answer is
// synthesized through a familiar the user picks — that familiar's connected
// model/provider owns the run — and the thread persists across visits
// (localStorage, capped). The split-pane SalemChatPanel stays the quick-ask
// companion; this surface is the destination for longer consultations.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Familiar } from "@/lib/types";
import { Icon } from "@/lib/icon";
import { smoothScrollBehavior } from "@/lib/use-prefers-reduced-motion";
import { MarkdownBlock } from "@/components/message-bubble";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { defaultModelForRuntime } from "@/lib/runtime-models";
import { SalemCat, type SalemMood } from "./salem-cat";
import {
  clearThread,
  historyForApi,
  loadThread,
  pickAskFamiliar,
  saveThread,
  buildAskSalemContext,
  type AskSalemMessage,
} from "@/lib/salem/ask-salem-thread";

const INTRO =
  "This is my study — ask away. I'm preloaded with the OpenCoven docs corpus and I'll pull in anything relevant from your own Cave: chats, tasks, and memories. Answers are written by the familiar you pick up top, so the model you already connected does the thinking.";

/** The connected model an option advertises: the familiar's saved model, or
 *  its harness default when none is pinned yet. */
function familiarModelLabel(familiar: Familiar): string {
  if (familiar.model?.trim()) return familiar.model.trim();
  const harness = familiar.harnessOverride ?? familiar.harness ?? familiar.defaultHarness;
  return harness ? defaultModelForRuntime(harness) : "default model";
}

/** Fetch one local corpus, degrading to null so a single failed source never
 *  blocks the ask (the context is a bonus, not a dependency). */
async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Gather the local Cave index corpora for a question (best-effort). */
async function gatherLocalCorpora(query: string) {
  const [search, board, coven, fs] = await Promise.all([
    fetchJson(`/api/chat/search?q=${encodeURIComponent(query)}`),
    fetchJson("/api/board"),
    fetchJson("/api/coven-memory"),
    fetchJson("/api/memory"),
  ]);
  const hits = (search as { ok?: boolean; hits?: unknown })?.ok
    ? (search as { hits?: unknown }).hits
    : null;
  const cards = (board as { ok?: boolean; cards?: unknown })?.ok
    ? (board as { cards?: unknown }).cards
    : null;
  const covenEntries = (coven as { ok?: boolean; entries?: unknown })?.ok
    ? (coven as { entries?: unknown }).entries
    : null;
  const fsEntries = (fs as { ok?: boolean; entries?: unknown })?.ok
    ? (fs as { entries?: unknown }).entries
    : null;
  return {
    conversationHits: Array.isArray(hits) ? hits : [],
    cards: Array.isArray(cards) ? cards : [],
    covenMemory: Array.isArray(covenEntries) ? covenEntries : [],
    fsMemory: Array.isArray(fsEntries) ? fsEntries : [],
  };
}

export function AskSalemView({
  familiars,
  activeFamiliarId,
}: {
  familiars: Familiar[];
  activeFamiliarId: string | null;
}) {
  const [messages, setMessages] = useState<AskSalemMessage[]>(() =>
    typeof window === "undefined" ? [] : loadThread(window.localStorage),
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [mood, setMood] = useState<SalemMood>("idle");
  // null = follow the default (active familiar); a string = explicit pick.
  const [pickedFamiliarId, setPickedFamiliarId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const coarse = useIsCoarsePointer();

  const selectedFamiliar = useMemo(() => {
    if (pickedFamiliarId) {
      const picked = familiars.find((f) => f.id === pickedFamiliarId);
      if (picked) return picked;
    }
    return pickAskFamiliar(familiars, activeFamiliarId);
  }, [familiars, pickedFamiliarId, activeFamiliarId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: smoothScrollBehavior() });
  }, [messages, loading]);

  const persist = (next: AskSalemMessage[]) => {
    setMessages(next);
    if (typeof window !== "undefined") saveThread(window.localStorage, next);
  };

  const clear = () => {
    if (typeof window !== "undefined") clearThread(window.localStorage);
    setMessages([]);
    setMood("idle");
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    // History = the turns before this question; the question itself rides `message`.
    const history = historyForApi(messages);
    const withQuestion = [...messages, { role: "user" as const, text, at: Date.now() }];
    persist(withQuestion);
    setLoading(true);
    setMood("thinking");

    try {
      const corpora = await gatherLocalCorpora(text);
      const context = buildAskSalemContext(text, corpora);
      const res = await fetch("/api/salem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          ...(context ? { context } : {}),
          ...(selectedFamiliar ? { familiarId: selectedFamiliar.id } : {}),
          ...(selectedFamiliar?.model ? { model: selectedFamiliar.model } : {}),
          ...(history.length ? { history } : {}),
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      const reply = data.reply ?? data.error ?? "Hmm, I couldn't find that one. Try rephrasing?";
      persist([...withQuestion, { role: "salem", text: reply, at: Date.now() }]);
      setMood("happy");
      setTimeout(() => setMood("idle"), 2000);
    } catch {
      persist([
        ...withQuestion,
        { role: "salem", text: "I had a hairball moment — couldn't reach my docs brain right now.", at: Date.now() },
      ]);
      setMood("idle");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="ask-salem" aria-label="Ask Salem">
      <div className="ask-salem__column">
        <header className="ask-salem__header">
          <div className="ask-salem__identity">
            <SalemCat mood={mood} size={40} />
            <div>
              <h1 className="ask-salem__title">Ask Salem</h1>
              <p className="ask-salem__subtitle">
                Docs familiar · grounded by the Coven index and your Cave
              </p>
            </div>
          </div>
          <div className="ask-salem__controls">
            {familiars.length > 0 && selectedFamiliar ? (
              <label className="ask-salem__picker">
                <span className="ask-salem__picker-label">Answers via</span>
                <select
                  className="ask-salem__picker-select focus-ring"
                  aria-label="Familiar whose connected model writes the answers"
                  value={selectedFamiliar.id}
                  onChange={(e) => setPickedFamiliarId(e.target.value)}
                >
                  {familiars.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.display_name} — {familiarModelLabel(f)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="ask-salem__picker-hint">
                No familiars connected yet — answers use Salem&apos;s hosted docs brain.
              </span>
            )}
            {messages.length > 0 ? (
              <button
                type="button"
                className="salem-btn-icon focus-ring"
                onClick={clear}
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                <Icon name="ph:trash" width={15} aria-hidden />
              </button>
            ) : null}
          </div>
        </header>

        <div className="ask-salem__messages salem-panel__messages">
          {messages.length === 0 ? (
            <div className="salem-msg salem-msg--salem">
              <div className="salem-msg__md">
                <MarkdownBlock text={INTRO} />
              </div>
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div key={`${m.at ?? i}-${i}`} className={`salem-msg salem-msg--${m.role}`}>
              {m.role === "salem" ? (
                <div className="salem-msg__md">
                  <MarkdownBlock text={m.text} />
                </div>
              ) : (
                <span className="salem-msg__text">{m.text}</span>
              )}
            </div>
          ))}
          {loading ? (
            <div className="salem-msg salem-msg--salem">
              <span className="salem-msg__text salem-thinking">
                consulting the index<span className="dots" />
              </span>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <form className="ask-salem__input-row salem-panel__input-row" onSubmit={send}>
          <input
            className="salem-panel__input"
            placeholder="Ask about Coven, familiars, plugins — or anything in your Cave…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setMood(e.target.value ? "listening" : "idle");
            }}
            disabled={loading}
            autoFocus={!coarse}
            aria-label="Ask Salem a question"
            inputMode="text"
            enterKeyHint="send"
          />
          <button
            type="submit"
            className="salem-panel__send"
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            <Icon name="ph:paw-print-fill" width={16} aria-hidden />
          </button>
        </form>
      </div>
    </section>
  );
}
