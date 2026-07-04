// Chat host registry — which machines a chat session can execute on, and how
// a client-requested host resolves to a concrete runtime. Pure / framework-
// free / client-safe so the composer chip, the /api/hosts route, and the chat
// send route all share one model.
//
// Security model (fail-closed, like project permissions): the client only ever
// names a host id — "local" or a REGISTERED ssh host. The server resolves the
// id against the registry (config.remoteHosts ∪ familiars' ssh runtime
// bindings); an unregistered host is rejected, and the remote `command` always
// comes from the registry, never from the request.

import {
  isSshRuntime,
  normalizeFamiliarRuntime,
  type FamiliarRuntime,
  type SshFamiliarRuntime,
} from "./familiar-runtime.ts";

/** Sentinel host id for "this machine" — a real id so it can force-local a
 *  chat whose familiar is bound to a remote runtime. */
export const LOCAL_HOST_ID = "local";

export type ChatHostOption = {
  /** LOCAL_HOST_ID or the ssh host string. */
  id: string;
  kind: "local" | "ssh";
  label: string;
  cwd?: string;
  /** true/false from a live probe; null = not probed. */
  online: boolean | null;
};

export type SshHostRegistryEntry = {
  host: string;
  cwd: string;
  command?: string;
};

/**
 * The merged, deduped ssh-host registry: explicitly registered remote hosts
 * first (their cwd/command win), then hosts inherited from familiars' runtime
 * bindings. Invalid entries are dropped via the same validation the send
 * route enforces.
 */
export function sshHostRegistry(args: {
  remoteHosts: Array<Partial<SshHostRegistryEntry> | null | undefined>;
  familiarRuntimes: Array<Partial<FamiliarRuntime> | null | undefined>;
}): SshFamiliarRuntime[] {
  const seen = new Set<string>();
  const registry: SshFamiliarRuntime[] = [];
  const add = (candidate: Partial<FamiliarRuntime> | null | undefined) => {
    const runtime = normalizeFamiliarRuntime(candidate as FamiliarRuntime);
    if (!isSshRuntime(runtime) || seen.has(runtime.host)) return;
    seen.add(runtime.host);
    registry.push(runtime);
  };
  for (const entry of args.remoteHosts) {
    add(entry ? { kind: "ssh", host: entry.host, cwd: entry.cwd, command: entry.command } : null);
  }
  for (const runtime of args.familiarRuntimes) add(runtime);
  return registry;
}

/** Picker options: the local machine first, then every registered ssh host. */
export function chatHostOptions(args: {
  localLabel: string;
  registry: SshFamiliarRuntime[];
}): ChatHostOption[] {
  return [
    { id: LOCAL_HOST_ID, kind: "local", label: args.localLabel || "This machine", online: true },
    ...args.registry.map((runtime) => ({
      id: runtime.host,
      kind: "ssh" as const,
      label: runtime.host,
      cwd: runtime.cwd,
      online: null,
    })),
  ];
}

/** Parse a conversation's recorded runtime ("local:<cwd>" | "ssh:<host>:<cwd>"). */
export function parseConversationRuntime(
  runtime: string | null | undefined,
): { kind: "local"; cwd?: string } | { kind: "ssh"; host: string; cwd?: string } | null {
  if (typeof runtime !== "string" || !runtime) return null;
  if (runtime.startsWith("local:")) {
    const cwd = runtime.slice("local:".length).trim();
    return { kind: "local", ...(cwd ? { cwd } : {}) };
  }
  if (runtime.startsWith("ssh:")) {
    const rest = runtime.slice("ssh:".length);
    const sep = rest.indexOf(":");
    const host = (sep === -1 ? rest : rest.slice(0, sep)).trim();
    const cwd = sep === -1 ? "" : rest.slice(sep + 1).trim();
    if (!host) return null;
    return { kind: "ssh", host, ...(cwd ? { cwd } : {}) };
  }
  return null;
}

export type RequestedRuntimeResolution =
  | { ok: true; runtime: FamiliarRuntime | null }
  | { ok: false; error: string };

/**
 * Resolve what runtime a send should use, before falling back to the
 * familiar's own binding:
 *
 *  - an explicit `requestedHost` wins — "local" forces the local machine, a
 *    registered ssh host resolves to its registry runtime, anything else is
 *    REJECTED (fail closed; the picker only offers registered hosts);
 *  - with no request, a conversation previously recorded on an ssh host stays
 *    pinned there while that host remains registered (remote chats must not
 *    silently fall back to local because the picker default is local);
 *  - otherwise null — the caller uses the familiar binding.
 */
export function resolveRequestedRuntime(args: {
  requestedHost: string | null | undefined;
  conversationRuntime: string | null | undefined;
  registry: SshFamiliarRuntime[];
}): RequestedRuntimeResolution {
  const requested = typeof args.requestedHost === "string" ? args.requestedHost.trim() : "";
  if (requested) {
    if (requested === LOCAL_HOST_ID) return { ok: true, runtime: { kind: "local" } };
    const match = args.registry.find((runtime) => runtime.host === requested);
    if (!match) return { ok: false, error: `host '${requested}' is not registered` };
    return { ok: true, runtime: match };
  }
  const recorded = parseConversationRuntime(args.conversationRuntime);
  if (recorded?.kind === "ssh") {
    const match = args.registry.find((runtime) => runtime.host === recorded.host);
    // Re-pin the conversation's host, keeping its recorded cwd (the harness
    // session store on the remote is cwd-scoped, same as local resume).
    if (match) return { ok: true, runtime: { ...match, cwd: recorded.cwd || match.cwd } };
  }
  return { ok: true, runtime: null };
}
