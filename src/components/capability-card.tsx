"use client";

import { Icon } from "@/lib/icon";

export type GlobalInstructions = {
  present: boolean;
  path?: string;
  byte_count?: number;
};

export type HarnessCapSkill = {
  id: string;
  name: string;
  source?: string;
  harness_id?: string;
  description?: string;
  version?: string;
  tags?: string[];
  path: string;
};

export type HarnessPlugin = {
  id: string;
  name: string;
  source?: string;
  harness_id?: string;
  kind: string;
  enabled: boolean;
  transport?: string;
  command?: string;
  args?: string[];
};

export type CapWarning = {
  kind: string;
  path: string;
  message: string;
};

export type HarnessCapabilityManifest = {
  harness_id: string;
  scanned_at: string;
  global_instructions: GlobalInstructions;
  skills: HarnessCapSkill[];
  plugins: HarnessPlugin[];
  warnings: CapWarning[];
};

export function CapabilitiesView({
  items,
  loaded,
  error,
  onRefresh,
}: {
  items: HarnessCapabilityManifest[];
  loaded: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (!loaded) return <GridSkeleton />;

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-6 sm:px-5">
        <p className="mb-3 text-[13px] text-muted-foreground">
          {error === "daemon offline"
            ? "Coven daemon is offline — harness capabilities require a running daemon."
            : `Could not load capabilities: ${error}`}
        </p>
        <button
          onClick={onRefresh}
          className="focus-ring rounded-md border border-border bg-card px-3 py-1.5 text-[12px] text-foreground hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No harness capabilities found. Start the daemon or add a local harness to see its instructions, skills, and plugins.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {items.map((manifest) => (
        <HarnessCapabilityCard key={manifest.harness_id} manifest={manifest} />
      ))}
      <div className="flex items-center justify-end">
        <button
          onClick={onRefresh}
          className="focus-ring flex items-center gap-1.5 rounded text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Icon name="ph:arrows-clockwise-bold" width="0.75rem" />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
        >
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-muted" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
            <span className="block h-2.5 w-3/4 animate-pulse rounded bg-muted" />
          </span>
          <span className="h-5 w-5 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

function HarnessCapabilityCard({ manifest }: { manifest: HarnessCapabilityManifest }) {
  const label =
    manifest.harness_id === "codex"
      ? "Codex"
      : manifest.harness_id === "claude"
        ? "Claude Code"
        : manifest.harness_id;
  const initial = label[0]?.toUpperCase() ?? "?";
  const totalItems =
    (manifest.global_instructions.present ? 1 : 0) +
    manifest.skills.length;

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[13px] font-semibold text-foreground">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">
            {totalItems === 0 ? "No config found" : `${totalItems} item${totalItems === 1 ? "" : "s"} configured`}
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground sm:ml-auto">
          {new Date(manifest.scanned_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <div className="divide-y divide-border">
        {manifest.global_instructions.present ? (
          <div className="flex items-start gap-3 px-4 py-3">
            <Icon name="ph:note-pencil" className="mt-0.5 shrink-0 text-muted-foreground" width="0.85rem" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-foreground">Global instructions</p>
              <p className="break-all text-[11px] text-muted-foreground sm:truncate">
                {manifest.global_instructions.path?.replace(/^\/Users\/[^/]+/, "~") ?? "—"}
              </p>
              {manifest.global_instructions.byte_count !== undefined && (
                <p className="text-[10px] text-muted-foreground">
                  {(manifest.global_instructions.byte_count / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-4 py-3 text-[12px] text-muted-foreground">
            <Icon name="ph:note-pencil" className="shrink-0" width="0.85rem" />
            <span>No global instructions file found</span>
          </div>
        )}

        {manifest.skills.length > 0 ? (
          <div className="px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">
              Automations / skills · {manifest.skills.length}
            </p>
            <ul className="space-y-1.5">
              {manifest.skills.map((skill) => (
                <li key={skill.id} className="flex items-start gap-2">
                  <Icon name="ph:sparkle" className="mt-0.5 shrink-0 text-muted-foreground" width="0.75rem" />
                  <div className="min-w-0">
                    <p className="break-words text-[12px] text-foreground">{skill.name}</p>
                    {skill.description && (
                      <p className="break-words text-[11px] text-muted-foreground">{skill.description}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {manifest.skills && manifest.skills.length > 0 && (
          <div className="px-4 py-2">
            <p className="text-[11px] text-muted-foreground">
              Skills · {manifest.skills.length}
              {" — "}
              {manifest.skills.slice(0, 3).map((s) => s.name).join(", ")}
              {manifest.skills.length > 3 ? ` +${manifest.skills.length - 3} more` : ""}
            </p>
          </div>
        )}

        {manifest.warnings.length > 0 ? (
          <div className="px-4 py-3">
            {manifest.warnings.map((warning, i) => (
              <p key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Icon name="ph:warning-fill" width={11} aria-hidden />
                <span className="min-w-0 break-words">{warning.message}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
