"use client";

/**
 * library-chat-panel.tsx
 *
 * "Chat with this doc" panel for CovenCave library.
 * Renders a chat interface grounded in the currently-open document,
 * streaming responses from POST /api/library/chat via SSE.
 *
 * Design notes:
 * - Markdown rendering mirrors the getMdFn() pattern from library-doc-preview.tsx
 *   but is co-located here (no circular import).
 * - In-progress streaming messages render as plain pre-wrapped text to avoid
 *   re-parsing on every chunk; finalize to rendered markdown on "done".
 * - Auto-scrolls to bottom on new content.
 * - Enter sends, Shift+Enter inserts a newline.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "@/lib/icon";
import { prefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { sanitizeHtml } from "@/lib/html-sanitize";
import type { LibraryDocBody } from "@/lib/library-types";

// ── Types ────────────────────────────────────────────────────────

type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  /** Raw markdown/plain text content. */
  text: string;
  /** Rendered HTML (set once the message is finalized). */
  html?: string;
  /** Whether this message is still being streamed in. */
  streaming?: boolean;
  /** Non-null if an error occurred while producing this message. */
  error?: string;
};

type SseEvent =
  | { kind: "chunk"; text: string }
  | { kind: "done"; durationMs: number }
  | { kind: "error"; error: string };

// ── Markdown rendering (lazy, same pattern as library-doc-preview) ──

type MdFn = (md: string) => Promise<string>;
let mdFnCached: MdFn | null = null;

async function getMdFn(): Promise<MdFn> {
  if (mdFnCached) return mdFnCached;
  const { renderAsync } = await import("@create-markdown/preview");
  const { parse } = await import("@create-markdown/core");
  const { renderTableReplacements } = await import("@/lib/markdown-table-cells");
  mdFnCached = async (markdown: string) => {
    const blocks = parse(markdown);
    const tables = await renderTableReplacements(blocks, renderAsync);
    let tableIdx = 0;
    return renderAsync(blocks, {
      customRenderers: { table: () => tables[tableIdx++] ?? "" },
    });
  };
  return mdFnCached;
}

async function renderMarkdown(text: string): Promise<string> {
  const fn = await getMdFn();
  const raw = await fn(text);
  return sanitizeHtml(raw);
}

// ── Greeting ─────────────────────────────────────────────────────

const GREETING_TEXT =
  "I've read this document. Ask me anything about it — claims, structure, connections to other research, or anything you want to think through.";

function makeGreeting(): ChatMessage {
  return {
    id: "greeting",
    role: "assistant",
    text: GREETING_TEXT,
  };
}

function makeId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── RenderedBubble — renders finalized markdown into an HTML div ──

function RenderedBubble({ text, html }: { text: string; html?: string }) {
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(html ?? null);
  const [rendering, setRendering] = useState(!html);

  useEffect(() => {
    if (html) {
      setResolvedHtml(html);
      setRendering(false);
      return;
    }
    let cancelled = false;
    setRendering(true);
    void renderMarkdown(text).then((result) => {
      if (cancelled) return;
      setResolvedHtml(result);
      setRendering(false);
    });
    return () => { cancelled = true; };
  }, [text, html]);

  if (rendering) {
    return (
      <div className="library-chat-bubble-text library-chat-bubble-text--loading">
        {text}
      </div>
    );
  }
  if (!resolvedHtml) return null;
  return (
    <div
      className="cave-md library-chat-bubble-text"
      dangerouslySetInnerHTML={{ __html: resolvedHtml }}
    />
  );
}

// ── Spinner ──────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="library-chat-spinner" aria-hidden="true">
      <span className="library-chat-spinner-dot" />
      <span className="library-chat-spinner-dot" />
      <span className="library-chat-spinner-dot" />
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────

export type LibraryChatPanelProps = {
  doc: LibraryDocBody;
  familiarId?: string;
};

export function LibraryChatPanel({ doc, familiarId = "sage" }: LibraryChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [makeGreeting()]);
  const [inputValue, setInputValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Auto-scroll ────────────────────────────────────────────────

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    // Respect reduced motion: a "smooth" request becomes an instant jump.
    const effective = behavior === "smooth" && prefersReducedMotion() ? "auto" : behavior;
    messagesEndRef.current?.scrollIntoView({ behavior: effective, block: "end" });
  }, []);

  useLayoutEffect(() => {
    scrollToBottom("auto");
  }, [messages.length, scrollToBottom]);

  // Smooth scroll when streaming chunks arrive
  useEffect(() => {
    if (streaming) scrollToBottom("smooth");
  }, [messages, streaming, scrollToBottom]);

  // ── Auto-resize textarea ───────────────────────────────────────

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Clamp: 1 line min, ~4 lines max (line-height ~20px, padding ~16px)
    const maxH = 20 * 4 + 16;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [inputValue, resizeTextarea]);

  // ── Send ───────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || streaming || !doc.absolutePath) return;

    const userMsg: ChatMessage = { id: makeId(), role: "user", text };

    // Build history for the API: all prior messages except the greeting,
    // excluding any error stubs.
    const history = messages
      .filter((m) => m.id !== "greeting" && !m.error)
      .map((m) => ({ role: m.role, text: m.text }));

    // Add user message immediately
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setStreaming(true);

    // Placeholder streaming assistant message
    const assistantId = makeId();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      streaming: true,
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    // Abort any in-flight request (shouldn't happen since input is disabled)
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/library/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          docPath: doc.absolutePath,
          messages: [...history, { role: "user", text }],
          familiarId,
        }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: SseEvent;
          try {
            event = JSON.parse(raw) as SseEvent;
          } catch {
            continue;
          }

          if (event.kind === "chunk") {
            accumulated += event.text;
            const snapshot = accumulated;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, text: snapshot, streaming: true }
                  : m,
              ),
            );
          } else if (event.kind === "done") {
            // Finalize: render markdown, clear streaming flag
            const finalText = accumulated;
            const html = finalText ? await renderMarkdown(finalText) : undefined;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, text: finalText, html, streaming: false }
                  : m,
              ),
            );
            setStreaming(false);
          } else if (event.kind === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      text: accumulated || "An error occurred.",
                      streaming: false,
                      error: event.error,
                    }
                  : m,
              ),
            );
            setStreaming(false);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // User-cancelled — clean up gracefully
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
        setStreaming(false);
        return;
      }

      const msg =
        err instanceof Error ? err.message : "Network error. Please try again.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: "", streaming: false, error: msg }
            : m,
        ),
      );
      setStreaming(false);
    }
  }, [inputValue, streaming, doc.absolutePath, messages, familiarId]);

  // ── Keyboard handler ───────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    },
    [sendMessage],
  );

  // ── Clear ──────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setInputValue("");
    setMessages([makeGreeting()]);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // ── No absolutePath guard ──────────────────────────────────────

  if (!doc.absolutePath) {
    return (
      <div className="library-chat-panel">
        <div className="library-chat-empty-notice">
          <Icon name="ph:chats" width={28} className="library-chat-empty-notice-icon" />
          <p className="library-chat-empty-notice-text">
            This document cannot be chatted with (no local path available).
          </p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="library-chat-panel">
      {/* Header */}
      <div className="library-chat-header">
        <span className="library-chat-header-label">
          <Icon name="ph:robot" width={13} className="library-chat-header-icon" />
          Chat with Sage
        </span>
        <button
          type="button"
          className="library-chat-clear-btn"
          onClick={handleClear}
          title="Clear conversation"
          aria-label="Clear conversation"
        >
          <Icon name="ph:arrow-counter-clockwise" width={12} />
          <span>Clear</span>
        </button>
      </div>

      {/* Message list */}
      <div className="library-chat-messages" role="log" aria-live="polite" aria-label="Chat messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={[
              "library-chat-message",
              `library-chat-message--${msg.role}`,
              msg.streaming ? "library-chat-message--streaming" : "",
              msg.error ? "library-chat-message--error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={[
                "library-chat-bubble",
                `library-chat-bubble--${msg.role}`,
              ].join(" ")}
            >
              {msg.role === "user" ? (
                /* User messages: plain text, preserve whitespace */
                <div className="library-chat-bubble-text library-chat-bubble-text--user">
                  {msg.text}
                </div>
              ) : msg.streaming ? (
                /* Streaming: plain pre-wrapped to avoid re-parse on every chunk */
                <div className="library-chat-bubble-text library-chat-bubble-text--streaming">
                  {msg.text || <Spinner />}
                </div>
              ) : msg.error ? (
                /* Error state */
                <div className="library-chat-bubble-error">
                  <Icon name="ph:warning-circle" width={14} className="library-chat-error-icon" />
                  <span>{msg.error}</span>
                </div>
              ) : (
                /* Finalized: rendered markdown */
                <RenderedBubble text={msg.text} html={msg.html} />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      {/* Input row */}
      <div className="library-chat-input-row">
        <textarea
          ref={textareaRef}
          className="library-chat-textarea"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this document…"
          disabled={streaming}
          rows={1}
          aria-label="Message input"
          aria-multiline="true"
        />
        <button
          type="button"
          className={[
            "library-chat-send-btn",
            streaming ? "library-chat-send-btn--streaming" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => void sendMessage()}
          disabled={streaming || !inputValue.trim()}
          title={streaming ? "Streaming…" : "Send (Enter)"}
          aria-label={streaming ? "Streaming response" : "Send message"}
        >
          {streaming ? (
            <Spinner />
          ) : (
            <Icon name="ph:arrow-right-bold" width={14} />
          )}
        </button>
      </div>
    </div>
  );
}
