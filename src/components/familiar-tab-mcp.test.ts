// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Familiar tab · MCP & plugins section (design-handoff rebuild). Pins the
// honest behaviors: no invented per-server marketing copy for the registry,
// a primary modal action that copies a real config snippet (there is no
// backend that persists an MCP connection — a dead "Connect" would lie),
// a Rescan that genuinely refetches /api/capabilities, and copy feedback
// whose pop animation respects prefers-reduced-motion.

const src = readFileSync(new URL("./familiar-tab-mcp.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/familiar-tab-mcp.css", import.meta.url), "utf8");

test("section export + hub contract: FamiliarMcpSection({ data })", () => {
  assert.match(src, /export function FamiliarMcpSection\(\{ data \}: \{ data: FamiliarSectionData \}\)/, "exact export signature");
  assert.match(src, /import "@\/styles\/familiar-tab-mcp\.css"/, "section owns its stylesheet import");
  assert.match(src, /className="familiar-tab__card familiar-mcp"/, "reuses the shared card scaffold read-only");
});

test("well-known servers render registry facts only — no invented descriptions", () => {
  // The /api/mcp registry carries id/transport/target and nothing else; the
  // design mock's per-server marketing blurbs must not be hardcoded here.
  assert.doesNotMatch(src, /Issues, pull requests, and repo search/, "no fake github blurb");
  assert.doesNotMatch(src, /Read and write files under an allowed root/, "no fake filesystem blurb");
  assert.doesNotMatch(src, /Knowledge-graph memory shared across sessions/, "no fake memory blurb");
  assert.doesNotMatch(src, /\bdesc\b\s*:/, "no desc field synthesized for catalog entries");
  assert.match(src, /fetch\("\/api\/mcp"\)/, "catalog comes from the marketplace registry route");
  assert.match(src, /familiar-mcp__pill">\{server\.transport\}/, "transport pill from registry data");
  assert.match(src, /title=\{server\.target\}/, "target line is ellipsized with a full tooltip");
});

test("modal primary action is honest: Copy config, not a dead Connect that pretends to persist", () => {
  assert.match(src, /buildMcpConfigSnippet\(draft\.name, draft\.command, draft\.env\), "config"/, "primary copies the built snippet");
  assert.match(src, />\s*Copy config\s*</, "primary label says what it does");
  assert.match(src, /mcpServers: \{ \[key\]: server \}/, "snippet is a ready-to-paste mcpServers block");
  assert.match(src, /\{ type: "http", url: target \}/, "http targets get the http config shape");
  assert.match(src, /target\.split\(\/\\s\+\/\)\.filter\(Boolean\)/, "stdio commands split into command + args");
  assert.match(src, /then Rescan to pick it up/, "helper copy points at the runtime config + rescan path");
  // No POST/PUT pretending the cave stores the connection.
  assert.doesNotMatch(src, /method:\s*"(POST|PUT|PATCH)"/, "no fake persistence call");
});

test("rescan refetches /api/capabilities for this harness, uncached, with a busy state", () => {
  assert.match(
    src,
    /fetch\(`\/api\/capabilities\?harness=\$\{encodeURIComponent\(data\.harnessId\)\}&refresh=1`,\s*\{\s*cache: "no-store",?\s*\}/,
    "harness-scoped refetch with refresh=1 (the route forwards it to the daemon scanner) and no-store",
  );
  assert.match(src, /\{rescanning \? "Rescanning…" : "Rescan"\}/, "busy label");
  assert.match(src, /disabled=\{rescanning\}/, "button disables while scanning");
  assert.match(src, /setFreshManifest\(next\)/, "fresh manifest overrides the prop snapshot");
  assert.match(src, /\}, \[data\.harnessId\]\);/, "stale override drops when the harness changes");
});

test("copy feedback: single timer, check + success flip, role=status band", () => {
  assert.match(src, /navigator\.clipboard\?\.writeText\(value\)\.catch\(\(\) => \{\}\)/, "clipboard write with catch");
  const timerClears = src.match(/window\.clearTimeout\(copyTimer\.current\)/g) ?? [];
  assert.ok(timerClears.length >= 2, "one timer ref, cleared on re-copy and on unmount");
  assert.match(src, /copied\?\.field === "name" \? "ph:check" : "ph:copy"/, "icon flips to a check");
  assert.match(src, /role="status"/, "Copied confirmation is a live status region");
});

test("css: copy-pop animation has a reduced-motion guard; pills stay neutral", () => {
  assert.match(css, /@keyframes familiar-mcp-copy-pop/, "pop animation defined");
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.familiar-mcp__copy-pop \{[^}]*animation: none/,
    "reduced-motion users skip the scale pop",
  );
  assert.match(css, /\.familiar-mcp__copy-ok[\s\S]{0,80}?color: var\(--color-success\)/, "success color rides the flip");
  assert.match(css, /\.familiar-mcp__pill \{[^}]*background: var\(--bg-raised\)/, "kind/transport pill is quiet metadata");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "design tokens only — no hardcoded hex colors");
});

test("plugin rows mirror the capabilities idiom: disabled dims + marker, mono command line", () => {
  assert.match(src, /p\.enabled \? "" : " familiar-mcp__row--disabled"/, "disabled rows dim");
  assert.match(src, /\{p\.enabled \? null : <span className="familiar-mcp__disabled-marker">disabled<\/span>\}/, "only the disabled exception gets a marker");
  assert.match(src, /familiar-mcp__row-cmd" title=\{cmd\}/, "command line truncates with a tooltip");
  assert.match(src, /No plugins or MCP servers yet — connect a well-known server below, or bring your own\./, "design empty copy verbatim");
});
