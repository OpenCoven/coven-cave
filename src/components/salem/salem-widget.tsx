"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { Icon } from "@/lib/icon";
import type { SalemPreloadContext } from "./salem-context";
import { SalemCat3D } from "./salem-cat-3d";
import { MarkdownBlock } from "@/components/message-bubble";

type Message = { role: "user" | "salem"; text: string };

type SalemMood = "idle" | "thinking" | "happy" | "listening";
type PreloadSummary = { docs: number; tools: number; skills: number; context: number };

const GREETING = "I'm Salem, your sassy Coven docs familiar. Yes, the black-cat-in-the-corner thing is intentional. I'm preloaded with Coven docs, tool context, guide skills, and Cave route awareness. Ask me about familiars, plugins, roles, the marketplace, or how Cave works.";

// ---------------------------------------------------------------------------
// Strip raw <Cards>...</Cards> and <Card .../> JSX blobs from Salem replies
// and replace with clean markdown links.
// ---------------------------------------------------------------------------

function cleanSalemMarkdown(text: string): string {
  // Replace full <Cards>...</Cards> block with extracted Card links
  text = text.replace(/<Cards>([\s\S]*?)<\/Cards>/g, (_match, inner: string) => {
    const links: string[] = [];
    const cardRe = /<Card\s[^>]*title="([^"]*)"[^>]*href="([^"]*)"[^>]*(?:description="([^"]*)")?[^>]*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = cardRe.exec(inner)) !== null) {
      const title = m[1];
      const href = m[2];
      const desc = m[3] ? ` — ${m[3]}` : "";
      links.push(`- [${title}](${href})${desc}`);
    }
    return links.length ? links.join("\n") : "";
  });

  // Also strip any self-closing <Card .../> that leaked outside a <Cards> wrapper
  text = text.replace(/<Card\s[^>]*title="([^"]*)"[^>]*href="([^"]*)"[^>]*(?:description="([^"]*)")?[^>]*\/>/g,
    (_m, title: string, href: string, desc?: string) =>
      `- [${title}](${href})${desc ? ` — ${desc}` : ""}`
  );

  // Strip any remaining stray XML-like tags that aren't standard markdown/html
  text = text.replace(/<\/?Cards>/g, "");

  // Clean up heading anchors like [#some-id] that appear after heading text
  text = text.replace(/\s\[#[\w-]+\]/g, "");

  return text.trim();
}

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
    <div className="salem-perch" onClick={open} role="button" tabIndex={0} aria-label="Open Salem docs familiar" onKeyDown={(e) => e.key === "Enter" && open()}>
      <SalemCat3D mood={mood} size={88} />
      <span className="salem-perch__label">Salem</span>
    </div>
  );
}

export function SalemChatPanel() {
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
      setMessages((m) => [...m, { role: "salem", text: cleanSalemMarkdown(raw) }]);
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
              {preload?.preload.persona.archetype ?? "Sassy male docs familiar"}
            </div>
          </div>
        </div>
        <div className="salem-panel__header-actions">
          <Icon name="ph:book-open" width={14} />
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
          autoFocus
        />
        <button type="submit" className="salem-panel__send salem-panel__send--label" disabled={loading || !input.trim()} aria-label="Send">
          <span className="salem-panel__send-text">SALEM</span>
          <Icon name="ph:arrow-up" width={14} />
        </button>
      </form>
    </section>
  );
}
