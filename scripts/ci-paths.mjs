#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FRONTEND_PATH =
  /^(?:src\/|public\/|schemas\/research\/|server\.(?:mjs|ts)$|scripts\/|tests\/|package\.json$|pnpm-lock\.yaml$|next\.config|playwright\.config|tsconfig|eslint\.config|postcss\.config|\.github\/workflows\/)/;
// Rust validation includes the doctest job and its contract test. Workflow
// changes must exercise that job too; otherwise a broken command can merge
// while only the frontend path-aware lanes run.
const RUST_PATH =
  /^(?:src-tauri\/|Cargo\.(?:toml|lock)$|rust-toolchain|scripts\/rust-doctest-ci\.test\.mjs|\.github\/workflows\/(?:ci|full-validation)\.yml$)/;
const ROOT_RUNTIME_PATH = /^[^/]+\.(?:[cm]?[jt]s|tsx?)$/;
const E2E_PATH =
  /^(?:src\/(?:app|components|lib|styles)\/|tests\/|server\.(?:mjs|ts)$|playwright\.config|package\.json$|pnpm-lock\.yaml$)/;
// `ios-select-simulator.mjs` and `ios-xctest-summary.mjs` are listed because
// they ARE the iOS gate: one chooses the destination the suite runs against,
// the other is the sole verdict on whether it ran (cave-ac372). Without them
// here, editing the gate's own machinery ran everything except the job that
// would have exercised it.
const IOS_PATH =
  /^(?:apps\/ios\/|scripts\/(?:ios-xcodegen\.sh|build-ios-(?:markdown|terminal)\.mjs|ios-(?:select-simulator|xctest-summary)(?:\.test)?\.mjs|ios-build-ci\.test\.mjs|ci-paths(?:\.test)?\.mjs)$|package\.json$|pnpm-lock\.yaml$|\.github\/workflows\/ci\.yml$)/;
const CLIENT_V1_PATH =
  /^(?:src\/lib\/server\/client-v1\/|src\/app\/api\/client\/v1\/|src\/app\/api\/api-contracts\.test\.ts$|scripts\/(?:export-client-v1-(?:contract|hpke-vectors)|client-v1-(?:release-smoke|conformance|authority-takeover))(?:\.test)?\.mjs$|docs\/api\/client-v1(?:[./-]|$)|docs\/client-v1(?:[./-]|$)|docs\/workflows\/client-v1-conformance\.md$|\.gitattributes$)/;
// docs/ is deliberately absent from FRONTEND_PATH — a documentation change
// should not pay for lint, typecheck, and build. But that also meant the docs
// index ratchet, which only fires when a doc is added or renamed, never ran on
// the change it guards. This class gates one cheap builtins-only check instead.
const DOCS_PATH = /^docs\//;

export function classifyCiPaths(paths) {
  const normalized = paths
    .map((value) => value.trim())
    .filter(Boolean);
  const clientV1 = normalized.some((file) => CLIENT_V1_PATH.test(file));
  return {
    frontend: clientV1 || normalized.some((file) => FRONTEND_PATH.test(file) || ROOT_RUNTIME_PATH.test(file)),
    rust: normalized.some((file) => RUST_PATH.test(file)),
    e2e: clientV1 || normalized.some((file) => E2E_PATH.test(file) || ROOT_RUNTIME_PATH.test(file)),
    ios: normalized.some((file) => IOS_PATH.test(file)),
    docs: clientV1 || normalized.some((file) => DOCS_PATH.test(file)),
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error("usage: ci-paths.mjs --base <sha> --head <sha>");
    }
    values[key.slice(2)] = value;
  }
  return values;
}

function changedPaths(base, head) {
  if (!base || /^0+$/.test(base)) return null;
  return execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
  }).split("\n");
}

function main() {
  const { base = "", head = "" } = parseArgs(process.argv.slice(2));
  if (!head) throw new Error("head SHA is required");
  const paths = changedPaths(base, head);
  const result = paths
    ? classifyCiPaths(paths)
    : { frontend: true, rust: true, e2e: true, ios: true, docs: true };
  for (const [name, enabled] of Object.entries(result)) {
    process.stdout.write(`${name}=${enabled}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
