"use client";

/**
 * Familiar tab · MCP & plugins section (design-handoff rebuild).
 *
 * One card: header (count + scan freshness), a status band with Rescan +
 * "Connect custom server", the live plugin/MCP rows from the capability
 * manifest, and a "Well-known servers" grid fed by /api/mcp (the marketplace
 * registry — id/transport/target only; the registry carries no descriptions
 * and we do not invent any). "Check servers" runs the MCP doctor
 * (/api/mcp/health) on demand and pins an honest verdict on each grid card:
 * ready / needs config / unavailable, with unmet requirement names in the
 * tooltip — never values.
 *
 * The connect modal is honest about what the cave can do: there is no backend
 * that persists an MCP server connection, so the primary action copies a
 * ready-to-paste `mcpServers` config snippet for the user's runtime config —
 * picked up by the next Rescan.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { TextInput } from "@/components/ui/text-input";
import { TextArea } from "@/components/ui/text-area";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import type { FamiliarSectionData } from "@/lib/familiar-tab-section-model";
import type { CapabilitiesResponse, HarnessCapabilityManifest, HarnessPlugin } from "@/app/api/capabilities/route";
import type { McpServerInfo } from "@/app/api/mcp/route";
import type { McpHealthResponse, McpServerHealth } from "@/app/api/mcp/health/route";
import "@/styles/familiar-tab-mcp.css";

// ── Config-snippet helpers (exported for reuse; pure) ────────────────────────

/** Parse "KEY=value, one per line" into an env record. Lines without a key are skipped. */
export function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

/**
 * Build the ready-to-paste `mcpServers` JSON for a runtime MCP config.
 * URLs become an http-transport entry; anything else is split on whitespace
 * into command + args.
 */
export function buildMcpConfigSnippet(name: string, commandOrUrl: string, envText: string): string {
  const key = name.trim() || "my-server";
  const target = commandOrUrl.trim();
  const env = parseEnvLines(envText);
  const server: Record<string, unknown> = /^https?:\/\//i.test(target)
    ? { type: "http", url: target }
    : (() => {
        const parts = target.split(/\s+/).filter(Boolean);
        return { command: parts[0] ?? "", args: parts.slice(1) };
      })();
  if (Object.keys(env).length > 0) server.env = env;
  return JSON.stringify({ mcpServers: { [key]: server } }, null, 2);
}

function splitPlugins(manifest: HarnessCapabilityManifest): { mcp: HarnessPlugin[]; plugins: HarnessPlugin[] } {
  const all = manifest.plugins ?? [];
  return {
    mcp: all.filter((p) => p.kind?.toLowerCase() === "mcp"),
    plugins: all.filter((p) => p.kind?.toLowerCase() !== "mcp"),
  };
}

function pluginCommandLine(p: HarnessPlugin): string {
  return [p.command ?? "", ...(p.args ?? [])].join(" ").trim();
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function HealthPill({ h }: { h: McpServerHealth }) {
  const label = h.status === "needs-config" ? "needs config" : h.status;
  const title = h.requires.length > 0 ? `${h.detail} — requires ${h.requires.join(", ")}` : h.detail;
  return (
    <span className={`familiar-mcp__pill familiar-mcp__health familiar-mcp__health--${h.status}`} title={title}>
      {label}
    </span>
  );
}

function PluginRow({ p }: { p: HarnessPlugin }) {
  const cmd = pluginCommandLine(p);
  return (
    <li className={`familiar-mcp__row${p.enabled ? "" : " familiar-mcp__row--disabled"}`}>
      <span className="familiar-mcp__row-name">{p.name}</span>
      <span className="familiar-mcp__pill">{p.kind?.toLowerCase() || "plugin"}</span>
      {p.enabled ? null : <span className="familiar-mcp__disabled-marker">disabled</span>}
      {cmd ? (
        <span className="familiar-mcp__row-cmd" title={cmd}>
          {cmd}
        </span>
      ) : null}
    </li>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

type CopiedState = { field: "name" | "command" | "config"; value: string } | null;
type Draft = { name: string; command: string; env: string };

const EMPTY_DRAFT: Draft = { name: "", command: "", env: "" };

export function FamiliarMcpSection({ data }: { data: FamiliarSectionData }) {
  // After a Rescan, the freshly fetched manifest overrides the prop snapshot
  // until the hub refetches on its own. Dropped when the familiar's harness
  // changes so a stale override never bleeds across familiars.
  const [freshManifest, setFreshManifest] = useState<HarnessCapabilityManifest | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<McpServerInfo[] | null>(null);
  const [health, setHealth] = useState<Record<string, McpServerHealth> | null>(null);
  const [checking, setChecking] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [copied, setCopied] = useState<CopiedState>(null);
  const copyTimer = useRef<number | null>(null);
  // Bumped on harness change and on each rescan start so a slow response for
  // a previous harness (or a superseded click) can't apply a stale manifest.
  const rescanGeneration = useRef(0);

  useEffect(() => {
    rescanGeneration.current += 1;
    setFreshManifest(null);
    setRescanError(null);
  }, [data.harnessId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mcp")
      .then((res) => res.json())
      .then((body: { ok?: boolean; servers?: McpServerInfo[] }) => {
        if (!cancelled) setCatalog(Array.isArray(body?.servers) ? body.servers : []);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const manifest = freshManifest ?? data.manifest;
  const { mcp: mcpPlugins, plugins: nonMcpPlugins } = freshManifest
    ? splitPlugins(freshManifest)
    : { mcp: data.mcpPlugins, plugins: data.nonMcpPlugins };
  const hasPlugins = mcpPlugins.length + nonMcpPlugins.length > 0;

  // /api/capabilities?harness=… forwards refresh=1 to the daemon's per-harness
  // scanner, so this is a genuine rescan — not just a cache-busting refetch.
  const rescan = useCallback(async () => {
    const generation = ++rescanGeneration.current;
    setRescanning(true);
    setRescanError(null);
    try {
      const res = await fetch(`/api/capabilities?harness=${encodeURIComponent(data.harnessId)}&refresh=1`, {
        cache: "no-store",
      });
      const body = (await res.json()) as CapabilitiesResponse;
      if (rescanGeneration.current !== generation) return; // superseded — drop stale result
      const next = body?.harness_capabilities?.[0];
      if (next) {
        setFreshManifest(next);
      } else {
        setRescanError("Rescan returned no capability data — is the daemon running?");
      }
    } catch {
      if (rescanGeneration.current === generation) {
        setRescanError("Rescan failed — daemon unreachable. Showing the last snapshot.");
      }
    } finally {
      if (rescanGeneration.current === generation) setRescanning(false);
    }
  }, [data.harnessId]);

  // The MCP doctor probes remote endpoints and checks stdio launchers on the
  // machine running the cave server — on demand only, never on mount.
  const checkServers = useCallback(async () => {
    setChecking(true);
    setHealthError(null);
    try {
      const res = await fetch("/api/mcp/health", { cache: "no-store" });
      const body = (await res.json()) as McpHealthResponse;
      const next: Record<string, McpServerHealth> = {};
      for (const server of Array.isArray(body?.servers) ? body.servers : []) next[server.id] = server;
      if (Object.keys(next).length === 0) {
        setHealthError("Health check returned no servers — is the marketplace registry present?");
      } else {
        setHealth(next);
      }
    } catch {
      setHealthError("Health check failed — the cave server did not respond.");
    } finally {
      setChecking(false);
    }
  }, []);

  const copyText = useCallback((value: string, field: "name" | "command" | "config") => {
    if (!value) return;
    let write: Promise<void>;
    try {
      write = navigator.clipboard.writeText(value);
    } catch {
      return; // Clipboard unavailable (permissions, insecure context) — don't claim success.
    }
    write.then(
      () => {
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        setCopied({ field, value });
        copyTimer.current = window.setTimeout(() => setCopied(null), 2000);
      },
      () => {
        // Write rejected — leave the UI untouched rather than show a false "Copied".
      },
    );
  }, []);

  const openConnect = useCallback((server?: McpServerInfo) => {
    setDraft(server ? { name: server.id, command: server.target ?? "", env: "" } : EMPTY_DRAFT);
    setCopied(null);
    setModalOpen(true);
  }, []);

  const closeConnect = useCallback(() => {
    setModalOpen(false);
    setCopied(null);
  }, []);

  const scannedNote = manifest?.scanned_at ? `scanned ${relativeTime(manifest.scanned_at) || "just now"}` : "not scanned yet";

  const copyWrapClass = (field: "name" | "command") =>
    copied?.field === field ? "familiar-mcp__copy-wrap familiar-mcp__copy-ok familiar-mcp__copy-pop" : "familiar-mcp__copy-wrap";

  return (
    <section className="familiar-tab__card familiar-mcp" aria-label="MCP & plugins">
      <header className="familiar-mcp__head">
        <div className="familiar-mcp__head-left">
          <span className="familiar-tab__card-title">MCP &amp; plugins</span>
          <span className="familiar-mcp__count">
            {nonMcpPlugins.length} plugin{nonMcpPlugins.length === 1 ? "" : "s"} · {mcpPlugins.length} MCP
          </span>
        </div>
        <span className="familiar-mcp__scanned">{scannedNote}</span>
      </header>

      <div className="familiar-mcp__status">
        <span className="familiar-mcp__status-copy">
          {rescanError ? (
            <span className="familiar-mcp__status-error" role="alert">
              {rescanError}
            </span>
          ) : hasPlugins ? (
            "From the latest capability scan — rescan after editing your runtime's MCP config."
          ) : (
            "No plugins or MCP servers yet — connect a well-known server below, or bring your own."
          )}
        </span>
        <div className="familiar-mcp__status-actions">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="ph:arrows-clockwise"
            onClick={rescan}
            disabled={rescanning}
            aria-label="Rescan capabilities"
          >
            {rescanning ? "Rescanning…" : "Rescan"}
          </Button>
          <Button variant="primary" size="sm" leadingIcon="ph:plus" onClick={() => openConnect()}>
            Connect custom server
          </Button>
        </div>
      </div>

      {hasPlugins ? (
        <ul className="familiar-mcp__rows">
          {nonMcpPlugins.map((p) => (
            <PluginRow key={p.id} p={p} />
          ))}
          {mcpPlugins.map((p) => (
            <PluginRow key={p.id} p={p} />
          ))}
        </ul>
      ) : null}

      <div className="familiar-mcp__catalog">
        <div className="familiar-mcp__catalog-title-row">
          <div className="familiar-mcp__catalog-title">Well-known servers</div>
          <Button
            variant="ghost"
            size="xs"
            leadingIcon="ph:heartbeat"
            onClick={checkServers}
            disabled={checking || !catalog || catalog.length === 0}
            aria-label="Check server health"
          >
            {checking ? "Checking…" : "Check servers"}
          </Button>
        </div>
        {healthError ? (
          <p className="familiar-mcp__catalog-note familiar-mcp__status-error" role="alert">
            {healthError}
          </p>
        ) : null}
        {catalog === null ? (
          <p className="familiar-mcp__catalog-note">Loading registry…</p>
        ) : catalog.length === 0 ? (
          <p className="familiar-mcp__catalog-note">No servers in the marketplace registry yet.</p>
        ) : (
          <div className="familiar-mcp__grid">
            {catalog.map((server) => (
              <div key={server.id} className="familiar-mcp__server">
                <span className="familiar-mcp__server-name">{server.id}</span>
                <span className="familiar-mcp__pill">{server.transport}</span>
                {health?.[server.id] ? <HealthPill h={health[server.id]} /> : null}
                {server.target ? (
                  <span className="familiar-mcp__server-target" title={server.target}>
                    {server.target}
                  </span>
                ) : null}
                <div className="familiar-mcp__server-cta">
                  <Button
                    variant="secondary"
                    size="xs"
                    leadingIcon="ph:plus"
                    onClick={() => openConnect(server)}
                    aria-label={`Connect ${server.id}`}
                  >
                    Connect
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={closeConnect}
        breadcrumb={[data.familiar.display_name, "Connect an MCP server"]}
        footerActions={
          <>
            <Button variant="secondary" size="sm" onClick={closeConnect}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              leadingIcon={copied?.field === "config" ? "ph:check" : "ph:copy"}
              onClick={() => copyText(buildMcpConfigSnippet(draft.name, draft.command, draft.env), "config")}
              disabled={!draft.command.trim()}
            >
              Copy config
            </Button>
          </>
        }
      >
        <div className="familiar-mcp__form">
          <div
            role="status"
            className={`familiar-mcp__copied${copied ? "" : " familiar-mcp__copied--idle"}`}
          >
            {copied ? (
              <>
                <Icon name="ph:check" width={12} aria-hidden />
                <span className="familiar-mcp__copied-label">Copied</span>
                <span className="familiar-mcp__copied-value">{copied.value}</span>
              </>
            ) : null}
          </div>

          <Field label="Server name" description="How this server shows up in capability scans.">
            <div className="familiar-mcp__copy-row">
              <div className="familiar-mcp__copy-row-input">
                <TextInput
                  placeholder="e.g., grimoire-search"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <span className={copyWrapClass("name")}>
                <IconButton
                  icon={copied?.field === "name" ? "ph:check" : "ph:copy"}
                  size="sm"
                  aria-label="Copy server name"
                  onClick={() => copyText(draft.name, "name")}
                />
              </span>
            </div>
          </Field>

          <Field
            label="Command or URL"
            description="The command your runtime runs to start this server — or the server URL for HTTP transports."
          >
            <div className="familiar-mcp__copy-row">
              <div className="familiar-mcp__copy-row-input">
                <TextInput
                  placeholder="e.g., npx @coven/mcp-grimoire"
                  value={draft.command}
                  onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
                />
              </div>
              <span className={copyWrapClass("command")}>
                <IconButton
                  icon={copied?.field === "command" ? "ph:check" : "ph:copy"}
                  size="sm"
                  aria-label="Copy command"
                  onClick={() => copyText(draft.command, "command")}
                />
              </span>
            </div>
          </Field>

          <Field label="Environment" description="KEY=value, one per line." optional>
            <TextArea
              placeholder="e.g., GRIMOIRE_TOKEN=…"
              rows={3}
              value={draft.env}
              onChange={(e) => setDraft((d) => ({ ...d, env: e.target.value }))}
            />
          </Field>

          <p className="familiar-mcp__hint">
            Nothing is saved here — Copy config puts a ready-to-paste mcpServers block on your clipboard. Paste it into
            your runtime&apos;s MCP config, then Rescan to pick it up.
          </p>
        </div>
      </Modal>
    </section>
  );
}
