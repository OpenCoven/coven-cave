"use client";

/**
 * FamiliarIdentitySection — the Identity tab of the chat surface's Familiar
 * view (skills-page design handoff, cave-moig).
 *
 * Layout: a 1.2fr/1fr card grid (About on the left; Runtime + Voice stacked on
 * the right) over two full-width cards (Roles, Identity contract). Every fact
 * shown is a real field from the section model — the design mock's "Summoned"
 * and lifetime session-count facts have no backing field on the Familiar
 * record, so they are deliberately omitted rather than fabricated.
 *
 * The Identity contract card is honest about scanning: it fetches the real
 * adherence report (GET /api/familiars/{id}/contract — SOUL.md / IDENTITY.md /
 * ward.toml / MEMORY.md presence plus the v0.1.0 five-property check) and only
 * renders per-file rows once that response lands. No file is ever shown as if
 * scanned when it wasn't.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/lib/icon";
import type { FamiliarSectionData } from "@/lib/familiar-tab-section-model";
import type { ContractReport } from "@/lib/familiar-contract";
import type { RoleEntry } from "@/app/api/roles/route";
import { relativeTime } from "@/lib/relative-time";
import { getVoiceProvider } from "@/lib/voice/registry";
import { openFamiliarStudioSettingsTab } from "@/lib/familiar-studio-context";
import { navigateFamiliarSurface } from "@/lib/familiar-surface-navigation";
import "@/styles/familiar-tab-identity.css";

// ── Identity contract fetch ──────────────────────────────────────────────────

type ContractFileKey = "soul" | "identity" | "ward" | "memory";

/** Shape of GET /api/familiars/{id}/contract (route.ts). */
type ContractPayload = {
  ok: boolean;
  present?: Record<ContractFileKey, boolean>;
  report?: ContractReport;
};

type ContractState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; present: Record<ContractFileKey, boolean>; report: ContractReport };

/** The four identity files the contract checker actually reads (the design
 *  mock's `memory/` row is really MEMORY.md in the v0.1.0 convention). */
const CONTRACT_FILES: Array<{ key: ContractFileKey; name: string; blurb: string }> = [
  { key: "soul", name: "SOUL.md", blurb: "Voice, temperament, and reasoning style" },
  { key: "identity", name: "IDENTITY.md", blurb: "Name, pronouns, avatar, and the public bio" },
  { key: "ward", name: "ward.toml", blurb: "Guardrails: what may be touched and what may not" },
  { key: "memory", name: "MEMORY.md", blurb: "Long-term memory; browse it in the Memory tab" },
];

function useFamiliarContract(familiarId: string): ContractState {
  const [state, setState] = useState<ContractState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    void fetch(`/api/familiars/${encodeURIComponent(familiarId)}/contract`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.statusText);
        return (await res.json()) as ContractPayload;
      })
      .then((json) => {
        if (!alive) return;
        if (json.ok && json.present && json.report) {
          setState({ status: "ready", present: json.present, report: json.report });
        } else {
          setState({ status: "error" });
        }
      })
      .catch(() => {
        if (alive) setState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [familiarId]);

  return state;
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function CardTitle({ children }: { children: ReactNode }) {
  return <span className="familiar-tab__card-title">{children}</span>;
}

function Fact({ label, value, mono, title }: { label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <li>
      <span className="familiar-tab__fact-label">{label}</span>
      <span
        className={mono ? "truncate font-mono text-[length:var(--text-sm)] text-[var(--text-secondary)]" : "min-w-0"}
        title={title}
      >
        {value}
      </span>
    </li>
  );
}

function QuietCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="familiar-identity__cta focus-ring" onClick={onClick}>
      {label}
    </button>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────────

function AboutCard({ data }: { data: FamiliarSectionData }) {
  const { familiar } = data;
  const lastSeen = familiar.last_seen ? relativeTime(familiar.last_seen) : "";
  return (
    <section className="familiar-tab__card familiar-identity__about" aria-label="About">
      <div className="familiar-tab__card-head">
        <CardTitle>About</CardTitle>
      </div>
      {familiar.description ? (
        <p className="familiar-identity__desc">{familiar.description}</p>
      ) : (
        <div className="familiar-identity__desc familiar-identity__desc--empty">
          <p>No description yet.</p>
          <QuietCta
            label="Edit in Studio →"
            onClick={() => openFamiliarStudioSettingsTab("identity", familiar.id)}
          />
        </div>
      )}
      <ul className="familiar-tab__facts familiar-identity__facts">
        <Fact label="Kind" value={familiar.role} />
        {familiar.pronouns ? <Fact label="Pronouns" value={familiar.pronouns} /> : null}
        {lastSeen ? <Fact label="Last seen" value={lastSeen} /> : null}
        {typeof familiar.active_sessions === "number" && familiar.active_sessions > 0 ? (
          <Fact label="Active" value={`${familiar.active_sessions} session${familiar.active_sessions === 1 ? "" : "s"}`} />
        ) : null}
      </ul>
      <div className="familiar-identity__foot">
        <Link
          href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/profile`}
          aria-label={`Open profile for ${familiar.display_name}`}
          className="familiar-identity__cta focus-ring"
        >
          Profile →
        </Link>
      </div>
    </section>
  );
}

function RuntimeCard({ data }: { data: FamiliarSectionData }) {
  const { familiar, harnessReport, manifest } = data;
  const scanned = manifest?.scanned_at ? relativeTime(manifest.scanned_at) : "";
  const runtimeLabel = harnessReport
    ? `${harnessReport.label}${harnessReport.version ? ` ${harnessReport.version}` : ""}`
    : data.harnessId;
  return (
    <section className="familiar-tab__card" aria-label="Runtime">
      <div className="familiar-tab__card-head">
        <CardTitle>Runtime</CardTitle>
        {scanned ? <span className="familiar-tab__card-note font-mono">scanned {scanned}</span> : null}
      </div>
      <ul className="familiar-tab__facts">
        <Fact label="Runtime" value={runtimeLabel} mono />
        {familiar.model ? <Fact label="Model" value={familiar.model} mono /> : null}
        {harnessReport?.path ? (
          <Fact label="Binary" value={harnessReport.path} mono title={harnessReport.path} />
        ) : null}
      </ul>
    </section>
  );
}

function VoiceCard({ data }: { data: FamiliarSectionData }) {
  const { familiar } = data;
  if (!familiar.voiceProvider) {
    return (
      <section className="familiar-tab__card" aria-label="Voice">
        <div className="familiar-tab__card-head">
          <CardTitle>Voice</CardTitle>
        </div>
        <div className="familiar-tab__empty">
          <p>No voice bound yet.</p>
          <QuietCta
            label="Choose a voice"
            onClick={() => openFamiliarStudioSettingsTab("brain", familiar.id)}
          />
        </div>
      </section>
    );
  }
  const providerLabel = getVoiceProvider(familiar.voiceProvider)?.label ?? familiar.voiceProvider;
  return (
    <section className="familiar-tab__card" aria-label="Voice">
      <div className="familiar-tab__card-head">
        <CardTitle>Voice</CardTitle>
        {/* Neutral marker — a voice is bound; accent stays reserved for presence. */}
        <span className="familiar-tab__count familiar-identity__voice-pill font-mono">bound</span>
      </div>
      <ul className="familiar-tab__facts">
        <Fact label="Provider" value={providerLabel} />
        {familiar.voiceName ? <Fact label="Voice" value={familiar.voiceName} mono title={familiar.voiceName} /> : null}
        {familiar.voiceModel ? <Fact label="Model" value={familiar.voiceModel} mono title={familiar.voiceModel} /> : null}
      </ul>
    </section>
  );
}

function RoleRow({ role }: { role: RoleEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="familiar-identity__role">
      <button
        type="button"
        className="familiar-tab__row-toggle focus-ring"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="familiar-identity__caret" data-open={open} aria-hidden>
          <Icon name="ph:caret-right" width={12} />
        </span>
        <span className="familiar-tab__row-name">{role.name}</span>
        <span className="familiar-tab__row-meta font-mono">
          {role.skills.length} skill{role.skills.length === 1 ? "" : "s"}
        </span>
      </button>
      {open ? (
        <>
          {role.description ? <p className="familiar-tab__row-desc">{role.description}</p> : null}
          {role.skills.length > 0 ? (
            <ul className="familiar-identity__chips">
              {role.skills.map((sid) => (
                <li key={sid} className="familiar-identity__chip font-mono">
                  {sid}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RolesCard({ data }: { data: FamiliarSectionData }) {
  const roles = data.activeRoles;
  return (
    <section className="familiar-tab__card" aria-label="Roles">
      <div className="familiar-tab__card-head">
        <CardTitle>Roles</CardTitle>
        {roles.length > 0 ? (
          <span className="familiar-identity__pill--active font-mono">{roles.length} active</span>
        ) : null}
      </div>
      {roles.length === 0 ? (
        <div className="familiar-tab__empty">
          <p>No roles active for this familiar.</p>
          <QuietCta label="Open roles →" onClick={() => navigateFamiliarSurface("roles")} />
        </div>
      ) : (
        <div className="familiar-tab__rows">
          {roles.map((role) => (
            <RoleRow key={role.id} role={role} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContractCard({ data }: { data: FamiliarSectionData }) {
  const { familiar } = data;
  const contract = useFamiliarContract(familiar.id);
  return (
    <section className="familiar-tab__card" aria-label="Identity contract">
      <div className="familiar-tab__card-head">
        <CardTitle>Identity contract</CardTitle>
        {contract.status === "ready" ? (
          <span
            className={`familiar-identity__contract-pill font-mono${contract.report.pass ? "" : " familiar-identity__contract-pill--fail"}`}
          >
            {contract.report.pass
              ? "compliant"
              : `${contract.report.violations.length} violation${contract.report.violations.length === 1 ? "" : "s"}`}
          </span>
        ) : null}
        <span className="familiar-tab__card-note">
          <QuietCta
            label="Open contract →"
            onClick={() => openFamiliarStudioSettingsTab("contract", familiar.id)}
          />
        </span>
      </div>
      <p className="familiar-identity__desc">
        What makes {familiar.display_name} {familiar.display_name} — edit any of these in Studio.
      </p>
      {contract.status === "loading" ? (
        <div className="familiar-tab__empty">
          <p>Checking the contract…</p>
        </div>
      ) : contract.status === "error" ? (
        <div className="familiar-tab__empty">
          <p>Contract check unavailable.</p>
        </div>
      ) : (
        <ul className="familiar-identity__files">
          {CONTRACT_FILES.map(({ key, name, blurb }) => {
            const present = contract.present[key];
            const issues = contract.report.violations.filter((v) => v.file === name).length;
            return (
              <li key={key} className="familiar-identity__file">
                <span className="familiar-identity__file-name font-mono">
                  {name}
                  <span
                    className={`familiar-identity__file-tag${present ? "" : " familiar-identity__file-tag--missing"}`}
                  >
                    {present ? "found" : "missing"}
                  </span>
                  {issues > 0 ? (
                    <span className="familiar-identity__file-tag familiar-identity__file-tag--missing">
                      {issues} issue{issues === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </span>
                <span className="familiar-identity__file-blurb">{blurb}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function FamiliarIdentitySection({ data }: { data: FamiliarSectionData }) {
  return (
    <div className="familiar-identity__stack">
      <div className="familiar-identity__grid">
        <AboutCard data={data} />
        <div className="familiar-identity__col">
          <RuntimeCard data={data} />
          <VoiceCard data={data} />
        </div>
      </div>
      <RolesCard data={data} />
      <ContractCard data={data} />
    </div>
  );
}
