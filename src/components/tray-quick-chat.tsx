"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import { Icon } from "@/lib/icon";
import { resolveQuickChatTarget } from "@/lib/quick-chat";
import { streamFamiliarText } from "@/lib/familiar-stream";
import type { Familiar } from "@/lib/types";

const LAST_FAMILIAR_KEY = "cave.quick-chat.last-familiar";

type SendState = "idle" | "sending" | "done";

function initials(familiar: Familiar): string {
  return (familiar.display_name || familiar.id)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function TrayQuickChat() {
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [selectedFamiliarId, setSelectedFamiliarId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [loading, setLoading] = useState(true);
  const [thinkingEffort, setThinkingEffort] = useState<CommandThinkingEffort>(
    COMMAND_CONTROL_DEFAULTS.thinkingEffort,
  );
  const [responseSpeed, setResponseSpeed] = useState<CommandResponseSpeed>(
    COMMAND_CONTROL_DEFAULTS.responseSpeed,
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/familiars");
        const json = await res.json();
        if (!alive) return;
        const next = (json?.familiars ?? []) as Familiar[];
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(LAST_FAMILIAR_KEY)
            : null;
        setFamiliars(next);
        setSelectedFamiliarId(
          (stored && next.some((familiar) => familiar.id === stored) ? stored : null) ??
            next[0]?.id ??
            null,
        );
      } catch (err) {
        if (alive) setError((err as Error)?.message ?? "Failed to load familiars.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selectedFamiliar = useMemo(
    () => familiars.find((familiar) => familiar.id === selectedFamiliarId) ?? familiars[0] ?? null,
    [familiars, selectedFamiliarId],
  );

  const send = useCallback(async () => {
    const target = resolveQuickChatTarget(draft, familiars, selectedFamiliarId);
    setError(target.error);
    setAnswer("");
    setSessionId(null);
    if (target.error || !target.familiarId) return;

    setSendState("sending");
    setSelectedFamiliarId(target.familiarId);
    window.localStorage.setItem(LAST_FAMILIAR_KEY, target.familiarId);
    const result = await streamFamiliarText({
      familiarId: target.familiarId,
      prompt: target.prompt,
      reasoningEffort: thinkingEffort,
      responseSpeed,
    });
    setAnswer(result.text);
    setError(result.error);
    setSessionId(result.sessionId ?? null);
    setSendState("done");
  }, [draft, familiars, responseSpeed, selectedFamiliarId, thinkingEffort]);

  const openFullSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("quick-chat:open-session", { sessionId, familiarId: selectedFamiliarId });
    } catch {
      window.location.href = `/#chat-${encodeURIComponent(sessionId)}`;
    }
  }, [selectedFamiliarId, sessionId]);

  return (
    <main className="min-h-screen bg-[var(--bg-base)] text-[var(--fg-primary)]">
      <section className="flex min-h-screen flex-col border border-[var(--border-hairline)] bg-[var(--bg-panel)]">
        <header className="flex items-center justify-between border-b border-[var(--border-hairline)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="ph:chat-circle-dots" width={18} aria-hidden />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Quick Chat</h1>
              <p className="truncate text-xs text-[var(--fg-muted)]">
                {selectedFamiliar ? `@${selectedFamiliar.id}` : "No familiar selected"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openFullSession}
            disabled={!sessionId}
            aria-label="Open in CovenCave"
            title="Open in CovenCave"
            className="ui-icon-btn ui-icon-btn--sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="ph:arrow-square-out" width={12} aria-hidden />
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
          <Icon name="ph:at" width={14} aria-hidden />
          <select
            value={selectedFamiliarId ?? ""}
            onChange={(event) => setSelectedFamiliarId(event.target.value || null)}
            disabled={loading || familiars.length === 0}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            aria-label="Familiar"
          >
            {familiars.map((familiar) => (
              <option key={familiar.id} value={familiar.id}>
                {familiar.display_name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
          <select
            value={thinkingEffort}
            onChange={(event) => setThinkingEffort(event.target.value as CommandThinkingEffort)}
            disabled={sendState === "sending"}
            className="min-w-0 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-xs outline-none"
            aria-label="Choose thinking effort"
          >
            {COMMAND_THINKING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={responseSpeed}
            onChange={(event) => setResponseSpeed(event.target.value as CommandResponseSpeed)}
            disabled={sendState === "sending"}
            className="min-w-0 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5 text-xs outline-none"
            aria-label="Choose response speed"
          >
            {COMMAND_RESPONSE_SPEED_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          {selectedFamiliar ? (
            <div className="mb-3 flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              {selectedFamiliar.avatarUrl ? (
                <img
                  src={selectedFamiliar.avatarUrl}
                  alt=""
                  className="h-6 w-6 rounded-sm object-cover"
                />
              ) : (
                <span className="grid h-6 w-6 place-items-center rounded-sm bg-[var(--bg-elevated)] text-[10px] font-semibold text-[var(--fg-primary)]">
                  {initials(selectedFamiliar)}
                </span>
              )}
              <span className="min-w-0 truncate">{selectedFamiliar.role}</span>
            </div>
          ) : null}

          <label className="block text-xs font-medium text-[var(--fg-muted)]" htmlFor="quick-chat-draft">
            Message
          </label>
          <textarea
            id="quick-chat-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="@sage summarize what needs attention"
            className="mt-2 h-28 w-full resize-none rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-presence)]"
          />

          {error ? (
            <p className="mt-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--fg-primary)]">
              {error}
            </p>
          ) : null}

          <div className="mt-3 min-h-32 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] p-3 text-sm">
            {sendState === "sending" ? (
              <p className="text-[var(--fg-muted)]">Thinking...</p>
            ) : answer ? (
              <p className="whitespace-pre-wrap leading-6">{answer}</p>
            ) : (
              <p className="text-[var(--fg-muted)]">The reply will appear here.</p>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-hairline)] px-4 py-3">
          <p className="min-w-0 truncate text-xs text-[var(--fg-muted)]">
            Use @id to switch familiars.
          </p>
          <button
            type="button"
            onClick={send}
            disabled={sendState === "sending" || loading}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="ph:sparkle" width={14} aria-hidden />
            Send
          </button>
        </footer>
      </section>
    </main>
  );
}
