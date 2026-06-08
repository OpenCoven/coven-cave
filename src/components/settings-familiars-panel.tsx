"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type HarnessReport = {
  id: string;
  label: string;
  installed: boolean;
  chatSupported: boolean;
  version: string | null;
};

type Props = {
  familiars: ResolvedFamiliar[];
  sessions: SessionRow[];
  responseNeeded: Set<string>;
};

export function SettingsFamiliarsPanel({ familiars, sessions, responseNeeded }: Props) {
  const { openFamiliarStudio } = useFamiliarStudio();
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/harnesses", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json.ok) setHarnesses(json.harnesses ?? []);
      } catch {
        /* keep empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const liveCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      if (!s.familiarId || s.status !== "running") continue;
      m.set(s.familiarId, (m.get(s.familiarId) ?? 0) + 1);
    }
    return m;
  }, [sessions]);

  if (familiars.length === 0) {
    return (
      <div className="settings-familiars-panel">
        <p className="settings-familiars-panel__empty">
          No familiars configured. Open onboarding to scaffold one.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-familiars-panel">
      {familiars.map((f) => {
        const harnessReport = f.harness
          ? harnesses.find((h) => h.id === f.harness) ?? null
          : null;
        const presence = computePresence({
          familiar: f,
          sessions,
          needsReply: responseNeeded.has(f.id),
          harnessInstalled: f.harness ? harnesses.find((h) => h.id === f.harness)?.installed : undefined,
          isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
        });
        return (
          <section key={f.id} className="settings-familiars-panel__card">
            <header className="settings-familiars-panel__card-head">
              <span className="settings-familiars-panel__glyph">
                <FamiliarAvatar familiar={f} size="sm" />
              </span>
              <span className="settings-familiars-panel__name">{f.display_name}</span>
              {harnessReport ? (
                <span
                  title={
                    !harnessReport.installed
                      ? `${harnessReport.label} not installed on this machine`
                      : harnessReport.chatSupported
                        ? "Native chat is wired for this harness"
                        : `${harnessReport.label} is installed but chat isn't wired yet — open in TUI`
                  }
                  className="settings-familiars-panel__harness-pill"
                >
                  {!harnessReport.installed
                    ? "missing"
                    : harnessReport.chatSupported
                      ? "chat ready"
                      : "tui only"}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => openFamiliarStudio(f.id, "identity")}
                className="settings-familiars-panel__edit"
                aria-label={`Edit ${f.display_name}`}
              >
                <Icon name="ph:pencil-simple" width={12} />
                Edit
              </button>
            </header>
            <dl className="settings-familiars-panel__dl">
              <dt>Harness</dt>
              <dd title={harnessReport?.version ?? undefined}>
                {f.harness ?? "—"}
                {harnessReport?.version ? (
                  <span className="settings-familiars-panel__version">
                    {harnessReport.version.split(/\s/).pop()}
                  </span>
                ) : null}
              </dd>
              <dt>Model</dt>
              <dd title={f.model ?? undefined}>{f.model ?? "—"}</dd>
              <dt>Presence</dt>
              <dd>
                <span className={`settings-familiars-panel__presence ${presence.pill}`}>
                  {presence.label}
                </span>
              </dd>
              <dt>Sessions</dt>
              <dd>{liveCounts.get(f.id) ?? 0} live</dd>
              <dt>Memory</dt>
              <dd>{f.memory_freshness ?? "—"}</dd>
            </dl>
          </section>
        );
      })}
    </div>
  );
}
