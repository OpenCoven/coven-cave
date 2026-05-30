"use client";

import { useEffect, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { needsResponse, stripAnsi } from "@/lib/ansi";

const POLL_MS = 250;
const PROJECT_ROOT =
  process.env.NEXT_PUBLIC_COVEN_PROJECT_ROOT ??
  "/Users/buns/Documents/GitHub/OpenCoven/coven-cave";

type CovenEvent = {
  seq: number;
  kind: string;
  payload_json: string;
};

type Props = {
  familiar: Familiar | null;
  /** When set, attach to this existing session (replay + tail). */
  attachSessionId?: string | null;
  onBack?: () => void;
  onResponseNeededChange?: (familiarId: string, needed: boolean) => void;
};

export function TerminalPane({
  familiar,
  attachSessionId,
  onBack,
  onResponseNeededChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const lastSeqRef = useRef<number>(0);
  const sessionRef = useRef<string | null>(null);
  const strippedTailRef = useRef<string>("");
  const familiarIdRef = useRef<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(attachSessionId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReply, setNeedsReply] = useState<boolean>(false);

  // Mount xterm once
  useEffect(() => {
    let disposed = false;
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        lineHeight: 1.25,
        convertEol: true,
        allowProposedApi: true,
        theme: {
          background: "#09090b",
          foreground: "#e4e4e7",
          cursor: "#a78bfa",
          selectionBackground: "#3f3f46",
          black: "#18181b",
          brightBlack: "#52525b",
          red: "#f87171",
          brightRed: "#fca5a5",
          green: "#34d399",
          brightGreen: "#6ee7b7",
          yellow: "#fbbf24",
          brightYellow: "#fcd34d",
          blue: "#60a5fa",
          brightBlue: "#93c5fd",
          magenta: "#c084fc",
          brightMagenta: "#d8b4fe",
          cyan: "#22d3ee",
          brightCyan: "#67e8f9",
          white: "#d4d4d8",
          brightWhite: "#fafafa",
        },
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(hostRef.current);
      fit.fit();

      term.onData((data) => {
        const sid = sessionRef.current;
        if (!sid) return;
        void fetch(`/api/sessions/${sid}/input`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: data }),
        });
        if (familiarIdRef.current) {
          setNeedsReply(false);
          onResponseNeededChange?.(familiarIdRef.current, false);
        }
      });

      termRef.current = term;
      fitRef.current = fit;

      resizeObs = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* element not visible yet */
        }
      });
      resizeObs.observe(hostRef.current);
    })();

    return () => {
      disposed = true;
      resizeObs?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [onResponseNeededChange]);

  // Whenever the familiar OR the attached session changes, reset terminal state
  useEffect(() => {
    sessionRef.current = attachSessionId ?? null;
    familiarIdRef.current = familiar?.id ?? null;
    setSessionId(attachSessionId ?? null);
    setError(null);
    setNeedsReply(false);
    lastSeqRef.current = 0;
    strippedTailRef.current = "";
    const term = termRef.current;
    if (!term) return;
    term.clear();
    term.reset();
    if (attachSessionId) {
      term.writeln(
        `\x1b[2m… attaching to session ${attachSessionId.slice(0, 8)}\x1b[0m`,
      );
    } else if (familiar) {
      term.writeln(
        `\x1b[38;5;141m✨\x1b[0m New chat with \x1b[1m${familiar.display_name}\x1b[0m (\x1b[2m${familiar.harness ?? "codex"} · ${familiar.model ?? "?"}\x1b[0m) — press Enter or start typing.`,
      );
    } else {
      term.writeln(
        "\x1b[38;5;141m✨\x1b[0m Pick a familiar from the rail to start a chat.",
      );
    }
  }, [familiar?.id, familiar, attachSessionId]);

  // Bootstrap a fresh session on first keystroke when no session is attached
  useEffect(() => {
    const term = termRef.current;
    if (!term || !familiar || attachSessionId) return;

    const disp = term.onData(async (data) => {
      if (sessionRef.current || busy) return;
      const prompt = data === "\r" || data === "\n" ? `hi ${familiar.display_name}` : data;
      await startSession(prompt);
    });
    return () => disp.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiar, busy, attachSessionId]);

  const startSession = async (prompt: string) => {
    if (sessionRef.current || busy || !familiar) return;
    setBusy(true);
    setError(null);
    try {
      const term = termRef.current;
      const cols = term?.cols ?? 120;
      const rows = term?.rows ?? 32;
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectRoot: PROJECT_ROOT,
          harness: familiar.harness ?? "codex",
          familiarId: familiar.id,
          prompt,
          cols,
          rows,
        }),
      });
      const json = (await res.json()) as { ok: boolean; session?: { id: string }; error?: string };
      if (!json.ok || !json.session) {
        setError(json.error ?? "session create failed");
        return;
      }
      sessionRef.current = json.session.id;
      setSessionId(json.session.id);
    } finally {
      setBusy(false);
    }
  };

  // Poll events for the live session and write raw PTY bytes to xterm
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/sessions/${sessionId}/events?afterSeq=${lastSeqRef.current}&limit=500`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok: boolean; events?: CovenEvent[] };
        if (!json.ok || cancelled) return;
        const events = json.events ?? [];
        if (!events.length) return;

        const term = termRef.current;
        let chunk = "";
        for (const ev of events) {
          if (ev.seq > lastSeqRef.current) lastSeqRef.current = ev.seq;
          if (ev.kind !== "output") continue;
          try {
            const payload = JSON.parse(ev.payload_json) as { data?: string };
            if (payload.data) chunk += payload.data;
          } catch {
            /* skip */
          }
        }
        if (chunk && term) term.write(chunk);
        if (chunk) {
          const tail = (strippedTailRef.current + stripAnsi(chunk)).slice(-1000);
          strippedTailRef.current = tail;
          const fid = familiarIdRef.current;
          const next = needsResponse(tail);
          setNeedsReply(next);
          if (fid) onResponseNeededChange?.(fid, next);
        }
      } catch {
        /* transient */
      }
    };

    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [sessionId, onResponseNeededChange]);

  return (
    <section className="flex h-full flex-col bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <button
              onClick={onBack}
              className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800"
              title="Back to chats"
            >
              ← chats
            </button>
          ) : null}
          {familiar ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-lg">{familiar.emoji}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{familiar.display_name}</div>
                <div className="truncate text-[11px] text-zinc-500">
                  {familiar.harness ?? "?"} ·{" "}
                  <span className="font-mono">{familiar.model ?? "?"}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No familiar selected</div>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {needsReply ? (
            <span className="font-mono text-amber-400" title="Waiting for your response">
              ● needs reply
            </span>
          ) : sessionId ? (
            <span className="font-mono text-emerald-400/80">● live</span>
          ) : busy ? (
            <span className="font-mono text-amber-400/80">starting…</span>
          ) : (
            <span className="font-mono">idle</span>
          )}
        </div>
      </header>

      <div ref={hostRef} className="flex-1 min-h-0 overflow-hidden bg-zinc-950 p-2" />

      {error ? (
        <div className="border-t border-amber-700/40 bg-amber-900/20 px-4 py-1.5 text-xs text-amber-200">
          {error}
        </div>
      ) : null}
    </section>
  );
}
