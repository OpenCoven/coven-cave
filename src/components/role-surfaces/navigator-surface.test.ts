import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COURSE_LANES, chartRoomStatus } from "./navigator-charts.ts";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

const surface = read("./navigator-surface.tsx");
const band = read("./chart-room-band.tsx");
const decisions = read("./chart-room-decisions.tsx");
const orchestration = read("./chart-room-orchestration.tsx");
const table = read("./chart-room-table.tsx");
const sheet = read("./chart-room-step-sheet.tsx");
const flow = read("./chart-room-flow.tsx");
const css = read("../../styles/globals/surface-chart-room.css");
const register = read("./register.tsx");
const globals = read("../../app/globals.css");
const docs = read("../../../docs/role-surfaces.md");

// ── Lane vocabulary (behavioral, real module) ────────────────────────────────

test("the room's lanes are the board's own, in board order", () => {
  assert.deepEqual(COURSE_LANES, ["backlog", "inbox", "running", "review", "blocked", "done"]);
});

test("chartRoomStatus escalates blocked over underway over clear", () => {
  assert.deepEqual(chartRoomStatus({ running: 0, blocked: 0 }), { label: "charts clear", tone: "ok" });
  assert.deepEqual(chartRoomStatus({ running: 3, blocked: 0 }), { label: "3 underway", tone: "busy" });
  assert.deepEqual(chartRoomStatus({ running: 3, blocked: 2 }), { label: "2 blocked", tone: "warn" });
});

// ── The room reads and writes the real board ─────────────────────────────────

test("every lens reads one real board", () => {
  assert.match(surface, /fetch\("\/api\/board", \{ cache: "no-store" \}\)/);
  assert.match(
    surface,
    /useLatestAsyncData<Card\[\]>\(\{[\s\S]*?scopeKey: familiarId[\s\S]*?load: fetchBoard[\s\S]*?errorMessage: "Couldn't load the board\."/,
  );
  assert.match(surface, /toChartSteps\(cards \?\? \[\], overlay, today\)/);
});

test("moves, renames, reassignments, answers, adds and removals are real writes", () => {
  assert.match(surface, /`\/api\/board\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(surface, /method: "PATCH"/);
  assert.match(surface, /method: "POST"/);
  assert.match(surface, /method: "DELETE"/);
  assert.match(surface, /\{ status: stage \}/, "a lane move writes the card's status");
  assert.match(surface, /\{ needsHuman: false \}/, "answering clears the flag on the real card");
  assert.match(surface, /publishBoardChanged\(\)/);
});

test("the dependency chart is the room's own overlay, never a board field", () => {
  // The board has no dependency column; writing one client-side would show
  // every other surface a link it cannot honour.
  assert.match(surface, /overlay: ChartOverlay/);
  assert.match(surface, /normalizeOverlay\(state\.overlay, liveIds\)/);
  assert.match(surface, /setDependency\(overlay, stepId, needs\)/);
  assert.doesNotMatch(surface, /body: JSON\.stringify\(\{[^}]*\bdependsOn\b/);
  assert.match(
    surface,
    /Discard this session's links — the board's own cards are untouched/,
    "the reset control says what it does and does not touch",
  );
});

test("a dangling edge is pruned on read, not left to draw at nothing", () => {
  assert.match(surface, /const overlay = useMemo\(\(\) => normalizeOverlay\(/);
  assert.match(surface, /forgetStep\(overlay, id\)/, "deleting a card cuts its edges both ways");
});

// ── No invented data ─────────────────────────────────────────────────────────

test("the decisions ledger frames real cards and never invents tradeoffs", () => {
  assert.match(decisions, /decision\.framing \?/);
  assert.match(decisions, /The card carries no notes/);
  assert.doesNotMatch(decisions, /\bpro\b\s*:/i, "no fabricated upside/downside pairs");
  assert.doesNotMatch(decisions, /Astra recommends/, "the room does not put words in a familiar's mouth");
});

test("the capability lane is label-driven, so an unlabelled card links to nothing", () => {
  assert.match(orchestration, /capabilitiesForStep\(step, capabilities\)/);
  assert.match(orchestration, /Capability edges only exist where a card's own labels name/);
  assert.match(surface, /\/api\/workflows/);
  assert.match(surface, /\/api\/skills/);
});

test("panels with nothing behind them say so", () => {
  assert.match(band, /Nothing to repair\. The room\s*\n?\s*is quiet when the chart is sound\./);
  assert.match(surface, /Nothing charted yet\./);
  assert.match(surface, /Nothing rearranged yet\./);
  assert.match(surface, /Nothing answered this session\./);
  assert.match(decisions, /Nothing owed\. The flow is yours to run\./);
});

// ── Failure, loading and empty stay distinct ─────────────────────────────────

test("board failures stay retryable and distinct from loading and empty data", () => {
  assert.match(surface, /import[\s\S]*?\bSurfaceLoading\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /import[\s\S]*?\bSurfaceError\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(
    surface,
    /if \(boardError && cards == null\) \{\s*\n\s*return <SurfaceError[\s\S]{0,200}?onRetry=\{loadBoard\}/,
  );
  assert.match(surface, /if \(cards == null\) return <SurfaceLoading label="Loading the board…" \/>;/);
  assert.match(
    surface,
    /boardError && cards != null \?[\s\S]{0,300}?Showing the last loaded board/,
    "a failed revalidation keeps the last usable board visible",
  );
});

test("the drawer's own panels degrade separately from the canvas", () => {
  const drawerStart = surface.indexOf('<span className="cr-eyebrow">Recently completed</span>');
  const drawerEnd = surface.indexOf("Chart edits this session", drawerStart);
  assert.ok(drawerStart > 0 && drawerEnd > drawerStart);
  const panel = surface.slice(drawerStart, drawerEnd);
  assert.match(panel, /<SurfaceError[\s\S]*?live=\{false\}/, "the drawer's error is not a second live region");
  assert.match(panel, /<SurfaceLoading[\s\S]*?live=\{false\}/);
  assert.match(panel, /recentlyDone\.length === 0 \?/);
});

// ── Accessibility ────────────────────────────────────────────────────────────

test("mutations announce, and visible failures announce assertively", () => {
  assert.match(surface, /import \{ useAnnouncer \} from "@\/components\/ui\/live-region"/);
  assert.match(surface, /const \{ announce \} = useAnnouncer\(\)/);
  assert.match(surface, /announce\(failure, "assertive"\)/);
  assert.match(surface, /announce\(message, "assertive"\)/);
  assert.match(surface, /const \[writeError, setWriteError\] = useState<string \| null>\(null\)/);
  assert.doesNotMatch(surface, /<p role="alert"/, "the announcer is the live region, not a second one");
});

test("both dialogs trap focus and return it on Escape", () => {
  for (const [name, source] of [
    ["step sheet", sheet],
    ["stats modal", surface],
  ] as const) {
    assert.match(source, /useFocusTrap\(true, dialogRef, \{ onEscape: onClose \}\)/, `${name} traps focus`);
    assert.match(source, /role="dialog"[\s\S]{0,120}?aria-modal="true"/, `${name} is a modal dialog`);
  }
});

test("state is never carried by colour alone", () => {
  // The tag prints the state; the tone only reinforces it.
  const parts = read("./chart-room-parts.tsx");
  assert.match(parts, /<span className="cr-state" data-state=\{state\}>/);
  assert.match(parts, /state === "decision" \? "owed" : state/);
});

test("the segmented lenses and toggles expose their pressed state", () => {
  assert.match(surface, /aria-pressed=\{lens === entry\.id\}/);
  assert.match(surface, /aria-pressed=\{state\.tableMode === value\}/);
  assert.match(orchestration, /aria-pressed=\{lock\?\.kind === "familiar"/);
  assert.match(table, /aria-sort=\{/);
});

test("interactive elements carry the shared focus ring", () => {
  for (const [name, source] of [
    ["surface", surface],
    ["band", band],
    ["flow", flow],
    ["table", table],
    ["sheet", sheet],
  ] as const) {
    assert.match(source, /focus-ring/, `${name} rings its controls`);
  }
});

// ── Design-system contract ───────────────────────────────────────────────────

test("the room's stylesheet is component-imported, never bolted onto the facade", () => {
  // A sheet this size on the root layout blows the bundle budget — caught only
  // by the Sidecar runtime job, never by the app suite.
  assert.match(surface, /import "@\/styles\/globals\/surface-chart-room\.css"/);
  assert.doesNotMatch(globals, /surface-chart-room\.css/);
});

test("colour reaches the stylesheet only through tokens or real project data", () => {
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(declarations, /#[0-9a-fA-F]{3,8}\b/, "no hex literals");
  // oklch() is allowed only inside color-mix's colour space argument.
  const oklchUses = declarations.match(/oklch\([^)]*\)/g) ?? [];
  assert.deepEqual(oklchUses, [], "no raw oklch colours — mix from a token instead");
  assert.match(css, /--cr-dot/, "a project's own colour arrives as a custom property");
});

test("the room inherits the shared accent, glow and drawer rather than restating them", () => {
  assert.match(surface, /accentHue=\{105\}/);
  assert.match(surface, /className="role-surface-room--chart"/);
  assert.match(css, /\.role-surface-room--chart \.role-surface-columns/);
  assert.doesNotMatch(css, /--room-accent:\s*oklch/, "the accent is defined once, in surface-role-workspaces");
});

test("anything that moves has a reduced-motion story", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.cr-flip \{\s*animation: none;/);
  assert.match(reduced, /transition: none/);
});

test("text inputs cannot trigger iOS Safari's focus zoom", () => {
  // Anything under 16px auto-zooms; the compact size is restored only where a
  // fine pointer proves it is not a touch device.
  assert.match(css, /\.cr-filter input \{[\s\S]*?font-size: 16px;/);
  assert.match(css, /\.cr-select select \{[\s\S]*?font-size: 16px;/);
  assert.match(css, /\.cr-sheet__title \{[\s\S]*?font-size: 16px;/);
  assert.match(css, /@media \(pointer: fine\)/);
});

// ── Registration and docs ────────────────────────────────────────────────────

test("registration names the Chart Room with its own accent and drawer chrome", () => {
  assert.match(register, /id: NAVIGATOR_SURFACE_ID/);
  assert.match(register, /role: "navigator"/);
  assert.match(register, /title: "Chart Room"/);
  assert.match(register, /iconName: "ph:compass"/);
  assert.match(register, /accentHue: 105/);
  assert.match(register, /combo: "mod\+shift\+d",\s*\n\s*description: "Toggle the voyage log drawer"/);
  assert.match(register, /chartRoomStatus\(/);
});

test("the Chart Room is documented as an initial room", () => {
  assert.match(docs, /\*\*Chart Room\*\* \(`navigator-chart-room`, role `navigator`\)/);
});
