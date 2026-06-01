"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxItem } from "@/lib/cave-inbox";
import type { Familiar } from "@/lib/types";
import type { InboxPrefs, SoundMode } from "@/lib/cave-inbox-prefs";
import { Icon } from "@/lib/icon";

type Props = {
  items: InboxItem[];
  familiars: Familiar[];
  prefs: InboxPrefs;
  onOpenInbox: () => void;
  onOpenItem?: (item: InboxItem) => void;
  onPrefsChanged: () => void;
};

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(Math.abs(diff) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NotificationBell({
  items,
  familiars,
  prefs,
  onOpenInbox,
  onOpenItem,
  onPrefsChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const familiarName = useCallback(
    (id: string | null | undefined) =>
      id ? familiars.find((f) => f.id === id)?.display_name ?? id : null,
    [familiars],
  );

  const toggleMute = useCallback(
    async (familiarId: string) => {
      await fetch("/api/inbox/prefs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toggleMuteFor: familiarId }),
      });
      onPrefsChanged();
    },
    [onPrefsChanged],
  );

  const setSound = useCallback(
    async (mode: SoundMode, name?: string) => {
      await fetch("/api/inbox/prefs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sound: { mode, name } }),
      });
      onPrefsChanged();
    },
    [onPrefsChanged],
  );

  // Items shown in the dropdown: most-recent fired + the loudest pending alerts
  // (response-needed bridge first). Cap to 10.
  const recent = useMemo(() => {
    const firedSorted = items
      .filter((i) => i.status === "fired")
      .sort((a, b) =>
        (b.firedAt ?? b.updatedAt).localeCompare(a.firedAt ?? a.updatedAt),
      );
    const ephemeral = items.filter(
      (i) => i.status === "pending" && i.kind === "response-needed",
    );
    return [...ephemeral, ...firedSorted].slice(0, 10);
  }, [items]);

  const badgeCount = useMemo(() => {
    return items.filter(
      (i) =>
        i.status === "fired" ||
        (i.status === "pending" && i.kind === "response-needed"),
    ).length;
  }, [items]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const dismiss = useCallback(async (id: string) => {
    await fetch(`/api/inbox/${id}/dismiss`, { method: "POST" });
  }, []);

  const snooze = useCallback(async (id: string) => {
    await fetch(`/api/inbox/${id}/snooze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes: 10 }),
    });
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative grid h-7 w-7 place-items-center rounded-md border transition-colors ${
          badgeCount > 0
            ? "border-amber-500/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
            : "border-[--border-hairline] text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary]"
        }`}
        title={`${badgeCount} unread`}
      >
        <Icon name="ph:bell-fill" aria-label="Notifications" />

        {badgeCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-none text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-[360px] rounded-xl border border-[--border-hairline] bg-[--bg-base] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[--border-hairline] px-3 py-2">
            <span className="text-[10px] uppercase tracking-widest text-[--text-muted]">
              Notifications
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="grid h-5 w-5 place-items-center text-[--text-secondary] hover:text-[--text-primary]"
                title="Notification settings"
                aria-label="Notification settings"
              >
                <Icon name="ph:gear-six-bold" />
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onOpenInbox();
                }}
                className="text-[10px] text-purple-300 hover:text-purple-200"
              >
                open inbox →
              </button>
            </div>
          </div>

          {settingsOpen ? (
            <div className="border-b border-[--border-hairline] bg-[--bg-raised]/40 p-3 text-[11px]">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-[--text-muted]">
                Sound
              </div>
              <div className="mb-3 flex flex-wrap gap-1">
                {(
                  [
                    { mode: "default" as SoundMode, label: "Default" },
                    { mode: "silent" as SoundMode, label: "Silent" },
                    { mode: "named" as SoundMode, label: "Glass", name: "Glass" },
                    { mode: "named" as SoundMode, label: "Pop", name: "Pop" },
                    { mode: "named" as SoundMode, label: "Funk", name: "Funk" },
                  ] as const
                ).map((opt) => {
                  const active =
                    prefs.sound.mode === opt.mode &&
                    (opt.mode !== "named" ||
                      prefs.sound.name === ("name" in opt ? opt.name : undefined));
                  return (
                    <button
                      key={opt.label}
                      onClick={() =>
                        setSound(opt.mode, "name" in opt ? opt.name : undefined)
                      }
                      className={`rounded border px-2 py-0.5 text-[10px] ${
                        active
                          ? "border-purple-500 bg-purple-500/20 text-purple-100"
                          : "border-[--border-strong] text-[--text-secondary] hover:bg-[--bg-raised]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="mb-1.5 text-[10px] uppercase tracking-widest text-[--text-muted]">
                Muted familiars
              </div>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                {familiars.length === 0 ? (
                  <li className="text-[10px] text-[--text-muted]">No familiars yet.</li>
                ) : null}
                {familiars.map((f) => {
                  const muted = prefs.mutedFamiliars.includes(f.id);
                  return (
                    <li key={f.id} className="flex items-center justify-between">
                      <span className="truncate text-[--text-secondary]">{f.display_name}</span>
                      <button
                        onClick={() => toggleMute(f.id)}
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${
                          muted
                            ? "border-amber-600 bg-amber-500/15 text-amber-200"
                            : "border-[--border-strong] text-[--text-secondary] hover:bg-[--bg-raised]"
                        }`}
                      >
                        {muted ? "muted" : "mute"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <ul className="max-h-[420px] overflow-y-auto p-2 text-xs">
            {recent.length === 0 ? (
              <li className="px-2 py-6 text-center text-[11px] text-[--text-muted]">
                No notifications.
              </li>
            ) : null}
            {recent.map((it) => (
              <li
                key={it.id}
                className="mb-1 rounded-md border border-[--border-hairline] bg-[--bg-raised]/40 p-2"
              >
                <div className="flex items-start gap-2">
                  <Icon
                    name={
                      it.kind === "response-needed"
                        ? "ph:chat-circle-dots-fill"
                        : it.kind === "agent"
                        ? "ph:magic-wand-fill"
                        : "ph:alarm-fill"
                    }
                    className="mt-0.5 shrink-0 text-[--text-secondary]"
                    width="0.95rem"
                    height="0.95rem"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[--text-primary]">{it.title}</div>
                    {it.body ? (
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-[--text-muted]">
                        {it.body}
                      </div>
                    ) : null}
                    <div className="mt-0.5 text-[9px] text-[--text-muted]">
                      {it.status === "fired"
                        ? `fired ${relTime(it.firedAt)}`
                        : it.kind === "response-needed"
                        ? "waiting on you"
                        : relTime(it.updatedAt)}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {onOpenItem ? (
                    <BellBtn
                      onClick={() => {
                        setOpen(false);
                        onOpenItem(it);
                      }}
                    >
                      Open
                    </BellBtn>
                  ) : null}
                  {it.kind !== "response-needed" ? (
                    <>
                      <BellBtn onClick={() => void snooze(it.id)}>Snooze 10m</BellBtn>
                      <BellBtn onClick={() => void dismiss(it.id)}>Dismiss</BellBtn>
                    </>
                  ) : null}
                  {it.familiarId ? (
                    <BellBtn onClick={() => void toggleMute(it.familiarId!)}>
                      {prefs.mutedFamiliars.includes(it.familiarId)
                        ? `unmute ${familiarName(it.familiarId)}`
                        : `mute ${familiarName(it.familiarId)}`}
                    </BellBtn>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function BellBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-[--border-hairline] bg-[--bg-raised] px-1.5 py-0.5 text-[10px] text-[--text-secondary] hover:bg-[--bg-raised]"
    >
      {children}
    </button>
  );
}
