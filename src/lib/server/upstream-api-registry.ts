/**
 * Every upstream (third-party, off-box) API the Cave server calls, declared in
 * one place (#6359).
 *
 * The registry is the relevance contract for the upstream anomaly suite:
 * `upstream-api-registry.test.ts` scans the server source for every file that
 * both calls `fetch` and names an external host, and fails when a call site
 * appears, moves, or disappears without this file following it. The anomaly
 * harness (`src/lib/testing/upstream-anomaly-fetch.ts`) routes stubbed
 * requests by these hosts and refuses any host that is not declared here, so a
 * route that quietly grows a new dependency fails its own matrix test.
 *
 * Keep entries data-only. `callers` are repo-relative source files that
 * perform the fetch; `hostSources` are files that only define the host
 * constant (a config module, a feed list) and never fetch it themselves.
 */

export const UPSTREAM_API_IDS = [
  "github",
  "github-raw",
  "asana",
  "openai",
  "gemini",
  "elevenlabs",
  "x-rss-bridge",
  "rss-feeds",
  "opencoven-docs",
  "skills-directory",
  "huggingface",
  "sorsa",
  "x",
  "nodejs-dist",
  "local-llm",
  "mcp-endpoint",
  "pinned-public-url",
] as const;

export type UpstreamApiId = typeof UPSTREAM_API_IDS[number];

/** How the call authenticates. `user-token` is a credential the user pasted
 *  (a PAT); `vault` is an API key resolved through the Cave vault; `oauth` is
 *  a bearer minted by an authorization-code flow. */
export type UpstreamApiAuth = "none" | "vault" | "user-token" | "oauth";

export type UpstreamApiEntry = {
  id: UpstreamApiId;
  name: string;
  purpose: string;
  /** Hosts (with port when not the scheme default) the callers actually fetch. */
  hosts: readonly string[];
  /** Repo-relative source files that perform the fetch. */
  callers: readonly string[];
  /** Files that define the host but never fetch it. */
  hostSources?: readonly string[];
  auth: UpstreamApiAuth;
  /** The host is a loopback service (Ollama, LM Studio), not an internet API. */
  loopback?: boolean;
  /** The caller fetches an operator- or user-supplied URL whose host is not
   *  known in advance; `hosts` lists only the fixed ones. */
  userSupplied?: boolean;
};

export const UPSTREAM_APIS: readonly UpstreamApiEntry[] = [
  {
    id: "github",
    name: "GitHub REST and GraphQL",
    purpose: "Issues, pull requests, checks, reviews, releases, identity and token validation.",
    hosts: ["api.github.com"],
    auth: "user-token",
    callers: [
      "src/app/api/app/latest-release/route.ts",
      "src/app/api/board/enrich-steps/route.ts",
      "src/app/api/canvas/github-source/route.ts",
      "src/app/api/github/activity/route.ts",
      "src/app/api/github/assigned/route.ts",
      "src/app/api/github/checks/route.ts",
      "src/app/api/github/comment/route.ts",
      "src/app/api/github/comments/route.ts",
      "src/app/api/github/commit/route.ts",
      "src/app/api/github/diff/route.ts",
      "src/app/api/github/dispatch/route.ts",
      "src/app/api/github/issue/route.ts",
      "src/app/api/github/item/route.ts",
      "src/app/api/github/labels/route.ts",
      "src/app/api/github/merge/route.ts",
      "src/app/api/github/pat/route.ts",
      "src/app/api/github/reactions/route.ts",
      "src/app/api/github/reply/route.ts",
      "src/app/api/github/repos/route.ts",
      "src/app/api/github/rerun/route.ts",
      "src/app/api/github/resolve-thread/route.ts",
      "src/app/api/github/review/route.ts",
      "src/app/api/github/runs/route.ts",
      "src/app/api/github/user/route.ts",
      "src/lib/github-watcher.ts",
      "src/lib/secret-validators.ts",
      "src/lib/server/github-merged.ts",
      "src/lib/server/github-review-revision.ts",
      "src/lib/server/pin-sources.ts",
      "src/lib/server/runtime-compatibility-registry.ts",
    ],
  },
  {
    id: "github-raw",
    name: "GitHub raw content",
    purpose: "Published schema registries, skill markdown and pinned repository files.",
    hosts: ["raw.githubusercontent.com"],
    auth: "none",
    callers: [
      "src/lib/codex-compatibility.ts",
      "src/lib/server/pin-sources.ts",
      "src/lib/server/skills-directory.ts",
    ],
  },
  {
    id: "asana",
    name: "Asana",
    purpose: "Connected-user identity, workspaces and assigned tasks.",
    hosts: ["app.asana.com"],
    auth: "user-token",
    callers: [
      "src/app/api/asana/assigned/route.ts",
      "src/app/api/asana/pat/route.ts",
      "src/app/api/asana/workspaces/route.ts",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    purpose: "Image generation, voice previews and Realtime session grants.",
    hosts: ["api.openai.com"],
    auth: "vault",
    callers: [
      "src/app/api/images/generate/route.ts",
      "src/app/api/projects/icon/route.ts",
      "src/app/api/voice/preview/route.ts",
      "src/lib/voice/openai-realtime.ts",
    ],
  },
  {
    id: "gemini",
    name: "Google Generative Language (Imagen)",
    purpose: "Image generation through the Gemini image models.",
    hosts: ["generativelanguage.googleapis.com"],
    auth: "vault",
    callers: [
      "src/app/api/images/generate/route.ts",
      "src/app/api/projects/icon/route.ts",
    ],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    purpose: "Voice catalog, model probe and streamed text-to-speech.",
    hosts: ["api.elevenlabs.io"],
    auth: "vault",
    callers: [
      "src/app/api/voice/elevenlabs/catalog/route.ts",
      "src/app/api/voice/elevenlabs/tts/route.ts",
      "src/lib/voice/elevenlabs.ts",
    ],
  },
  {
    id: "x-rss-bridge",
    name: "rss.app timeline bridge",
    purpose: "The Home Tweets feed, bridged from the OpenCoven X account.",
    hosts: ["rss.app"],
    auth: "none",
    callers: ["src/app/api/home-tweets/route.ts"],
  },
  {
    id: "rss-feeds",
    name: "Default RSS feeds",
    purpose: "The Home news feed sources. Hosts also owned by another entry are declared there.",
    hosts: [
      "hnrss.org",
      "www.theverge.com",
      "feeds.arstechnica.com",
      "www.technologyreview.com",
      "github.blog",
      "www.smashingmagazine.com",
      "feeds.bbci.co.uk",
    ],
    auth: "none",
    userSupplied: true,
    callers: ["src/app/api/rss/route.ts"],
    hostSources: ["src/lib/server/rss-feeds.ts"],
  },
  {
    id: "opencoven-docs",
    name: "OpenCoven documentation and Salem retrieval",
    purpose: "The llms-full.txt corpus and the hosted retrieval API behind Ask Salem.",
    hosts: ["docs.opencoven.ai", "salem.opencoven.ai"],
    auth: "none",
    userSupplied: true,
    callers: ["src/app/api/salem/route.ts"],
  },
  {
    id: "skills-directory",
    name: "skills.sh directory",
    purpose: "Marketplace skill discovery and search.",
    hosts: ["www.skills.sh"],
    auth: "none",
    userSupplied: true,
    callers: ["src/lib/server/skills-directory.ts"],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    purpose: "Paper metadata for Research and speech model downloads.",
    hosts: ["huggingface.co"],
    auth: "none",
    callers: [
      "src/lib/server/hf-paper-metadata.ts",
      "src/lib/voice/speech-models.ts",
    ],
  },
  {
    id: "sorsa",
    name: "Sorsa article provider",
    purpose: "X Article bodies for Research sources.",
    hosts: ["api.sorsa.io"],
    auth: "vault",
    callers: ["src/lib/server/x-article-sorsa.ts"],
  },
  {
    id: "x",
    name: "X API v2",
    purpose: "OAuth token exchange, account lookup, post lookup, search and publishing.",
    hosts: ["api.x.com"],
    auth: "oauth",
    callers: ["src/lib/server/x-client.ts"],
    hostSources: ["src/lib/server/x-app-config.ts"],
  },
  {
    id: "nodejs-dist",
    name: "Node.js distribution",
    purpose: "The managed Node toolchain archive downloaded during onboarding.",
    hosts: ["nodejs.org"],
    auth: "none",
    callers: ["src/lib/server/managed-node-toolchain.ts"],
    hostSources: ["src/lib/onboarding-prerequisites.ts"],
  },
  {
    id: "local-llm",
    name: "Local OpenAI-compatible server",
    purpose: "Ollama or LM Studio chat completions for the local voice loop.",
    hosts: ["127.0.0.1:11434"],
    auth: "none",
    loopback: true,
    userSupplied: true,
    callers: ["src/app/api/voice/local/chat/route.ts"],
    hostSources: ["src/lib/voice/local-loop.ts"],
  },
  {
    id: "mcp-endpoint",
    name: "Remote MCP endpoint",
    purpose: "Reachability probe of a user-configured remote MCP server.",
    hosts: [],
    auth: "none",
    userSupplied: true,
    callers: ["src/lib/endpoint-validators.ts"],
  },
  {
    id: "pinned-public-url",
    name: "Pinned public URL",
    purpose: "A user-pinned public page captured for the Grimoire, behind the public-only resolver.",
    hosts: [],
    auth: "none",
    userSupplied: true,
    callers: ["src/lib/server/pin-sources.ts"],
  },
];

/**
 * Hosts that appear in callers as links, User-Agent strings or parsed input
 * but are never fetched by server code. The relevance scan accepts them
 * without an entry; the harness still refuses a fetch to them.
 */
export const LINK_ONLY_HOSTS: Readonly<Record<string, string>> = {
  "github.com": "Release pages, repository links and the rss User-Agent string; the API host is api.github.com.",
  "x.com": "Post permalinks parsed from prose; the API host is api.x.com.",
};

const byId = new Map<UpstreamApiId, UpstreamApiEntry>(UPSTREAM_APIS.map((entry) => [entry.id, entry]));

export function upstreamApiById(id: UpstreamApiId): UpstreamApiEntry {
  const entry = byId.get(id);
  if (!entry) throw new Error(`unknown upstream api: ${id}`);
  return entry;
}

/** The first entry declaring `host` (host:port as `URL#host` reports it), or null. */
export function upstreamApiForHost(host: string): UpstreamApiEntry | null {
  const needle = host.toLowerCase();
  for (const entry of UPSTREAM_APIS) {
    if (entry.hosts.some((candidate) => candidate.toLowerCase() === needle)) return entry;
  }
  return null;
}
