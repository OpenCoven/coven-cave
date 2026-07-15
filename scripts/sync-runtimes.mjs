// Sync the accepted runtime registry from OpenCoven/coven-runtimes into a
// committed, reviewable module: src/lib/runtime-registry.gen.ts.
//
// Source of truth is the registry's committed canonical index
// (crates/coven-runtime-registry/canonical/index.json) — the same bytes
// `RegistryIndex::canonical()` embeds for Rust consumers, drift-guarded
// against registry/runtimes/** by coven-runtimes CI. Reading the compiled
// index (instead of raw manifests) inherits its guarantees: validated
// entries, version immutability, and yank status.
//
// Usage:
//   node scripts/sync-runtimes.mjs               # fetch from GitHub main
//   node scripts/sync-runtimes.mjs --ref <ref>   # branch / tag / sha
//   node scripts/sync-runtimes.mjs --local <dir> # local coven-runtimes checkout
//   node scripts/sync-runtimes.mjs --check       # exit 1 if the committed
//                                                # module is stale vs upstream
//
// The output is deterministic: provenance pins the index *blob* sha (not the
// commit), so unrelated upstream commits never churn the generated file and
// the sync workflow can detect a true no-op with `git diff --quiet`.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REGISTRY_REPO = "OpenCoven/coven-runtimes";
const INDEX_PATH = "crates/coven-runtime-registry/canonical/index.json";
const SUPPORTED_INDEX_FORMAT = "1";

// Cave-side policy exclusions. These ids stay accepted upstream but are not
// runtimes Cave should offer: Coven Code is the app/tool Cave installs and
// updates itself (onboarding + OpenCoven tools), not a familiar harness
// choice — harness-adapters.test.ts pins the same stance for summoning.
export const CAVE_EXCLUDED_RUNTIME_IDS = new Set(["coven-code"]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(scriptDir, "..", "src", "lib", "runtime-registry.gen.ts");

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Compare two `major.minor.patch[-pre]` strings; release > prerelease.
 *  Prerelease precedence follows semver §11.4: dot-separated identifiers
 *  compare numerically when both are all-digits (so rc.10 > rc.9), lexically
 *  otherwise; numeric identifiers rank below alphanumeric; fewer identifiers
 *  lose the tie. */
export function compareSemver(a, b) {
  const parse = (v) => {
    // Build metadata is ignored for precedence (semver §10).
    const [bare] = String(v).split("+");
    const [core, ...pre] = bare.split("-");
    const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre.join("-") };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1; // release beats prerelease
  if (!pb.pre) return -1;
  const idsA = pa.pre.split(".");
  const idsB = pb.pre.split(".");
  const NUM_RE = /^\d+$/;
  for (let i = 0; i < Math.min(idsA.length, idsB.length); i++) {
    const ia = idsA[i];
    const ib = idsB[i];
    if (ia === ib) continue;
    const na = NUM_RE.test(ia);
    const nb = NUM_RE.test(ib);
    if (na && nb) return Number(ia) - Number(ib);
    if (na !== nb) return na ? -1 : 1; // numeric < alphanumeric
    return ia < ib ? -1 : 1;
  }
  return idsA.length - idsB.length;
}

/**
 * Validate one index entry's adapter. Returns a list of problems (empty =
 * valid). The registry validates on its side too — this is a defensive gate
 * so a malformed upstream entry can never compile into Cave.
 */
export function validateAdapter(id, adapter) {
  const problems = [];
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    return [`${id}: adapter is not an object`];
  }
  if (adapter.id !== id) problems.push(`${id}: adapter.id "${adapter.id}" does not match its registry key`);
  if (!ID_RE.test(String(adapter.id ?? ""))) problems.push(`${id}: adapter.id must match ${ID_RE}`);
  for (const key of ["label", "executable", "install_hint"]) {
    if (typeof adapter[key] !== "string" || !adapter[key].trim()) {
      problems.push(`${id}: adapter.${key} must be a non-empty string`);
    }
  }
  for (const key of ["interactive_prompt_prefix_args", "non_interactive_prompt_prefix_args"]) {
    const value = adapter[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== "string"))) {
      problems.push(`${id}: adapter.${key} must be an array of strings`);
    }
  }
  const caps = adapter.capabilities;
  if (caps !== undefined && (typeof caps !== "object" || caps === null || Array.isArray(caps))) {
    problems.push(`${id}: adapter.capabilities must be an object`);
  }
  return problems;
}

/**
 * From a canonical RegistryIndex document, pick the newest non-yanked version
 * of every runtime. Runtimes whose versions are all yanked are omitted
 * (mirrors `resolve_latest` in the registry crate). Throws on a malformed
 * index or adapter.
 */
export function pickAcceptedRuntimes(index) {
  if (!index || typeof index !== "object") throw new Error("registry index is not an object");
  if (index.format !== SUPPORTED_INDEX_FORMAT) {
    throw new Error(`unsupported registry index format "${index.format}" (expected "${SUPPORTED_INDEX_FORMAT}")`);
  }
  if (!index.runtimes || typeof index.runtimes !== "object") throw new Error("registry index has no runtimes map");
  const picked = [];
  const problems = [];
  for (const id of Object.keys(index.runtimes).sort()) {
    if (CAVE_EXCLUDED_RUNTIME_IDS.has(id)) continue; // Cave-side policy, see above
    const entries = index.runtimes[id];
    if (!Array.isArray(entries)) {
      problems.push(`${id}: entries is not an array`);
      continue;
    }
    const live = entries.filter((e) => e && !e.yanked && typeof e.version === "string");
    if (live.length === 0) continue; // fully yanked → not accepted
    const latest = live.reduce((best, e) => (compareSemver(e.version, best.version) > 0 ? e : best));
    const adapterProblems = validateAdapter(id, latest.adapter);
    if (adapterProblems.length > 0) {
      problems.push(...adapterProblems);
      continue;
    }
    picked.push({ id, version: latest.version, adapter: latest.adapter });
  }
  if (problems.length > 0) {
    throw new Error(`registry index failed validation:\n  ${problems.join("\n  ")}`);
  }
  return picked;
}

/** Render the generated TypeScript module. Deterministic for identical input. */
export function renderModule(picked, source) {
  const runtimes = picked.map(({ id, version, adapter }) => ({
    id,
    label: adapter.label,
    binary: adapter.executable,
    installHint: adapter.install_hint,
    version,
    homepage: typeof adapter.homepage === "string" ? adapter.homepage : undefined,
    description: typeof adapter.description === "string" ? adapter.description : undefined,
    modelFlag: typeof adapter.model_flag === "string" ? adapter.model_flag : null,
    capabilities: {
      stream: adapter.capabilities?.stream === true,
      preassignedSessionId: adapter.capabilities?.preassigned_session_id === true,
      think: adapter.capabilities?.think === true,
      speed: adapter.capabilities?.speed === true,
    },
    // The exact $COVEN_HOME/adapters/<id>.json document for this runtime.
    adapterManifest: { adapters: [adapter] },
  }));
  const body = JSON.stringify(runtimes, null, 2);
  return `// GENERATED by scripts/sync-runtimes.mjs — do not edit by hand.
// Re-generate with: pnpm sync:runtimes
//
// Source: ${source.repo} canonical registry index
//   ref:      ${source.ref}
//   blob sha: ${source.blobSha}
//
// Every entry passed coven-runtimes acceptance (conformance + review), so
// Cave treats these as trusted runtimes (see harness-adapters.ts). New
// runtimes get a generic glyph until someone adds a brand mark in
// runtime-logo.tsx — that polish stays a deliberate manual step.

export type RegistryRuntimeCapabilities = {
  stream: boolean;
  preassignedSessionId: boolean;
  think: boolean;
  speed: boolean;
};

export type RegistryRuntime = {
  id: string;
  label: string;
  binary: string;
  installHint: string;
  version: string;
  homepage?: string;
  description?: string;
  /** CLI flag that forwards a model id, when the runtime supports one. */
  modelFlag: string | null;
  capabilities: RegistryRuntimeCapabilities;
  /** The full \`$COVEN_HOME/adapters/<id>.json\` document for this runtime. */
  adapterManifest: unknown;
};

export const REGISTRY_SOURCE = {
  repo: ${JSON.stringify(source.repo)},
  ref: ${JSON.stringify(source.ref)},
  blobSha: ${JSON.stringify(source.blobSha)},
} as const;

export const REGISTRY_RUNTIMES: RegistryRuntime[] = ${body};
`;
}

async function fetchJson(url, accept = "application/vnd.github+json") {
  const headers = { accept, "user-agent": "coven-cave-sync-runtimes" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

/** Load the canonical index + provenance from GitHub or a local checkout. */
async function loadIndex({ ref, local }) {
  if (local) {
    const file = path.join(local, INDEX_PATH);
    if (!existsSync(file)) throw new Error(`no canonical index at ${file}`);
    const raw = readFileSync(file, "utf8");
    const blobSha = createHash("sha1")
      .update(`blob ${Buffer.byteLength(raw)}\0`)
      .update(raw)
      .digest("hex");
    return { index: JSON.parse(raw), source: { repo: REGISTRY_REPO, ref: `local:${local}`, blobSha } };
  }
  // The contents API returns the blob sha alongside the content — pinning
  // provenance to the blob keeps re-syncs byte-identical across unrelated
  // upstream commits.
  const doc = await fetchJson(
    `https://api.github.com/repos/${REGISTRY_REPO}/contents/${INDEX_PATH}?ref=${encodeURIComponent(ref)}`,
  );
  if (doc.encoding !== "base64" || typeof doc.content !== "string") {
    throw new Error("unexpected contents API response shape");
  }
  const raw = Buffer.from(doc.content, "base64").toString("utf8");
  return { index: JSON.parse(raw), source: { repo: REGISTRY_REPO, ref, blobSha: doc.sha } };
}

export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const opts = { ref: "main", local: null, check: false };
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--ref") opts.ref = args.shift() ?? "main";
    else if (arg === "--local") opts.local = args.shift() ?? null;
    else if (arg === "--check") opts.check = true;
    else throw new Error(`unknown argument: ${arg}`);
  }

  const { index, source } = await loadIndex(opts);
  const picked = pickAcceptedRuntimes(index);
  const next = renderModule(picked, source);
  const current = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, "utf8") : null;

  if (opts.check) {
    if (current === next) {
      console.log(`sync-runtimes: up to date (${picked.length} runtimes, blob ${source.blobSha.slice(0, 12)})`);
      return 0;
    }
    console.error("sync-runtimes: src/lib/runtime-registry.gen.ts is stale — run `pnpm sync:runtimes`");
    return 1;
  }

  if (current === next) {
    console.log(`sync-runtimes: no changes (${picked.length} runtimes, blob ${source.blobSha.slice(0, 12)})`);
    return 0;
  }
  writeFileSync(OUTPUT_PATH, next);
  console.log(
    `sync-runtimes: wrote ${path.relative(process.cwd(), OUTPUT_PATH)} — ${picked.length} runtimes (${picked
      .map((p) => `${p.id}@${p.version}`)
      .join(", ")})`,
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`sync-runtimes: ${err?.message ?? err}`);
      process.exit(1);
    },
  );
}
