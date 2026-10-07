/**
 * Connectors: per-chat links to outside services a familiar may use on a turn.
 *
 * Credentials never travel in a request. Cave already places each familiar's
 * granted credentials in that familiar's spawn env (harness-spawn-env.ts:
 * the Vault GitHub PAT as GITHUB_PAT, shared Vault keys such as ASANA_PAT).
 * A turn only names which connectors the user turned on; this module checks
 * the turn's real env, exposes an already-present credential under the name
 * the tool reads (gh reads GH_TOKEN), and tells the familiar what it can use.
 * It never widens scope: nothing here reads the Vault.
 */
import { GITHUB_HARNESS_TOKEN_ENV_KEYS } from "./github-token-env";

export const CONNECTOR_IDS = ["github", "asana"] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];
export type TurnConnector = { id: ConnectorId; available: boolean };

export const CONNECTOR_NAMES: Record<ConnectorId, string> = {
  github: "GitHub",
  asana: "Asana",
};

const ASANA_TOKEN_ENV_KEYS = ["ASANA_PAT", "ASANA_ACCESS_TOKEN"] as const;

function isConnectorId(value: string): value is ConnectorId {
  return (CONNECTOR_IDS as readonly string[]).includes(value);
}

/** Allowlisted, de-duplicated connector ids from an untrusted request body. */
export function parseConnectorIds(value: unknown): ConnectorId[] {
  if (!Array.isArray(value)) return [];
  const ids: ConnectorId[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim().toLowerCase();
    if (isConnectorId(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function firstToken(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Report which requested connectors this turn can really use, and expose an
 * already-present credential under the name its tool reads. `env` is the
 * exact env the harness will be spawned with; pass null for runtimes whose
 * environment is not this machine's (ssh hosts, the Hermes API, OpenClaw).
 */
export function prepareTurnConnectors(
  requested: readonly ConnectorId[],
  env: NodeJS.ProcessEnv | null,
): TurnConnector[] {
  return requested.map((id) => {
    if (!env) return { id, available: false };
    if (id === "github") {
      const token = firstToken(env, GITHUB_HARNESS_TOKEN_ENV_KEYS);
      if (!token) return { id, available: false };
      if (!env.GH_TOKEN?.trim()) env.GH_TOKEN = token;
      return { id, available: true };
    }
    const token = firstToken(env, ASANA_TOKEN_ENV_KEYS);
    if (!token) return { id, available: false };
    if (!env.ASANA_PAT?.trim()) env.ASANA_PAT = token;
    return { id, available: true };
  });
}

const AVAILABLE_GUIDANCE: Record<ConnectorId, string> = {
  github:
    "GitHub — on. The gh CLI is signed in for this turn through GH_TOKEN. Use gh (gh issue, gh pr, gh run, gh api) to look things up. Ask before any write such as a comment, review, merge, close, or push unless the user asked for that exact action. When a reply centers on one issue, pull request, commit, or run, include its coven:github card marker.",
  asana:
    "Asana — on. A personal access token is in the ASANA_PAT environment variable. Call the Asana REST API at https://app.asana.com/api/1.0 with the header Authorization: Bearer $ASANA_PAT, referencing the variable rather than its value. Ask before creating, assigning, or completing a task unless the user asked for that exact action. Link each task by its https://app.asana.com URL.",
};

/** The per-turn `<connectors>` prompt block; empty when nothing is on. */
export function buildConnectorsDirective(connectors: readonly TurnConnector[]): string {
  if (connectors.length === 0) return "";
  return [
    "<connectors>",
    "The user turned these connectors on for this chat. Use them when they help with the request.",
    ...connectors.map(({ id, available }) =>
      available
        ? AVAILABLE_GUIDANCE[id]
        : `${CONNECTOR_NAMES[id]} — requested, but no ${CONNECTOR_NAMES[id]} credential reached you on this turn. If the request needs it, say so in one sentence and suggest connecting ${CONNECTOR_NAMES[id]} in Coven Cave on the desktop. Never ask the user to paste a token.`,
    ),
    "Never print, echo, or write a token value anywhere, including commands, files, and replies.",
    "Do not mention this block unless asked.",
    "</connectors>",
  ].join("\n");
}
