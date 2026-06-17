"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { Icon } from "@/lib/icon";
import type { SalemPreloadContext } from "./salem-context";
import { MarkdownBlock } from "@/components/message-bubble";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { SalemPathfinderCard } from "./salem-pathfinder-card";
import type { SalemPathfinderCard as SalemPathfinderCardData } from "@/lib/salem/pathfinder-types";
// Salem's 2D cat avatar (floating perch 88px + chat panel 40px). Replaced the
// former Three.js scene to drop the heavy WebGL `three` dependency.
import { SalemCat } from "./salem-cat";

type Message = { role: "user" | "salem"; text: string };

type SalemMood = "idle" | "thinking" | "happy" | "listening";

type SalemWidgetProps = {
  retreat?: boolean;
};

const GREETING = "I'm Salem, your Coven docs familiar. Yes, the black-cat-in-the-corner thing is intentional. I'm preloaded with Coven docs, tool context, guide skills, and Cave route awareness. Ask me about familiars, plugins, roles, the marketplace, or how Cave works.";

function openSalemPanel() {
  window.dispatchEvent(new CustomEvent("cave:salem-open"));
}

export function SalemWidget({ retreat = false }: SalemWidgetProps) {
  const [mood, setMood] = useState<SalemMood>("idle");
  const [docked, setDocked] = useState(false);
  const [edgeRetreating, setEdgeRetreating] = useState(false);
  const perchRef = useRef<HTMLButtonElement>(null);
  const coarse = useIsCoarsePointer();
  const reducedMotion = usePrefersReducedMotion();

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

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.clientX >= window.innerWidth - 2) setEdgeRetreating(true);
      if (event.clientX < window.innerWidth - 96) setEdgeRetreating(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  // Proximity: the perch rests small + translucent and grows toward full size /
  // opacity as the cursor approaches it. Drives a `--salem-proximity` CSS var
  // (0 far → 1 near), written straight to the node in a rAF tick to avoid a
  // re-render per pointer move. Skipped on touch / reduced-motion (CSS pins the
  // var to 1 there so the perch is always fully visible).
  useEffect(() => {
    if (coarse || reducedMotion || docked) return;
    const el = perchRef.current;
    if (!el) return;
    const RADIUS = 280;
    let raf = 0;
    let target = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty("--salem-proximity", target.toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy);
      target = Math.max(0, Math.min(1, 1 - distance / RADIUS));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [coarse, reducedMotion, docked]);

  const open = () => {
    setDocked(true);
    openSalemPanel();
    setMood("happy");
    setTimeout(() => setMood("idle"), 1800);
  };

  if (docked) return null;

  return (
    <button
      ref={perchRef}
      type="button"
      className={`salem-perch${retreat || edgeRetreating ? " salem-perch--retreating" : ""}`}
      onClick={open}
      aria-label="Open Salem docs familiar"
    >
      <SalemCat mood={mood} size={88} />
      <span className="salem-perch__label">
        <Icon name="ph:chat-circle-dots-fill" width={16} aria-hidden />
      </span>
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
          <SalemCat mood={mood} size={40} />
          <div>
            <div className="salem-panel__name">Salem</div>
            <div className="salem-panel__subtitle">
              {preload?.persona.archetype ?? "Male docs familiar"}
            </div>
          </div>
        </div>
        <div className="salem-panel__header-actions">
          <button
            type="button"
            className="salem-panel__pathfind"
            onClick={findPath}
            disabled={pathfinding}
            aria-label="Find your next path"
            title="Find your next path"
          >
            <Icon name="ph:sparkle" width={13} aria-hidden />
            <span className="salem-panel__pathfind-text">Find your next path</span>
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
        <button type="submit" className="salem-panel__send salem-panel__send--label" disabled={loading || !input.trim()} aria-label="Send">
          <span className="salem-panel__send-text">SALEM</span>
          <Icon name="ph:arrow-up" width={14} />
        </button>
      </form>
    </section>
  );
}
