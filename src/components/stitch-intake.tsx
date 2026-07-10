"use client";

/**
 * Stitch intake — gather pins into a thread, then sew it into a vault entry.
 *
 * Pins are captured server-side (`POST /api/stitches/pins` — the client only
 * names a source); the thread persists under the vault so drafts survive
 * reloads. Three sew paths:
 *
 *   - **Sew** (agentic)  — `POST /api/stitches/sew`, codex exec distills.
 *   - **Sew in chat**    — `cave:agents-new-chat` with a pin digest prompt.
 *   - **Sew manually**   — `mode: "manual"`, pins concatenated for hand-editing.
 *
 * Also exports `StitchProvenance`, the pin strip a sewn entry shows above its
 * editor (chips link back to sources; keyboard-first, no hover-only reveals).
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon, type IconName } from "@/lib/icon";
import {
  PIN_KINDS,
  buildSewChatPrompt,
  pinKindLabel,
  type PinKind,
  type StitchPinRef,
  type StitchThread,
} from "@/lib/stitch";

const KIND_ICON: Record<PinKind, IconName> = {
  url: "ph:globe",
  paste: "ph:clipboard-text",
  file: "ph:file-text",
  chat: "ph:chat-circle-dots",
  github: "ph:github-logo",
  memory: "ph:brain",
};

const KIND_PLACEHOLDER: Record<PinKind, string> = {
  url: "https://… page to fetch",
  paste: "",
  file: "/path/to/notes.md (allow-listed roots)",
  chat: "",
  github: "https://github.com/owner/repo, an issue, PR, or file",
  memory: "/path/to/memory.md#optional-heading",
};

type SessionOption = { id: string; title: string };

export function StitchIntake({ onSewn }: { onSewn: (entryId: string) => void }) {
  const { announce } = useAnnouncer();
  const [thread, setThread] = useState<StitchThread | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<PinKind>("url");
  const [ref, setRef] = useState("");
  const [paste, setPaste] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<SessionOption[] | null>(null);
  const [pinning, setPinning] = useState(false);
  const [sewing, setSewing] = useState<"agentic" | "manual" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-pin two-step removal: first tap arms ("Remove?"), auto-disarms (cave-exbq).
  const [armedPinId, setArmedPinId] = useState<string | null>(null);
  useEffect(() => {
    if (armedPinId === null) return;
    const t = window.setTimeout(() => setArmedPinId(null), 4000);
    return () => window.clearTimeout(t);
  }, [armedPinId]);

  // Chat pins pick from real sessions — loaded on first need. A FAILED load
  // must not settle as [] (that rendered an empty picker indistinguishable
  // from having no chats, and the sessions!==null guard never retried;
  // cave-exbq): failures leave sessions null with an error, and the retry
  // nonce lets the user re-run the fetch.
  const [sessionsError, setSessionsError] = useState(false);
  const [sessionsRetryNonce, setSessionsRetryNonce] = useState(0);
  useEffect(() => {
    if (kind !== "chat" || sessions !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sessions/list", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok || !Array.isArray(json.sessions)) throw new Error("sessions load failed");
        setSessionsError(false);
        setSessions(
          json.sessions
            .slice(0, 100)
            .map((row: { id?: string; title?: string }) => ({
              id: String(row.id ?? ""),
              title: String(row.title ?? row.id ?? ""),
            }))
            .filter((row: SessionOption) => row.id),
        );
      } catch {
        if (!cancelled) setSessionsError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, sessions, sessionsRetryNonce]);

  async function ensureThread(): Promise<StitchThread | null> {
    if (thread) return thread;
    try {
      const res = await fetch("/api/stitches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "thread failed");
      setThread(json.thread as StitchThread);
      return json.thread as StitchThread;
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not start a thread");
      return null;
    }
  }

  async function addPin() {
    setError(null);
    const sourceRef = kind === "chat" ? sessionId : kind === "paste" ? "paste" : ref.trim();
    if (kind !== "paste" && !sourceRef) {
      setError(kind === "chat" ? "Pick a chat session to pin." : "Enter a source to pin.");
      return;
    }
    if (kind === "paste" && !paste.trim()) {
      setError("Paste some text to pin.");
      return;
    }
    setPinning(true);
    try {
      const active = await ensureThread();
      if (!active) return;
      const res = await fetch("/api/stitches/pins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: active.id,
          kind,
          ref: sourceRef,
          ...(kind === "paste" ? { content: paste } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(typeof json.error === "string" ? json.error : "pin failed");
        return;
      }
      setThread(json.thread as StitchThread);
      setRef("");
      setPaste("");
      announce(`Pinned ${pinKindLabel(kind)}.`);
    } catch {
      setError("pin failed");
    } finally {
      setPinning(false);
    }
  }

  async function removePin(pinId: string, pinTitle: string) {
    if (!thread) return;
    try {
      const res = await fetch(
        `/api/stitches/pins?threadId=${encodeURIComponent(thread.id)}&pinId=${encodeURIComponent(pinId)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (res.ok && json.ok) {
        setThread(json.thread as StitchThread);
        announce(`Removed pin ${pinTitle}.`);
      } else {
        // A silent no-op read as a dead button (cave-exbq). The pin stays.
        setError(typeof json.error === "string" ? json.error : `Couldn't remove pin ${pinTitle}.`);
        announce(`Couldn't remove pin ${pinTitle}.`, "assertive");
      }
    } catch {
      setError(`Couldn't remove pin ${pinTitle} — check your connection.`);
      announce(`Couldn't remove pin ${pinTitle}.`, "assertive");
    }
  }

  async function sew(mode: "agentic" | "manual") {
    if (!thread || thread.pins.length === 0) return;
    setError(null);
    setSewing(mode);
    try {
      const res = await fetch("/api/stitches/sew", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, mode, title }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(typeof json.error === "string" ? json.error : "sew failed");
        return;
      }
      announce(`Stitch sewn: ${json.entry.title}`);
      onSewn(json.entry.id as string);
    } catch {
      setError("sew failed");
    } finally {
      setSewing(null);
    }
  }

  function sewInChat() {
    if (!thread || thread.pins.length === 0) return;
    window.dispatchEvent(
      new CustomEvent("cave:agents-new-chat", {
        detail: {
          initialPrompt: buildSewChatPrompt({ title, pins: thread.pins }),
          origin: "chat" as const,
        },
      }),
    );
    announce("Opened a chat to sew this thread.");
  }

  const pins = thread?.pins ?? [];
  const busy = pinning || sewing !== null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4" data-testid="stitch-intake">
      <div>
        <h2 className="text-[13px] font-medium text-[var(--text-primary)]">New stitch</h2>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
          Pin sources onto a thread, then sew them into one durable entry.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">Working title / intent</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What should this stitch capture?"
          className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </label>

      <div role="group" aria-label="Pin source" className="flex flex-wrap gap-1">
        {PIN_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setError(null);
            }}
            className={`focus-ring inline-flex h-[26px] items-center gap-1 rounded-md border px-2 text-[11px] transition-colors ${
              kind === k
                ? "border-[var(--accent-presence)]/40 bg-[var(--accent-presence)]/12 text-[var(--text-primary)]"
                : "border-[var(--border-hairline)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Icon name={KIND_ICON[k]} width={11} aria-hidden />
            {pinKindLabel(k)}
          </button>
        ))}
      </div>

      {kind === "paste" ? (
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          placeholder="Paste the text to pin…"
          aria-label="Text to pin"
          className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      ) : kind === "chat" ? (
        sessionsError ? (
          // A failed load is not "no chats" (cave-exbq) — say so and retry.
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-warning)]">
            <span>Couldn&apos;t load your chats.</span>
            <button
              type="button"
              onClick={() => {
                setSessionsError(false);
                setSessionsRetryNonce((n) => n + 1);
              }}
              className="focus-ring rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-primary)]"
            >
              Retry
            </button>
          </div>
        ) : (
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            aria-label="Chat session to pin"
            className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--text-primary)]"
          >
            <option value="">
              {sessions === null
                ? "Loading sessions…"
                : sessions.length === 0
                  ? "No chats yet — start one first"
                  : "Pick a chat session…"}
            </option>
            {(sessions ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        )
      ) : (
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void addPin();
          }}
          placeholder={KIND_PLACEHOLDER[kind]}
          aria-label={`${pinKindLabel(kind)} source`}
          className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      )}

      <div>
        <Button variant="secondary" size="sm" leadingIcon="ph:push-pin" loading={pinning} onClick={() => void addPin()}>
          Add pin
        </Button>
      </div>

      <div aria-live="off">
        <h3 className="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">
          Thread — {pins.length} {pins.length === 1 ? "pin" : "pins"}
        </h3>
        {pins.length === 0 ? (
          <p className="text-[11px] text-[var(--text-muted)]">No pins yet. A stitch needs at least one.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {pins.map((pin) => (
              <li
                key={pin.id}
                className="flex items-start gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1.5"
              >
                <Icon name={KIND_ICON[pin.kind]} width={12} aria-hidden className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-[var(--text-primary)]" title={pin.title}>
                    {pin.title}
                  </span>
                  {pin.excerpt ? (
                    <span className="block truncate text-[11px] text-[var(--text-muted)]">{pin.excerpt}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label={
                    armedPinId === pin.id
                      ? `Really remove pin ${pin.title}? Click again to confirm`
                      : `Remove pin ${pin.title}`
                  }
                  onClick={() => {
                    // A gathered source has no undo — two-step (cave-exbq).
                    if (armedPinId === pin.id) {
                      setArmedPinId(null);
                      void removePin(pin.id, pin.title);
                    } else {
                      setArmedPinId(pin.id);
                    }
                  }}
                  className={`focus-ring shrink-0 rounded p-1 ${
                    armedPinId === pin.id
                      ? "px-1.5 text-[10px] font-semibold text-[var(--color-danger)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {armedPinId === pin.id ? "Remove?" : <Icon name="ph:x" width={10} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--border-hairline)] pt-3">
        <Button
          variant="primary"
          size="sm"
          leadingIcon="ph:sparkle"
          loading={sewing === "agentic"}
          disabled={pins.length === 0 || busy}
          onClick={() => void sew("agentic")}
          title="Distill the pins into one entry with an agent"
        >
          Sew stitch
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon="ph:chat-circle-dots"
          disabled={pins.length === 0 || busy}
          onClick={sewInChat}
          title="Open a chat primed with the pins to draft the entry together"
        >
          Sew in chat
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon="ph:pencil-simple"
          loading={sewing === "manual"}
          disabled={pins.length === 0 || busy}
          onClick={() => void sew("manual")}
          title="Create the entry from the raw pins and edit it yourself"
        >
          Sew manually
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The provenance strip a sewn entry renders above its editor. */
export function StitchProvenance({
  pins,
  onOpenMemory,
}: {
  pins: StitchPinRef[];
  onOpenMemory: (path: string) => void;
}) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border-hairline)] px-3 py-2"
      aria-label="Sewn from pins"
    >
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Sewn from</span>
      {pins.map((pin, index) => {
        const chipClass =
          "focus-ring inline-flex max-w-64 items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]";
        if (pin.kind === "url" || pin.kind === "github") {
          return (
            <a key={index} href={pin.ref} target="_blank" rel="noreferrer noopener" className={chipClass} title={pin.ref}>
              <Icon name={KIND_ICON[pin.kind]} width={10} aria-hidden />
              <span className="truncate">{pin.title}</span>
            </a>
          );
        }
        if (pin.kind === "memory" || pin.kind === "file") {
          const path = pin.ref.split("#", 1)[0];
          return (
            <button
              key={index}
              type="button"
              onClick={() => onOpenMemory(path)}
              className={chipClass}
              title={pin.ref}
            >
              <Icon name={KIND_ICON[pin.kind]} width={10} aria-hidden />
              <span className="truncate">{pin.title}</span>
            </button>
          );
        }
        // chat + paste: identifying chip only (the source isn't a document).
        return (
          <span
            key={index}
            className="inline-flex max-w-64 items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
            title={pin.ref}
          >
            <Icon name={KIND_ICON[pin.kind]} width={10} aria-hidden />
            <span className="truncate">{pin.title}</span>
          </span>
        );
      })}
    </div>
  );
}
