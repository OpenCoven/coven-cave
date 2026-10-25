import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UI_BLOCK_CATALOG,
  UI_BLOCK_LIMITS,
  UI_TONES,
  buildUiBlock,
  evaluateUiExpression,
  formatUiValue,
  isPartialUiFenceOpener,
  parseUiExpression,
  resolveUiProps,
  sliceUiBlocks,
  stableUiBlockKey,
  uiBlockStateValues,
  uiFenceBody,
  type UiBlockDocument,
  type UiNode,
} from "./ui-blocks.ts";
import {
  DELIVERY_PULSE,
  FAILED_CHILD_TEXT,
  MALFORMED_DASHBOARD,
  MINI_DASHBOARD,
  PRICING_CALCULATOR,
  RELEASE_BRIEF,
  RELEASE_DRAFT,
  STATUS_TABLE,
  UI_BLOCK_FIXTURES,
  uiBlockFence,
} from "./ui-block-fixtures.ts";
import { partitionStreamingMarkdown } from "./streaming-markdown-blocks.ts";

// ── helpers ────────────────────────────────────────────────────────────────

function walk(nodes: UiNode[], visit: (node: UiNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.kind === "component" || node.kind === "error") walk(node.children, visit);
  }
}

function all(doc: UiBlockDocument): UiNode[] {
  const out: UiNode[] = [];
  walk(doc.nodes, (node) => out.push(node));
  return out;
}

function components(doc: UiBlockDocument, type?: string) {
  return all(doc).filter(
    (node): node is Extract<UiNode, { kind: "component" }> =>
      node.kind === "component" && (type === undefined || node.type === type),
  );
}

function errors(doc: UiBlockDocument) {
  return all(doc).filter((node): node is Extract<UiNode, { kind: "error" }> => node.kind === "error");
}

/** Stable identity of every component/error node: what a re-parse must keep. */
function signatures(doc: UiBlockDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of all(doc)) {
    if (node.kind === "component") {
      out.set(node.id, JSON.stringify(["component", node.type, node.props]));
    } else if (node.kind === "error") {
      out.set(node.id, JSON.stringify(["error", node.label, node.issues]));
    }
  }
  return out;
}

function expr(source: string) {
  const parsed = parseUiExpression(source);
  if (!parsed.ok) throw new Error(`expected ${source} to parse: ${parsed.error}`);
  return parsed.expr;
}

function evaluate(source: string, state: Record<string, unknown> = {}) {
  return evaluateUiExpression(expr(source), state as never);
}

function value(source: string, state: Record<string, unknown> = {}) {
  const result = evaluate(source, state);
  if (!result.ok) throw new Error(`expected ${source} to evaluate: ${result.error}`);
  return result.value;
}

function parseError(source: string): string {
  const parsed = parseUiExpression(source);
  assert.equal(parsed.ok, false, `expected ${JSON.stringify(source)} to be rejected`);
  return parsed.ok ? "" : parsed.error;
}

// ── expression evaluator: a whitelist, never JavaScript ────────────────────

test("expressions: arithmetic precedence, comparison, ternary, and logic", () => {
  assert.equal(value("1 + 2 * 3"), 7);
  assert.equal(value("(1 + 2) * 3"), 9);
  assert.equal(value("10 % 4"), 2);
  assert.equal(value("-seats + 10", { seats: 4 }), 6);
  assert.equal(value("seats * 29", { seats: 8 }), 232);
  assert.equal(value('seats > 10 ? "big" : "small"', { seats: 12 }), "big");
  assert.equal(value('seats > 10 ? "big" : "small"', { seats: 2 }), "small");
  assert.equal(value("annual && seats > 5", { annual: true, seats: 6 }), true);
  assert.equal(value("!annual", { annual: true }), false);
  assert.equal(value('range == "This week"', { range: "This week" }), true);
  assert.equal(value('range != "This week"', { range: "This week" }), false);
  assert.equal(value("a ? 1 : b ? 2 : 3", { a: false, b: true }), 2);
  assert.equal(value('"Total: " + seats * 29', { seats: 2 }), "Total: 58");
  assert.equal(value("'single' + \"double\""), "singledouble");
  assert.equal(value("2.5e1"), 25);
});

test("expressions: array and object literals hold only literal keys", () => {
  assert.deepEqual(value('[1, "a", true, null]'), [1, "a", true, null]);
  assert.deepEqual(value('{ label: "Mon", "value": n * 2 }', { n: 3 }), { label: "Mon", value: 6 });
  assert.deepEqual(value("[[1, 2], [3, 4]]"), [[1, 2], [3, 4]]);
});

test("expressions: calls, member access, assignment and functions are rejected at parse time", () => {
  assert.match(parseError("alert(1)"), /call/i);
  assert.match(parseError("window.location"), /propert/i);
  assert.match(parseError("rows[0]"), /index/i);
  assert.match(parseError("seats = 4"), /assign|=/i);
  assert.match(parseError("() => 1"), /./);
  assert.match(parseError("`template`"), /./);
  assert.match(parseError("new Date()"), /./);
  assert.match(parseError("1 +"), /./);
  assert.match(parseError('"unterminated'), /./);
  assert.match(parseError("{ __proto__: 1 }"), /__proto__/);
  assert.match(parseError("{ constructor: 1 }"), /constructor/);
  assert.match(parseError("seats; 1"), /./);
  assert.match(parseError(""), /empty/i);
  assert.match(parseError("(".repeat(80) + "1" + ")".repeat(80)), /deep/i);
});

test("expressions: evaluation never reaches the host or the prototype chain", () => {
  for (const name of ["toString", "constructor", "__proto__", "globalThis", "process", "window", "hasOwnProperty"]) {
    const result = evaluate(name, {});
    assert.equal(result.ok, false, `${name} must not resolve`);
  }
  const result = evaluate("missing + 1", { seats: 1 });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /missing/);
});

test("expressions: type errors and non-finite results are reported, not thrown", () => {
  assert.equal(evaluate("1 / 0").ok, false);
  assert.equal(evaluate('"a" - 1').ok, false);
  assert.equal(evaluate("true + 1").ok, false);
  assert.equal(evaluate("[1] * 2").ok, false);
  assert.equal(evaluate('1 < "2"').ok, false);
  assert.equal(evaluate("-\"x\"").ok, false);
});

// ── fence detection ────────────────────────────────────────────────────────

test("sliceUiBlocks lifts a top-level coven:ui fence and keeps prose on both sides", () => {
  const pieces = sliceUiBlocks("Before\n```coven:ui\n<Badge>Hi</Badge>\n```\nAfter");
  assert.deepEqual(pieces.map((piece) => piece.kind), ["text", "ui", "text"]);
  assert.equal(pieces[0].kind === "text" ? pieces[0].text : "", "Before\n");
  assert.equal(pieces[1].kind === "ui" ? pieces[1].source : "", "<Badge>Hi</Badge>");
  assert.equal(pieces[1].kind === "ui" ? pieces[1].complete : false, true);
  assert.equal(pieces[2].kind === "text" ? pieces[2].text : "", "\nAfter");
});

test("sliceUiBlocks handles tildes, longer fences, CRLF and multiple blocks", () => {
  const tilde = sliceUiBlocks("~~~coven:ui\n<Badge>A</Badge>\n~~~");
  assert.deepEqual(tilde.map((piece) => piece.kind), ["ui"]);
  const long = sliceUiBlocks("````coven:ui\n<Text>```</Text>\n````");
  assert.equal(long[0].kind === "ui" ? long[0].source : "", "<Text>```</Text>");
  const crlf = sliceUiBlocks("```coven:ui\r\n<Badge>A</Badge>\r\n```\r\n");
  assert.equal(crlf[0].kind === "ui" ? crlf[0].source : "", "<Badge>A</Badge>");
  const two = sliceUiBlocks(`${uiBlockFence("<Badge>1</Badge>")}\nmiddle\n${uiBlockFence("<Badge>2</Badge>")}`);
  assert.deepEqual(two.map((piece) => piece.kind), ["ui", "text", "ui"]);
});

test("sliceUiBlocks leaves a coven:ui example inside another fence as literal text", () => {
  for (const text of [
    "````markdown\n```coven:ui\n<Badge>Example</Badge>\n```\n````",
    "~~~\n```coven:ui\n<Badge>Example</Badge>\n```\n~~~",
    "- ```\n  ```coven:ui\n  <Badge>Example</Badge>\n  ```",
    "> ```coven:ui\n> <Badge>Quoted</Badge>\n> ```",
    "    ```coven:ui\n    <Badge>Indented code</Badge>\n    ```",
    "Mention `coven:ui` inline only.",
  ]) {
    assert.deepEqual(sliceUiBlocks(text), [{ kind: "text", text }], text);
  }
});

test("sliceUiBlocks needs the exact info string", () => {
  for (const text of [
    "```coven:uix\n<Badge>A</Badge>\n```",
    "```coven:ui-draft\n<Badge>A</Badge>\n```",
    "```jsx\n<Badge>A</Badge>\n```",
  ]) {
    assert.deepEqual(sliceUiBlocks(text), [{ kind: "text", text }], text);
  }
  assert.equal(sliceUiBlocks("```coven:ui  \n<Badge>A</Badge>\n```")[0].kind, "ui");
});

test("sliceUiBlocks renders an unterminated trailing block from the saved text", () => {
  const pieces = sliceUiBlocks("Intro\n```coven:ui\n<Card title=\"Cut\"><Text>Partial");
  assert.deepEqual(pieces.map((piece) => piece.kind), ["text", "ui"]);
  assert.equal(pieces[1].kind === "ui" ? pieces[1].complete : true, false);
  assert.equal(pieces[1].kind === "ui" ? pieces[1].source : "", '<Card title="Cut"><Text>Partial');
});

test("uiFenceBody reads a streaming markdown block that is a coven:ui fence", () => {
  assert.deepEqual(uiFenceBody("```coven:ui\n<Badge>Hi"), { body: "<Badge>Hi", closed: false });
  assert.deepEqual(uiFenceBody("```coven:ui\n<Badge>Hi</Badge>\n```"), { body: "<Badge>Hi</Badge>", closed: true });
  assert.deepEqual(uiFenceBody("```coven:ui\n<Badge>Hi</Badge>\n```\n"), { body: "<Badge>Hi</Badge>", closed: true });
  assert.deepEqual(uiFenceBody("````coven:ui\n<Badge/>\n````"), { body: "<Badge/>", closed: true });
  // A closing fence that has not fully arrived never flashes as body text.
  assert.deepEqual(uiFenceBody("```coven:ui\n<Badge>Hi</Badge>\n``"), { body: "<Badge>Hi</Badge>", closed: false });
  assert.deepEqual(uiFenceBody("```coven:ui\n"), { body: "", closed: false });
  assert.equal(uiFenceBody("```coven:ui"), null, "opener line not complete yet");
  assert.equal(uiFenceBody("```js\nconst a = 1;\n```"), null);
  assert.equal(uiFenceBody("Paragraph ```coven:ui"), null);
});

test("isPartialUiFenceOpener hides only a half-written coven:ui opener", () => {
  for (const source of ["```c", "```coven", "```coven:", "```coven:u", "```coven:ui", "~~~coven:ui"]) {
    assert.equal(isPartialUiFenceOpener(source), true, source);
  }
  for (const source of ["```", "```js", "```coven:ui\n", "```coven:image", "text"]) {
    assert.equal(isPartialUiFenceOpener(source), false, source);
  }
});

test("stableUiBlockKey survives a growing streaming fence (state keyed across chunks)", () => {
  const turn = `Intro paragraph.\n\n${uiBlockFence(PRICING_CALCULATOR)}\n\nOutro paragraph.`;
  const openerEnd = turn.indexOf("```coven:ui\n") + "```coven:ui\n".length;
  const keys = new Set<string>();
  for (let length = openerEnd; length <= turn.length; length += 1) {
    const partition = partitionStreamingMarkdown(turn.slice(0, length), { turnId: "t1", settled: false });
    const blocks = partition.activeBlock ? [...partition.committedBlocks, partition.activeBlock] : partition.committedBlocks;
    const ui = blocks.filter((block) => block.kind === "markdown" && uiFenceBody(block.source));
    assert.equal(ui.length, 1, `exactly one ui block at length ${length}`);
    keys.add(stableUiBlockKey(ui[0].id));
  }
  assert.deepEqual([...keys], ["t1:18:coven-ui"]);
});

// ── building documents ─────────────────────────────────────────────────────

test("the showcase fixtures build with no errors and no diagnostics", () => {
  for (const [name, body] of Object.entries({ PRICING_CALCULATOR, STATUS_TABLE, MINI_DASHBOARD, RELEASE_BRIEF, DELIVERY_PULSE, RELEASE_DRAFT })) {
    const doc = buildUiBlock(body);
    assert.equal(doc.status, "ok", name);
    assert.deepEqual(errors(doc).map((node) => node.issues), [], name);
    assert.deepEqual(doc.diagnostics, [], name);
  }
});

test("the pricing calculator declares state and composes catalog components", () => {
  const doc = buildUiBlock(PRICING_CALCULATOR);
  assert.deepEqual(doc.states.map((state) => [state.name, state.initial]), [["seats", 8], ["annual", false]]);
  const card = doc.nodes[0];
  assert.equal(card.kind === "component" ? card.type : "", "Card");
  assert.deepEqual(card.kind === "component" ? card.props.title : null, { kind: "static", value: "Seat pricing" });
  assert.equal(components(doc, "Stat").length, 3);
  assert.equal(components(doc, "Slider").length, 1);
  assert.equal(components(doc, "Toggle").length, 1);
  assert.equal(components(doc, "Button").length, 2);
  // Whitespace between tags is formatting, never a text node.
  for (const node of all(doc)) {
    if (node.kind === "text") assert.notEqual(node.text.trim(), "", "no whitespace-only text nodes");
  }
});

test("a malformed block isolates each failure to its own error node", () => {
  const doc = buildUiBlock(MALFORMED_DASHBOARD);
  assert.equal(doc.status, "ok");
  const failed = errors(doc);
  assert.deepEqual(failed.map((node) => node.label), ["Marquee", "Badge", "Text", "Stat", "Stat", "Stat"]);
  assert.match(failed[0].issues.join(" "), /unknown component/i);
  assert.match(failed[1].issues.join(" "), /colour/);
  assert.match(failed[2].issues.join(" "), /style/);
  assert.match(failed[3].issues.join(" "), /call/i);
  assert.match(failed[4].issues.join(" "), /propert/i);
  assert.match(failed[5].issues.join(" "), /missing/);
  // Valid siblings before and after the failures still render.
  const stats = components(doc, "Stat");
  assert.equal(stats.length, 1);
  const texts = components(doc, "Text");
  assert.equal(texts.length, 1);
  assert.equal(texts[0].children[0].kind === "text" ? texts[0].children[0].text : "", "Still rendered after the failures.");
  // An error node keeps its children so the rest of the tree is not lost.
  assert.equal(failed[1].children[0]?.kind === "text" ? failed[1].children[0].text : "", "Unknown prop");
});

test("a failed node keeps its validated children, and markup inside it never becomes raw HTML", () => {
  const doc = buildUiBlock(FAILED_CHILD_TEXT);
  assert.equal(doc.status, "ok");
  const failed = errors(doc);
  assert.deepEqual(failed.map((node) => node.label), ["Text", "Marquee", "script", "img", "Text"]);
  // An inline component keeps its spacing, so its text can still read as one line.
  assert.deepEqual(failed[0].children.map((child) => child.kind), ["text", "expr", "text"]);
  assert.equal(failed[0].children[0].kind === "text" ? failed[0].children[0].text : "", "Score: ");
  // A lower-case tag is an unknown component: its text survives as text and nothing else does.
  assert.deepEqual(failed[2].children.map((child) => child.kind === "text" ? child.text : child.kind), [
    "window.__covenUiInjected = true",
  ]);
  assert.deepEqual(failed[3].children, []);
  // Tag-shaped text in a string literal stays a literal value.
  const literal = failed[4].children[1];
  assert.equal(literal.kind === "expr" ? evaluateUiExpression(literal.expr, {}).ok : false, true);
  for (const node of all(doc)) {
    assert.ok(["text", "expr", "component", "error", "pending"].includes(node.kind), node.kind);
    if (node.kind === "component") assert.ok(node.type in UI_BLOCK_CATALOG, node.type);
  }
  // A dynamic tone builds, then fails only once State resolves it.
  const toned = components(doc, "Text")[0];
  const resolved = resolveUiProps(toned, uiBlockStateValues(doc.states, {}));
  assert.equal(resolved.ok, false);
  assert.match(resolved.ok ? "" : resolved.issues.join(" "), /tone must be one of/);
  assert.equal(components(doc, "Badge").length, 1);
});

// ── layout and text catalog (#6062) ───────────────────────────────────────

function issuesOf(source: string): string {
  return errors(buildUiBlock(source)).map((node) => node.issues.join("; ")).join(" | ");
}

test("the release brief composes Divider, Grid, List, Callout, Bold and Code", () => {
  const doc = buildUiBlock(RELEASE_BRIEF);
  assert.equal(doc.status, "ok");
  assert.deepEqual(errors(doc), []);
  const types = new Set(components(doc).map((node) => node.type));
  for (const type of ["Divider", "Grid", "List", "Callout", "Bold", "Code"]) assert.ok(types.has(type as never), type);
  const [grid] = components(doc, "Grid");
  assert.deepEqual(grid.props.columns, { kind: "static", value: 3 });
  assert.equal(grid.children.filter((child) => child.kind === "component").length, 3);
  const lists = components(doc, "List");
  assert.deepEqual(lists.map((list) => list.props.ordered?.kind === "static" ? list.props.ordered.value : false), [false, true]);
});

test("grid and columns share one closed column, gap and align contract", () => {
  assert.deepEqual(UI_BLOCK_CATALOG.Columns, UI_BLOCK_CATALOG.Grid);
  assert.equal(UI_BLOCK_CATALOG.Grid.children, "blocks");
  for (const columns of ["{1}", "{2}", "{3}", "{4}", '"2"']) {
    assert.equal(issuesOf(`<Grid columns=${columns}><Text>a</Text></Grid>`), "", columns);
    assert.equal(issuesOf(`<Columns columns=${columns}><Text>a</Text></Columns>`), "", columns);
  }
  for (const columns of ["{0}", "{5}", "{1.5}", '"3fr"', "{-1}"]) {
    assert.match(issuesOf(`<Grid columns=${columns}><Text>a</Text></Grid>`), /columns must be one of 1, 2, 3, 4/, columns);
  }
  assert.match(issuesOf('<Grid gap="huge"><Text>a</Text></Grid>'), /gap must be one of/);
  assert.match(issuesOf('<Grid align="baseline"><Text>a</Text></Grid>'), /align must be one of start, center, end, stretch/);
  // Children keep their order and stable ids in both spellings.
  const doc = buildUiBlock('<Columns columns={2}><Stat label="A" value={1} /><Stat label="B" value={2} /></Columns>');
  assert.deepEqual(components(doc, "Stat").map((stat) => stat.id), ["0.0", "0.1"]);
  // A dynamic column count is checked against State when it resolves.
  const dynamic = buildUiBlock('<Stack><State name="n" initial={2} /><Grid columns={n}><Text>a</Text></Grid></Stack>');
  const [grid] = components(dynamic, "Grid");
  assert.equal(resolveUiProps(grid, { n: 2 }).ok, true);
  assert.equal(resolveUiProps(grid, { n: 6 }).ok, false);
});

test("divider accepts only a gap token and no children", () => {
  assert.equal(issuesOf("<Divider />"), "");
  assert.equal(issuesOf('<Divider gap="lg" />'), "");
  assert.match(issuesOf('<Divider orientation="vertical" />'), /Unknown prop "orientation" on <Divider>/);
  assert.match(issuesOf('<Divider gap="wide" />'), /gap must be one of/);
  const withText = buildUiBlock("<Stack><Divider>section</Divider></Stack>");
  assert.equal(components(withText, "Divider").length, 1);
  assert.match(errors(withText)[0]?.issues.join(" ") ?? "", /<Divider> doesn't take children/);
});

test("list validates a bounded list of text or number items", () => {
  const items = (count: number) => JSON.stringify(Array.from({ length: count }, (_, index) => `Item ${index + 1}`));
  assert.equal(UI_BLOCK_LIMITS.maxListItems, 100);
  assert.equal(issuesOf(`<List items={${items(100)}} />`), "");
  assert.equal(issuesOf("<List items={[1, 2.5, \"three\"]} ordered />"), "");
  assert.equal(issuesOf("<List items={[]} />"), "");
  assert.match(issuesOf(`<List items={${items(101)}} />`), /items has more than 100 entries/);
  for (const bad of ['{[["a"]]}', '{[{ label: "a" }]}', "{[true]}", "{[null]}"]) {
    assert.match(issuesOf(`<List items=${bad} />`), /items must list text or numbers/, bad);
  }
  assert.match(issuesOf('<List items="a, b" />'), /items needs a list like \["A", "B"\]/);
  assert.match(issuesOf("<List />"), /<List> needs items/);
  assert.match(issuesOf('<List items={["a"]}>extra</List>'), /<List> doesn't take children/);
  const dynamic = buildUiBlock('<Stack><State name="n" initial={2} /><List items={n > 1 ? ["a", "b"] : "none"} /></Stack>');
  const [list] = components(dynamic, "List");
  assert.equal(resolveUiProps(list, { n: 2 }).ok, true);
  const bad = resolveUiProps(list, { n: 0 });
  assert.match(bad.ok ? "" : bad.issues.join(" "), /items needs a list/);
});

test("callout validates its tone and holds block children", () => {
  assert.equal(UI_BLOCK_CATALOG.Callout.children, "blocks");
  for (const tone of UI_TONES) assert.equal(issuesOf(`<Callout tone="${tone}"><Text>a</Text></Callout>`), "", tone);
  assert.match(issuesOf('<Callout tone="loud"><Text>a</Text></Callout>'), /tone must be one of/);
  const doc = buildUiBlock('<Callout title="Heads up"><Text>One</Text><Badge>Two</Badge></Callout>');
  assert.deepEqual(errors(doc), []);
  assert.equal(components(doc, "Callout")[0].children.length, 2);
  const dynamic = buildUiBlock('<Stack><State name="t" initial="info" /><Callout tone={t}><Text>a</Text></Callout></Stack>');
  const [callout] = components(dynamic, "Callout");
  assert.equal(resolveUiProps(callout, { t: "info" }).ok, true);
  assert.equal(resolveUiProps(callout, { t: "glow" }).ok, false);
});

test("the new entries reject raw style, class names and handlers", () => {
  const bodies: Record<string, string> = {
    Divider: "<Divider ATTR />",
    Grid: "<Grid ATTR><Text>a</Text></Grid>",
    Columns: "<Columns ATTR><Text>a</Text></Columns>",
    List: '<List items={["a"]} ATTR />',
    Callout: "<Callout ATTR><Text>a</Text></Callout>",
    Bold: "<Text><Bold ATTR>a</Bold></Text>",
    Code: "<Text><Code ATTR>a</Code></Text>",
    Sparkline: '<Sparkline label="a" data={[]} ATTR />',
    Donut: '<Donut label="a" data={[]} ATTR />',
    Tabs: '<Stack><State name="v" initial="a" /><Tabs bind="v" label="t" ATTR><Tab value="a" label="A"><Text>x</Text></Tab></Tabs></Stack>',
    Tab: '<Stack><State name="v" initial="a" /><Tabs bind="v" label="t"><Tab value="a" label="A" ATTR><Text>x</Text></Tab></Tabs></Stack>',
    TextInput: '<Stack><State name="s" initial="" /><TextInput bind="s" label="Name" ATTR /></Stack>',
  };
  for (const [type, body] of Object.entries(bodies)) {
    for (const attr of ['style="color: red"', 'className="x"', 'class="x"', "onClick={1}", 'onclick="alert(1)"', 'href="https://example.com"']) {
      const doc = buildUiBlock(body.replace("ATTR", attr));
      const failed = errors(doc).find((node) => node.label === type);
      assert.ok(failed, `${type} ${attr} must fail`);
      assert.equal(all(doc).some((node) => node.kind === "component" && node.type === type), false, `${type} ${attr}`);
    }
  }
});

test("the delivery pulse composes Stat trends, Sparkline, Donut and badge cells", () => {
  const doc = buildUiBlock(DELIVERY_PULSE);
  assert.equal(doc.status, "ok");
  assert.deepEqual(errors(doc), []);
  assert.equal(components(doc, "Sparkline").length, 1);
  assert.equal(components(doc, "Donut").length, 1);
  const stats = components(doc, "Stat");
  assert.deepEqual(stats.map((stat) => stat.props.trend?.kind === "static" ? stat.props.trend.value : null), [12, -0.8, 0]);
});

test("stat trend is a finite number with a format and an explicit tone", () => {
  assert.equal(issuesOf('<Stat label="a" value={1} trend={-3} trendFormat="percent" trendTone="danger" />'), "");
  assert.match(issuesOf('<Stat label="a" value={1} trend="up" />'), /trend needs a number/);
  assert.match(issuesOf('<Stat label="a" value={1} trend={1 / 0} />'), /trend/);
  assert.match(issuesOf('<Stat label="a" value={1} trend={1} trendFormat="arrows" />'), /trendFormat must be one of/);
  assert.match(issuesOf('<Stat label="a" value={1} trend={1} trendTone="good" />'), /trendTone must be one of/);
  // No default assumes that up is good: an unset trend tone is neutral.
  assert.equal(UI_BLOCK_CATALOG.Stat.props.trendTone.default, "neutral");
  const dynamic = buildUiBlock('<Stack><State name="d" initial={2} /><Stat label="a" value={1} trend={d > 1 ? d : "flat"} /></Stack>');
  const [stat] = components(dynamic, "Stat");
  assert.equal(resolveUiProps(stat, { d: 2 }).ok, true);
  assert.equal(resolveUiProps(stat, { d: 0 }).ok, false);
});

test("table cells may be exact badge records and nothing richer", () => {
  assert.equal(issuesOf('<Table columns={["a", "b"]} rows={[["x", { kind: "badge", label: "ok", tone: "success" }], ["y", { kind: "badge", label: "plain" }]]} />'), "");
  for (const cell of [
    '{ kind: "badge", label: "x", href: "https://example.com" }',
    '{ kind: "link", label: "x" }',
    '{ kind: "badge", label: "x", tone: "loud" }',
    '{ kind: "badge", label: 3 }',
    '{ kind: "badge" }',
    '{ label: "x" }',
    '[1, 2]',
  ]) {
    assert.match(issuesOf(`<Table columns={["a"]} rows={[[${cell}]]} />`), /cells must be numbers, text, or \{ kind: "badge", label, tone \}/, cell);
  }
});

test("sparkline validates at most 40 exact finite points with unique labels", () => {
  const points = (count: number) => `[${Array.from({ length: count }, (_, index) => `{ label: "d${index}", value: ${index} }`).join(", ")}]`;
  assert.equal(UI_BLOCK_LIMITS.maxSparklinePoints, 40);
  assert.equal(issuesOf(`<Sparkline label="Trend" data={${points(40)}} />`), "");
  assert.equal(issuesOf('<Sparkline label="Trend" data={[]} />'), "");
  assert.equal(issuesOf('<Sparkline label="Trend" data={[{ label: "a", value: 1 }]} tone="success" height="lg" />'), "");
  assert.match(issuesOf(`<Sparkline label="Trend" data={${points(41)}} />`), /data has more than 40 points/);
  assert.match(issuesOf('<Sparkline label="Trend" data={[{ label: "a", value: 1 }, { label: "a", value: 2 }]} />'), /labels must be unique/);
  assert.match(issuesOf('<Sparkline label="Trend" data={[{ label: "a", value: 1, color: "red" }]} />'), /data entries take only label and value/);
  assert.match(issuesOf('<Sparkline label="Trend" data={[{ label: "a", value: "1" }]} />'), /data entries need a text label and a number value/);
  assert.match(issuesOf('<Sparkline data={[]} />'), /<Sparkline> needs label/);
  assert.match(issuesOf('<Sparkline label="Trend" data={[]} height="huge" />'), /height must be one of sm, md, lg/);
  assert.match(issuesOf('<Sparkline label="Trend" data={[]}>text</Sparkline>'), /<Sparkline> doesn't take children/);
});

test("donut validates at most 12 exact slices with finite non-negative values", () => {
  const slices = (count: number) => `[${Array.from({ length: count }, (_, index) => `{ label: "s${index}", value: 1 }`).join(", ")}]`;
  assert.equal(UI_BLOCK_LIMITS.maxDonutSlices, 12);
  assert.equal(issuesOf(`<Donut label="Load" data={${slices(12)}} />`), "");
  assert.equal(issuesOf('<Donut label="Load" data={[]} />'), "");
  assert.equal(issuesOf('<Donut label="Load" data={[{ label: "a", value: 0 }, { label: "b", value: 0 }]} size="sm" />'), "");
  assert.equal(issuesOf('<Donut label="Load" data={[{ label: "a", value: 2, tone: "warning" }]} />'), "");
  assert.match(issuesOf(`<Donut label="Load" data={${slices(13)}} />`), /data has more than 12 slices/);
  assert.match(issuesOf('<Donut label="Load" data={[{ label: "a", value: -1 }]} />'), /slice values must be zero or more/);
  assert.match(issuesOf('<Donut label="Load" data={[{ label: "a", value: 1, tone: "loud" }]} />'), /slice tone must be one of/);
  assert.match(issuesOf('<Donut label="Load" data={[{ label: "a", value: 1, color: "red" }]} />'), /data entries take only label, value and tone/);
  assert.match(issuesOf('<Donut label="Load" data={[{ label: "a", value: 1 }, { label: "a", value: 1 }]} />'), /labels must be unique/);
  assert.match(issuesOf('<Donut label="Load" data={[]} size="xl" />'), /size must be one of sm, md, lg/);
});

const TABS = (inner: string, initial = "a", extra = "") =>
  `<Stack><State name="v" initial="${initial}" /><Tabs bind="v" label="Sections"${extra}>${inner}</Tabs></Stack>`;

test("the release draft composes Tabs, Tab and TextInput", () => {
  const doc = buildUiBlock(RELEASE_DRAFT);
  assert.deepEqual(errors(doc), []);
  assert.deepEqual(components(doc, "Tab").map((tab) => tab.props.value), [
    { kind: "static", value: "Summary" },
    { kind: "static", value: "Details" },
  ]);
  assert.equal(components(doc, "TextInput").length, 1);
});

test("tabs bind a text State and hold only fixed, unique Tab children", () => {
  assert.equal(issuesOf(TABS('<Tab value="a" label="A"><Text>x</Text></Tab><Tab value="b" label="B"><Badge>y</Badge></Tab>', "a", ' orientation="vertical" size="sm"')), "");
  assert.match(issuesOf(TABS('<Tab value="a" label="A" />', "a", ' orientation="diagonal"')), /orientation must be one of horizontal, vertical/);
  assert.match(issuesOf('<Stack><State name="v" initial={1} /><Tabs bind="v" label="t"><Tab value="a" label="A" /></Tabs></Stack>'), /Tabs needs a text State, but "v" starts as number/);
  assert.match(issuesOf('<Stack><State name="v" initial="a" /><Tabs bind="v"><Tab value="a" label="A" /></Tabs></Stack>'), /<Tabs> needs label/);
  assert.match(issuesOf(TABS('<Text>loose</Text><Tab value="a" label="A" />')), /<Text> can't go inside <Tabs>; it takes <Tab> only/);
  assert.match(issuesOf(TABS('stray words<Tab value="a" label="A" />')), /text can't go inside <Tabs>; it takes <Tab> only/);
  assert.match(issuesOf('<Stack><Tab value="a" label="A"><Text>x</Text></Tab></Stack>'), /<Tab> only works inside <Tabs>/);
  assert.match(issuesOf(TABS("")), /Tabs needs at least one <Tab>/);
  const many = (count: number) => Array.from({ length: count }, (_, index) => `<Tab value="t${index}" label="T${index}" />`).join("");
  assert.equal(UI_BLOCK_LIMITS.maxTabs, 12);
  assert.equal(issuesOf(TABS(many(12), "t0")), "");
  assert.match(issuesOf(TABS(many(13), "t0")), /Tabs holds at most 12 tabs/);
  assert.match(issuesOf(TABS('<Tab value="a" label="A" /><Tab value="a" label="Again" />')), /tab values must be unique \("a" repeats\)/);
  assert.match(issuesOf(TABS('<Tab value="a" label="A" />', "z")), /bind="v" starts as "z", which isn't one of the tab values/);
  assert.match(issuesOf('<Stack><State name="v" initial="a" /><State name="w" initial="a" /><Tabs bind="v" label="t"><Tab value={w} label="A" /></Tabs></Stack>'), /value must be fixed text in quotes/);
  assert.match(issuesOf(TABS('<Tab value="a" />')), /<Tab> needs label/);
});

test("tabs judge their children only once the tag closes while streaming", () => {
  const open = buildUiBlock('<Stack><State name="v" initial="b" /><Tabs bind="v" label="t"><Tab value="a" label="A"><Text>x</Text></Tab>', { streaming: true });
  assert.deepEqual(errors(open), []);
  const closed = buildUiBlock('<Stack><State name="v" initial="b" /><Tabs bind="v" label="t"><Tab value="a" label="A"><Text>x</Text></Tab></Tabs></Stack>', { streaming: true });
  assert.match(errors(closed)[0]?.issues.join(" ") ?? "", /starts as "b"/);
});

test("text input binds a text State with a bounded length and no form authority", () => {
  const input = (attrs: string, initial = "hi") => `<Stack><State name="s" initial="${initial}" /><TextInput bind="s" label="Name"${attrs} /></Stack>`;
  assert.equal(UI_BLOCK_LIMITS.maxTextInputLength, 2048);
  assert.equal(issuesOf(input(' placeholder="Your name" description="Shown on the card" maxLength={40} disabled')), "");
  assert.match(issuesOf('<Stack><State name="s" initial={2} /><TextInput bind="s" label="Name" /></Stack>'), /TextInput needs a text State, but "s" starts as number/);
  assert.match(issuesOf('<Stack><State name="s" initial="" /><TextInput bind="s" /></Stack>'), /<TextInput> needs label/);
  for (const max of ["{0}", "{2049}", "{1.5}"]) {
    assert.match(issuesOf(input(` maxLength=${max}`)), /maxLength must be a whole number from 1 to 2048/, max);
  }
  assert.match(issuesOf('<Stack><State name="n" initial={4} /><State name="s" initial="" /><TextInput bind="s" label="Name" maxLength={n} /></Stack>'), /maxLength must be a fixed number/);
  assert.match(issuesOf(input(" maxLength={3}", "toolong")), /bind="s" starts longer than 3 characters/);
  assert.match(issuesOf(input("", "x".repeat(2049))), /bind="s" starts longer than 2048 characters/);
  for (const attr of ['form="f"', 'name="n"', 'action="/send"', 'type="password"', 'prefill="x"', 'submit="yes"', "onInput={1}", "onChange={1}"]) {
    assert.ok(issuesOf(input(` ${attr}`)), attr);
  }
  assert.match(issuesOf('<Stack><State name="s" initial="" /><TextInput bind="s" label="Name">text</TextInput></Stack>'), /<TextInput> doesn't take children/);
});

test("text admits only a closed inline grammar of Bold and Code", () => {
  const doc = buildUiBlock('<Text>Run <Code>pnpm test</Code> and <Bold>ship <Code>it</Code></Bold>.</Text>');
  assert.deepEqual(errors(doc), []);
  const [text] = components(doc, "Text");
  assert.deepEqual(text.children.map((child) => child.kind === "component" ? child.type : child.kind), [
    "text", "Code", "text", "Bold", "text",
  ]);
  assert.equal(text.children[0].kind === "text" ? text.children[0].text : "", "Run ");
  assert.deepEqual(UI_BLOCK_CATALOG.Bold.props, {});
  assert.deepEqual(UI_BLOCK_CATALOG.Code.props, {});

  assert.match(issuesOf("<Bold>loud</Bold>"), /<Bold> only works inside <Text>/);
  assert.match(issuesOf("<Stack><Code>x</Code></Stack>"), /<Code> only works inside <Text>/);
  assert.match(issuesOf("<Heading>A <Bold>b</Bold></Heading>"), /<Bold> can't go inside <Heading>/);
  assert.match(issuesOf("<Text><Bold>a <Bold>b</Bold></Bold></Text>"), /<Bold> can't go inside <Bold>/);
  assert.match(issuesOf("<Text><Code>a <Bold>b</Bold></Code></Text>"), /<Bold> can't go inside <Code>/);
  assert.match(issuesOf("<Text>A <Badge>b</Badge></Text>"), /<Badge> can't go inside <Text>; it takes text, <Bold> and <Code>/);
  const lower = buildUiBlock("<Text><b>x</b> <strong>y</strong> <code>z</code></Text>");
  assert.deepEqual(errors(lower).map((node) => node.label), ["b", "strong", "code"]);
  // A failed inline node keeps its text (#6067), and tag-shaped strings stay text.
  const stray = buildUiBlock("<Bold>still readable</Bold>");
  assert.equal(stray.nodes[0].kind === "error" && stray.nodes[0].children[0]?.kind === "text" ? stray.nodes[0].children[0].text : "", "still readable");
  const literal = buildUiBlock('<Text>{"<b>not bold</b>"}</Text>');
  assert.deepEqual(errors(literal), []);
  assert.equal(components(literal, "Bold").length, 0);
});

test("a half-written inline tag inside Text shows no placeholder while streaming", () => {
  for (const source of ["<Text>Run <Code ", "<Text>Run <Bold ", '<Text>Hi <Badge tone="succ']) {
    const doc = buildUiBlock(source, { streaming: true });
    const [text] = components(doc, "Text");
    assert.deepEqual(text.children.map((child) => child.kind), ["text"], source);
  }
  // Block-level placeholders are unchanged.
  const card = buildUiBlock('<Card title="x">\n  <Table columns={["a"]} rows={[', { streaming: true });
  assert.equal(components(card, "Card")[0].children.at(-1)?.kind, "pending");
});

test("event handlers, raw markup and unknown lower-case tags are rejected per node", () => {
  const doc = buildUiBlock('<Stack><Button onClick={1}>Go</Button><script>alert(1)</script><div class="x">Hi</div><Badge>Kept</Badge></Stack>');
  const failed = errors(doc);
  assert.deepEqual(failed.map((node) => node.label), ["Button", "script", "div"]);
  assert.match(failed[0].issues.join(" "), /handler/i);
  assert.equal(components(doc, "Badge").length, 1);
});

test("state is declare-before-use, unique, and literal", () => {
  const forward = buildUiBlock('<Stack><Stat label="Early" value={later} /><State name="later" initial={1} /></Stack>');
  assert.match(errors(forward)[0]?.issues.join(" ") ?? "", /later/);
  const dupe = buildUiBlock('<Stack><State name="a" initial={1} /><State name="a" initial={2} /></Stack>');
  assert.match(errors(dupe)[0]?.issues.join(" ") ?? "", /already declared/i);
  assert.deepEqual(dupe.states.map((state) => state.initial), [1]);
  const computed = buildUiBlock('<Stack><State name="a" initial={1} /><State name="b" initial={a + 1} /></Stack>');
  assert.match(errors(computed)[0]?.issues.join(" ") ?? "", /initial/i);
  const list = buildUiBlock('<Stack><State name="a" initial={[1]} /></Stack>');
  assert.match(errors(list)[0]?.issues.join(" ") ?? "", /initial/i);
  const badName = buildUiBlock('<Stack><State name="two words" initial={1} /></Stack>');
  assert.match(errors(badName)[0]?.issues.join(" ") ?? "", /name/i);
  const bind = buildUiBlock('<Stack><Slider bind="nope" /></Stack>');
  assert.match(errors(bind)[0]?.issues.join(" ") ?? "", /nope/);
});

test("buttons need exactly one action: set state or prefill the composer", () => {
  const none = buildUiBlock("<Button>Do nothing</Button>");
  assert.match(errors(none)[0]?.issues.join(" ") ?? "", /set.*prefill|prefill.*set/i);
  const both = buildUiBlock('<Stack><State name="n" initial={1} /><Button set="n" to={2} prefill="x">Both</Button></Stack>');
  assert.match(errors(both)[0]?.issues.join(" ") ?? "", /one action/i);
  const setOnly = buildUiBlock('<Stack><State name="n" initial={1} /><Button set="n">Missing to</Button></Stack>');
  assert.match(errors(setOnly)[0]?.issues.join(" ") ?? "", /\bto\b/);
  const ok = buildUiBlock('<Stack><State name="n" initial={1} /><Button set="n" to={n + 1}>More</Button><Button prefill={"n is " + n}>Ask</Button></Stack>');
  assert.deepEqual(errors(ok), []);
  // A label is judged once the tag closes: an open Button mid-stream is not an error yet.
  const open = buildUiBlock('<Stack><State name="n" initial={1} /><Button set="n" to={2}>', { streaming: true });
  assert.deepEqual(errors(open), []);
  const empty = buildUiBlock('<Stack><State name="n" initial={1} /><Button set="n" to={2}></Button></Stack>', { streaming: true });
  assert.match(errors(empty)[0]?.issues.join(" ") ?? "", /label/);
  // There is no send, href, fetch or submit action in the catalog.
  const button = UI_BLOCK_CATALOG.Button;
  for (const forbidden of ["send", "href", "url", "fetch", "submit", "action", "onClick"]) {
    assert.equal(forbidden in button.props, false, forbidden);
  }
});

test("children the parent cannot hold become error nodes in place", () => {
  const heading = buildUiBlock("<Heading>Title <Badge>x</Badge></Heading>");
  const h = components(heading, "Heading")[0];
  assert.ok(h, "heading still renders");
  assert.equal(h.children[0].kind === "text" ? h.children[0].text : "", "Title ");
  assert.equal(h.children[1].kind, "error");
  assert.match(h.children[1].kind === "error" ? h.children[1].issues.join(" ") : "", /Heading/);
  const leaf = buildUiBlock('<Stat label="a" value={1}>oops</Stat>');
  assert.equal(components(leaf, "Stat").length, 1);
  assert.equal(errors(leaf).length, 1);
});

test("comments, expression children and text collapse like JSX", () => {
  const doc = buildUiBlock('<Stack>{/* a note */}<State name="n" initial={2} />\n  <Text>\n    Count:\n    {n * 2} items\n  </Text></Stack>');
  const text = components(doc, "Text")[0];
  assert.deepEqual(text.children.map((child) => child.kind), ["text", "expr", "text"]);
  assert.equal(text.children[0].kind === "text" ? text.children[0].text : "", "Count: ");
  assert.equal(text.children[2].kind === "text" ? text.children[2].text : "", " items");
  assert.equal(all(doc).some((node) => node.kind === "expr" && node.source.includes("note")), false);
});

test("mismatched and stray closing tags recover with a diagnostic", () => {
  const mismatched = buildUiBlock("<Card><Row><Badge>a</Badge></Card><Badge>after</Badge>");
  assert.equal(components(mismatched, "Card")[0]?.children[0]?.kind, "component");
  assert.equal(mismatched.nodes.length, 2, "the Card closed and the next Badge is a root sibling");
  assert.match(mismatched.diagnostics.join(" "), /Row/);
  const stray = buildUiBlock("<Badge>a</Badge></Row>");
  assert.equal(components(stray, "Badge").length, 1);
  assert.match(stray.diagnostics.join(" "), /Row/);
});

test("a settled block that ends early renders what it has and says so", () => {
  const settled = buildUiBlock('<Card title="Cut"><Text>Partial');
  assert.equal(settled.status, "ok");
  assert.equal(components(settled, "Text").length, 1);
  assert.match(settled.diagnostics.join(" "), /ended early|not closed/i);
  const streaming = buildUiBlock('<Card title="Cut"><Text>Partial', { streaming: true });
  assert.deepEqual(streaming.diagnostics, [], "streaming never reports truncation");
});

test("content that is not markup falls back to its source", () => {
  assert.equal(buildUiBlock('{"type": "card", "title": "JSON"}').status, "fallback");
  assert.equal(buildUiBlock("Just prose with no tags.").status, "fallback");
  assert.equal(buildUiBlock("Just pro", { streaming: true }).status, "fallback");
  assert.equal(buildUiBlock("").status, "empty");
  assert.equal(buildUiBlock("   \n  ", { streaming: true }).status, "empty");
  assert.equal(buildUiBlock("<Ca", { streaming: true }).status, "empty");
  assert.equal(buildUiBlock("<Ca").status, "fallback");
});

test("limits cap size, node count and depth without throwing", () => {
  const huge = buildUiBlock(`<Text>${"x".repeat(UI_BLOCK_LIMITS.maxSourceLength)}</Text>`);
  assert.equal(huge.status, "fallback");
  assert.match(huge.diagnostics.join(" "), /too large/i);
  const many = buildUiBlock(`<Stack>${"<Badge>x</Badge>".repeat(UI_BLOCK_LIMITS.maxNodes + 5)}</Stack>`);
  assert.ok(components(many, "Badge").length <= UI_BLOCK_LIMITS.maxNodes);
  assert.match(many.diagnostics.join(" "), /too many/i);
  const deep = buildUiBlock("<Stack>".repeat(UI_BLOCK_LIMITS.maxDepth + 4) + "<Badge>x</Badge>");
  assert.match(deep.diagnostics.join(" ") + errors(deep).map((node) => node.issues.join(" ")).join(" "), /deep/i);
});

test("a trailing partial tag of a known component becomes a pending placeholder while streaming", () => {
  const doc = buildUiBlock('<Card title="x">\n  <Table columns={["a"]} rows={[', { streaming: true });
  const card = components(doc, "Card")[0];
  const last = card.children.at(-1);
  assert.equal(last?.kind, "pending");
  assert.equal(last?.kind === "pending" ? last.type : "", "Table");
  const unknown = buildUiBlock('<Card title="x"><Wid', { streaming: true });
  assert.deepEqual(components(unknown, "Card")[0].children, []);
});

// ── every-prefix streaming ─────────────────────────────────────────────────

const BROKEN_FIXTURES = new Set(["malformed-dashboard", "failed-child-text"]);

for (const [name, body] of Object.entries(UI_BLOCK_FIXTURES)) {
  test(`every streaming prefix of ${name} parses, never throws, and grows monotonically`, () => {
    const settled = buildUiBlock(body);
    let previous = new Map<string, string>();
    let previousStates: string[] = [];
    for (let length = 0; length <= body.length; length += 1) {
      const prefix = body.slice(0, length);
      const doc = buildUiBlock(prefix, { streaming: true });
      assert.notEqual(doc.status, "fallback", `${name}@${length}: a markup prefix never flashes source`);
      assert.deepEqual(doc.diagnostics, [], `${name}@${length}: no truncation chips while streaming`);
      const current = signatures(doc);
      for (const [id, signature] of previous) {
        assert.equal(current.get(id), signature, `${name}@${length}: node ${id} changed or vanished`);
      }
      const states = doc.states.map((state) => `${state.name}=${JSON.stringify(state.initial)}`);
      assert.deepEqual(states.slice(0, previousStates.length), previousStates, `${name}@${length}: state changed`);
      if (!BROKEN_FIXTURES.has(name)) {
        assert.deepEqual(errors(doc).map((node) => node.issues), [], `${name}@${length}: no error flash`);
      }
      previous = current;
      previousStates = states;
    }
    // The final streaming tree is the settled tree.
    assert.deepEqual(signatures(buildUiBlock(body, { streaming: true })), signatures(settled));
  });

  test(`every prefix of the fenced ${name} survives the fence reader`, () => {
    const fenced = uiBlockFence(body);
    for (let length = 0; length <= fenced.length; length += 1) {
      const prefix = fenced.slice(0, length);
      const fence = uiFenceBody(prefix);
      if (!fence) {
        assert.ok(length < "```coven:ui\n".length, `${name}@${length}: fence must be recognised once open`);
        continue;
      }
      assert.ok(body.startsWith(fence.body.trimEnd()) || fence.body === body, `${name}@${length}: body is a prefix`);
      assert.doesNotThrow(() => buildUiBlock(fence.body, { streaming: !fence.closed }));
    }
  });
}

// ── runtime props and state ────────────────────────────────────────────────

test("resolveUiProps applies defaults and checks evaluated values against the catalog", () => {
  const doc = buildUiBlock(MINI_DASHBOARD);
  const failedBuild = components(doc, "Stat")[2];
  const resolved = resolveUiProps(failedBuild, { range: "This week" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok ? resolved.props.tone : "", "danger");
  assert.equal(resolved.ok ? resolved.props.value : 0, 2);
  const slider = components(buildUiBlock(PRICING_CALCULATOR), "Slider")[0];
  const sliderProps = resolveUiProps(slider, { seats: 8, annual: false });
  assert.deepEqual(sliderProps.ok ? [sliderProps.props.min, sliderProps.props.max, sliderProps.props.step] : [], [1, 50, 1]);

  const dynamic = buildUiBlock('<Stack><State name="n" initial={2} /><Badge tone={n > 1 ? "loud" : "success"}>x</Badge></Stack>');
  const badge = components(dynamic, "Badge")[0];
  const bad = resolveUiProps(badge, { n: 2 });
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.issues.join(" "), /tone/);
  assert.equal(resolveUiProps(badge, { n: 0 }).ok, true);
});

test("uiBlockStateValues keeps user changes across re-parses, keyed by state name", () => {
  const early = buildUiBlock(PRICING_CALCULATOR.slice(0, PRICING_CALCULATOR.indexOf('<State name="annual"')), { streaming: true });
  assert.deepEqual(uiBlockStateValues(early.states, {}), { seats: 8 });
  const overrides = { seats: 20 };
  const later = buildUiBlock(PRICING_CALCULATOR, { streaming: true });
  assert.deepEqual(uiBlockStateValues(later.states, overrides), { seats: 20, annual: false });
  // An override for a state the block no longer declares is ignored.
  assert.deepEqual(uiBlockStateValues(later.states, { gone: 1 }), { seats: 8, annual: false });
});

test("formatUiValue formats numbers by token", () => {
  assert.equal(formatUiValue(1234.5, "usd", "en-US"), "$1,234.50");
  assert.equal(formatUiValue(232, "usd", "en-US"), "$232.00");
  assert.equal(formatUiValue(68, "percent", "en-US"), "68%");
  assert.equal(formatUiValue(12500, "compact", "en-US"), "12.5K");
  assert.equal(formatUiValue(3.4, "number", "en-US"), "3.4");
  assert.equal(formatUiValue(1 / 3, "number", "en-US"), "0.33");
  assert.equal(formatUiValue("text", "usd", "en-US"), "text");
  assert.equal(formatUiValue(true, undefined, "en-US"), "true");
  assert.equal(formatUiValue(null, undefined, "en-US"), "");
});
