// @ts-nocheck
import assert from "node:assert/strict";

const {
  deriveReadingBlock,
  provenanceLabel,
  canOpenInWorkshop,
  canApplyPatch,
  canCompare,
  staleness,
  stalenessForRead,
  snippetStartLine,
  stalenessLabel,
  resolveInspectorMode,
  SPLIT_MIN_VIEWPORT,
  MODAL_MAX_VIEWPORT,
  inspectorTabs,
  normalizeInspectorTab,
  extendSelection,
  isLineSelected,
  selectionLabel,
  selectedText,
  referenceChipLabel,
  quotedSnippet,
  isInspectorPin,
  isCodeProvenance,
} = await import("./code-reading.ts");

// ── Provenance ───────────────────────────────────────────────────────────────

// A fence that names a file is file-backed: openable and comparable.
{
  const block = deriveReadingBlock("ts:src/lib/oauth-loopback.ts");
  assert.equal(block.provenance, "file-backed");
  assert.equal(block.path, "src/lib/oauth-loopback.ts");
  assert.equal(block.name, "oauth-loopback.ts");
  assert.equal(block.dir, "src/lib");
  assert.equal(block.lang, "ts");
  assert.equal(block.isDiff, false);
  assert.equal(canOpenInWorkshop(block.provenance), true);
  assert.equal(canCompare(block.provenance), true);
  assert.equal(canApplyPatch(block.provenance), false);
}

// A bare fence is quoted: copyable, never openable. This is the guard that
// keeps "Open" from being a promise the click cannot keep.
{
  const block = deriveReadingBlock("ts");
  assert.equal(block.provenance, "quoted");
  assert.equal(block.path, null);
  assert.equal(block.name, null);
  assert.equal(block.dir, null);
  assert.equal(canOpenInWorkshop(block.provenance), false);
  assert.equal(canCompare(block.provenance), false);
  assert.equal(provenanceLabel(block.provenance), "quoted");
}

// An empty fence info is still a quoted block, not a crash.
{
  const block = deriveReadingBlock("");
  assert.equal(block.provenance, "quoted");
  assert.equal(block.path, null);
}

// A diff is generated: appliable, but there is no single file to open — even
// when the fence names the target.
{
  for (const info of ["diff", "patch", "diff:src-tauri/src/lib.rs"]) {
    const block = deriveReadingBlock(info);
    assert.equal(block.provenance, "generated", `${info} is generated`);
    assert.equal(block.isDiff, true, `${info} is a diff`);
    assert.equal(canApplyPatch(block.provenance), true);
    assert.equal(canOpenInWorkshop(block.provenance), false, `${info} is not openable`);
  }
  // …and the named target is still carried, so apply knows what it targets.
  assert.equal(deriveReadingBlock("diff:src-tauri/src/lib.rs").path, "src-tauri/src/lib.rs");
}

// A root-level file has a name but no directory.
{
  const block = deriveReadingBlock("json:package.json");
  assert.equal(block.name, "package.json");
  assert.equal(block.dir, null);
}

// Language casing does not change the classification.
{
  assert.equal(deriveReadingBlock("DIFF").provenance, "generated");
}

// Type guards reject junk.
{
  assert.equal(isCodeProvenance("file-backed"), true);
  assert.equal(isCodeProvenance("nonsense"), false);
  assert.equal(isCodeProvenance(null), false);
  assert.equal(isInspectorPin("overlay"), true);
  assert.equal(isInspectorPin("modal"), false, "modal is a resolved mode, never a stored pin");
}

// ── Staleness ────────────────────────────────────────────────────────────────

const FILE = [
  "import { spawnLoopback } from \"@/lib/server/loopback\";",
  "",
  "const CALLBACK_PATH = \"/callback\";",
  "",
  "export async function awaitLoopbackGrant(port: number) {",
  "  const server = await spawnLoopback({ host: \"127.0.0.1\", port });",
  "}",
].join("\n");

// An excerpt that still appears verbatim is fresh — quoting a few lines out of
// a file is the normal case and must not read as drift.
{
  const snippet = "const CALLBACK_PATH = \"/callback\";";
  assert.equal(staleness(snippet, FILE), "fresh");
  assert.equal(snippetStartLine(snippet, FILE), 3);
  assert.equal(stalenessLabel("fresh"), null, "fresh says nothing");
}

// A multi-line contiguous run is fresh and reports the run's first line.
{
  const snippet = "export async function awaitLoopbackGrant(port: number) {\n  const server = await spawnLoopback({ host: \"127.0.0.1\", port });";
  assert.equal(staleness(snippet, FILE), "fresh");
  assert.equal(snippetStartLine(snippet, FILE), 5);
}

// Content that no longer matches is stale — this is the whole point of the
// surface: the snippet was true three turns ago and is not true now.
{
  const snippet = "const CALLBACK_PATH = \"/oauth/callback\";";
  assert.equal(staleness(snippet, FILE), "stale");
  assert.equal(snippetStartLine(snippet, FILE), null);
  assert.equal(stalenessLabel("stale"), "stale");
}

// Non-contiguous lines are stale: the lines exist but not as written together.
{
  const snippet = "const CALLBACK_PATH = \"/callback\";\n}";
  assert.equal(staleness(snippet, FILE), "stale");
}

// A missing file is distinct from a stale one — "gone", not "drifted".
{
  assert.equal(staleness("anything", null), "missing");
  assert.equal(staleness("anything", undefined), "missing");
  assert.equal(stalenessLabel("missing"), "gone");
  assert.equal(snippetStartLine("anything", null), null);
}

// Trailing whitespace and CRLF are not semantic drift.
{
  const snippet = "const CALLBACK_PATH = \"/callback\";   ";
  assert.equal(staleness(snippet, FILE.replace(/\n/g, "\r\n")), "fresh");
}

// Leading whitespace IS semantic — reindented code is a real change.
{
  const snippet = "    const CALLBACK_PATH = \"/callback\";";
  assert.equal(staleness(snippet, FILE), "stale");
}

// Blank padding around an excerpt does not decide freshness.
{
  const snippet = "\n\nconst CALLBACK_PATH = \"/callback\";\n\n";
  assert.equal(staleness(snippet, FILE), "fresh");
}

// An all-blank snippet has nothing to compare.
{
  assert.equal(staleness("\n\n", FILE), "unknown");
}

// A snippet longer than the file cannot match.
{
  assert.equal(staleness(`${FILE}\nextra line`, FILE), "stale");
}

// ── Read outcomes: "gone" vs "I could not look" ─────────────────────────────
// The distinction the whole surface rests on. A permission denial, a 413, or an
// offline daemon must NEVER render as a confident "gone" badge — that is the
// same false certainty the feature exists to remove, just pointing the other
// way. (Raised in review on PR #4197.)
{
  const snippet = "const CALLBACK_PATH = \"/callback\";";
  assert.equal(stalenessForRead(snippet, { kind: "text", content: FILE }), "fresh");
  assert.equal(stalenessForRead("nope", { kind: "text", content: FILE }), "stale");
  assert.equal(stalenessForRead(snippet, { kind: "absent" }), "missing", "a real 404 is 'gone'");
  assert.equal(
    stalenessForRead(snippet, { kind: "unreadable" }),
    "unknown",
    "a failed read claims nothing — not 'gone'",
  );
  // …and an unknown verdict shows no badge at all.
  assert.equal(stalenessLabel(stalenessForRead(snippet, { kind: "unreadable" })), null);
  assert.equal(stalenessLabel(stalenessForRead(snippet, { kind: "absent" })), "gone");
}

// ── Inspector layout ─────────────────────────────────────────────────────────

// A wide viewport honors the pin.
{
  assert.equal(resolveInspectorMode("auto", 1440), "split");
  assert.equal(resolveInspectorMode("split", 1440), "split");
  assert.equal(resolveInspectorMode("overlay", 1440), "overlay");
}

// A viewport too narrow for two readable columns overrides an explicit split
// pin — honoring it would produce two unusable columns instead of one panel.
{
  const narrow = SPLIT_MIN_VIEWPORT - 1;
  assert.equal(resolveInspectorMode("split", narrow), "overlay");
  assert.equal(resolveInspectorMode("auto", narrow), "overlay");
  assert.equal(resolveInspectorMode("split", SPLIT_MIN_VIEWPORT), "split", "the threshold itself splits");
}

// Below the modal cutoff every pin collapses to a modal.
{
  for (const pin of ["auto", "split", "overlay"]) {
    assert.equal(resolveInspectorMode(pin, MODAL_MAX_VIEWPORT), "modal", `${pin} at the cutoff`);
    assert.equal(resolveInspectorMode(pin, 320), "modal", `${pin} on a phone`);
  }
  assert.equal(resolveInspectorMode("overlay", MODAL_MAX_VIEWPORT + 1), "overlay");
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

// File-backed reads snippet → working tree → compare.
{
  const tabs = inspectorTabs("file-backed");
  assert.deepEqual(tabs.map((t) => t.id), ["snippet", "file", "compare"]);
  assert.equal(tabs[1].label, "Working tree");
}

// A patch's vocabulary shifts so the labels never lie.
{
  const tabs = inspectorTabs("generated");
  assert.deepEqual(tabs.map((t) => t.id), ["snippet", "file"]);
  assert.deepEqual(tabs.map((t) => t.label), ["Patch", "Target file"]);
}

// A quoted block has nothing to compare against.
{
  const tabs = inspectorTabs("quoted");
  assert.deepEqual(tabs.map((t) => t.id), ["snippet"]);
}

// A tab the block does not have falls back to its first tab rather than
// rendering an empty panel.
{
  assert.equal(normalizeInspectorTab("compare", "quoted"), "snippet");
  assert.equal(normalizeInspectorTab("compare", "generated"), "snippet");
  assert.equal(normalizeInspectorTab("compare", "file-backed"), "compare");
  assert.equal(normalizeInspectorTab(null, "file-backed"), "snippet");
  assert.equal(normalizeInspectorTab("garbage", "file-backed"), "snippet");
}

// ── Selection ────────────────────────────────────────────────────────────────

// A plain click starts a one-line selection; shift-click extends it.
{
  let sel = extendSelection(null, 14, false);
  assert.deepEqual(sel, { from: 14, to: 14 });
  sel = extendSelection(sel, 19, true);
  assert.deepEqual(sel, { from: 14, to: 19 });
}

// Shift-click extends upward too.
{
  const sel = extendSelection({ from: 14, to: 19 }, 9, true);
  assert.deepEqual(sel, { from: 9, to: 19 });
}

// Shift-click with no existing selection behaves like a plain click.
{
  assert.deepEqual(extendSelection(null, 7, true), { from: 7, to: 7 });
}

// A plain click after a range replaces it rather than extending.
{
  assert.deepEqual(extendSelection({ from: 14, to: 19 }, 3, false), { from: 3, to: 3 });
}

// Membership and labels.
{
  assert.equal(isLineSelected({ from: 14, to: 19 }, 14), true);
  assert.equal(isLineSelected({ from: 14, to: 19 }, 19), true);
  assert.equal(isLineSelected({ from: 14, to: 19 }, 20), false);
  assert.equal(isLineSelected(null, 14), false);
  assert.equal(selectionLabel(null), null);
  assert.equal(selectionLabel({ from: 14, to: 14 }), "line 14");
  assert.equal(selectionLabel({ from: 14, to: 19 }), "lines 14–19");
}

// Selected text slices by 1-based line and clamps past the end.
{
  const snippet = "a\nb\nc\nd";
  assert.equal(selectedText(snippet, { from: 2, to: 3 }), "b\nc");
  assert.equal(selectedText(snippet, { from: 1, to: 1 }), "a");
  assert.equal(selectedText(snippet, { from: 3, to: 99 }), "c\nd", "clamps past the end");
  assert.equal(selectedText(snippet, null), snippet, "no selection means the whole snippet");
  assert.equal(selectedText(snippet, { from: 9, to: 12 }), "", "entirely past the end");
}

// ── Handoff strings ──────────────────────────────────────────────────────────

// The chip label uses a plain hyphen so it round-trips through a shell/grep.
{
  const block = { name: "oauth-loopback.ts", path: "src/lib/oauth-loopback.ts" };
  assert.equal(referenceChipLabel(block, { from: 14, to: 19 }), "oauth-loopback.ts:14-19");
  assert.equal(referenceChipLabel(block, { from: 14, to: 14 }), "oauth-loopback.ts:14");
  assert.equal(referenceChipLabel(block, null), "oauth-loopback.ts");
  assert.ok(!referenceChipLabel(block, { from: 14, to: 19 }).includes("–"), "no en dash in a pasteable ref");
}

// A pathless block still yields a usable chip.
{
  assert.equal(referenceChipLabel({ name: null, path: null }, null), "snippet");
}

// The quote carries the path and range so the lines stay attributable after
// they leave the inspector.
{
  const block = { name: "oauth-loopback.ts", path: "src/lib/oauth-loopback.ts", lang: "ts" };
  const out = quotedSnippet(block, "a\nb\nc", { from: 2, to: 3 });
  assert.ok(out.startsWith("> src/lib/oauth-loopback.ts · lines 2–3\n"), out);
  assert.ok(out.includes("```ts\nb\nc\n```"), out);
}

// A quoted (pathless) block still fences with its language.
{
  const out = quotedSnippet({ name: null, path: null, lang: "" }, "x", null);
  assert.ok(out.includes("```text\nx\n```"), out);
}
