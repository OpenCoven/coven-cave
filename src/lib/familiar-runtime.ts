export type LocalFamiliarRuntime = {
  kind: "local";
};

export type SshFamiliarRuntime = {
  kind: "ssh";
  /** SSH config host alias or hostname. Cave never stores key material. */
  host: string;
  /** Remote working directory where the familiar's harness should run. */
  cwd: string;
  /** Remote Coven executable path/name. Defaults to "coven". */
  command: string;
};

export type FamiliarRuntime = LocalFamiliarRuntime | SshFamiliarRuntime;

type RuntimeInput = Partial<FamiliarRuntime> | null | undefined;

const SAFE_SSH_HOST_RE = /^[A-Za-z0-9._:-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeFamiliarRuntime(value: RuntimeInput): FamiliarRuntime {
  if (!isRecord(value) || value.kind !== "ssh") return { kind: "local" };
  const host = typeof value.host === "string" ? value.host.trim() : "";
  const cwd = typeof value.cwd === "string" ? value.cwd.trim() : "";
  if (!host || !SAFE_SSH_HOST_RE.test(host) || !cwd) return { kind: "local" };
  const command =
    typeof value.command === "string" && value.command.trim()
      ? value.command.trim()
      : "coven";
  return { kind: "ssh", host, cwd, command };
}

export function isSshRuntime(
  runtime: FamiliarRuntime | Partial<FamiliarRuntime> | undefined,
): runtime is SshFamiliarRuntime {
  if (!isRecord(runtime) || runtime.kind !== "ssh") return false;
  const host = typeof runtime.host === "string" ? runtime.host.trim() : "";
  const cwd = typeof runtime.cwd === "string" ? runtime.cwd.trim() : "";
  const command =
    typeof runtime.command === "string" ? runtime.command.trim() : "";
  return !!host && SAFE_SSH_HOST_RE.test(host) && !!cwd && !!command;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

type SshCovenRunArgs = {
  runtime: SshFamiliarRuntime;
  harness: string;
  familiarId: string;
  prompt: string;
  sessionId?: string | null;
};

export function buildSshCovenRunCommand(args: SshCovenRunArgs): string {
  const remoteArgs = ["run", args.harness, "--stream-json"];
  if (args.sessionId) remoteArgs.push("--continue", args.sessionId);
  if (/^[a-z0-9_-]+$/i.test(args.familiarId)) {
    remoteArgs.push("--familiar", args.familiarId);
  }
  remoteArgs.push("--", args.prompt);
  return [
    "cd --",
    shellQuote(args.runtime.cwd),
    "&&",
    [args.runtime.command, ...remoteArgs].map(shellQuote).join(" "),
  ].join(" ");
}

export function buildSshSpawnArgs(args: SshCovenRunArgs): string[] {
  return [
    "-T",
    "--",
    args.runtime.host,
    buildSshCovenRunCommand(args),
  ];
}
