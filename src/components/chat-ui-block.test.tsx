// @ts-nocheck — react-test-renderer ships no types; matches the repository convention.
//
// Behavioral test for the native UI tier renderer: local State drives
// computed values, State survives streamed re-parses (including the real
// StreamingMarkdownBlocks seam), a Button only sets State or prefills the
// composer, and every failure stays an inline chip beside rendered siblings,
// followed by the failed node's validated text in reading order (#6067).
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { partitionStreamingMarkdown } from "@/lib/streaming-markdown-blocks";
import {
  DELIVERY_PULSE,
  FAILED_CHILD_TEXT,
  MALFORMED_DASHBOARD,
  MINI_DASHBOARD,
  PRICING_CALCULATOR,
  RELEASE_BRIEF,
  RELEASE_DRAFT,
  uiBlockFence,
} from "@/lib/ui-block-fixtures";
import { ChatUiBlock, UiBlockHostContext, UiBlockStateScope, splitSegmentsForUiBlocks } from "./chat-ui-block";
import { StreamingMarkdownBlocks } from "./streaming-markdown-blocks";

vi.mock("./message-bubble", () => ({
  ProgressiveMarkdownBlock: ({ text }: { text: string }) => <pre data-markdown="">{text}</pre>,
}));

vi.mock("@/components/ui/charts/bar-chart", () => ({
  BarChart: ({ data }: { data: Array<{ label: string; value: number }> }) => {
    if (data.some((datum) => datum.label === "boom")) throw new Error("chart exploded");
    return <svg data-bar-count={data.length} />;
  },
}));

// A ghost Button throws, so a component with text children can fail while
// rendering; every other Button is the real one.
vi.mock("@/components/ui/button", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/button")>();
  return {
    ...actual,
    Button: (props) => {
      if (props.variant === "ghost") throw new Error("button exploded");
      return <actual.Button {...props} />;
    },
  };
});

// ParentSize measures zero width under jsdom, so the donut's props stand in
// for its pixels; the browser spec covers the real chart.
vi.mock("@/components/ui/charts/donut-chart", () => ({
  DonutChart: ({ data, size, ariaLabel }: { data: Array<{ label: string; value: number; color: string }>; size: number; ariaLabel?: string }) => (
    <svg data-donut-size={size} role="img" aria-label={ariaLabel}>
      {data.map((datum) => <path key={datum.label} data-label={datum.label} fill={datum.color} />)}
    </svg>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  StandardSelect: ({ label, value, options, onChange }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = { prefill: null };

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map((child) => textOf(child as ReactTestInstance | string)).join("");
}

function render(element: JSX.Element): ReactTestRenderer {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(element);
  });
  return renderer!;
}

function stats(renderer: ReactTestRenderer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const stat of renderer.root.findAll((node) => node.props.className === "chat-ui-stat")) {
    const [label, value] = stat.children as ReactTestInstance[];
    out[textOf(label)] = textOf(value);
  }
  return out;
}

function slider(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.find((node) => node.type === "input" && node.props.type === "range");
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.find((node) => node.type === "button" && textOf(node).includes(label));
}

function errorChips(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((node) => typeof node.type === "string" && node.props["data-ui-block-error"] !== undefined);
}

type HostNode = { type: string; props: Record<string, unknown>; children: Array<HostNode | string> | null };

function hostText(node: HostNode | string | undefined): string {
  if (node === undefined) return "";
  if (typeof node === "string") return node;
  return (node.children ?? []).map(hostText).join("");
}

/** Each failure chip, in document order, with the host node right after it. */
function chipsInOrder(renderer: ReactTestRenderer): Array<{ label: string; role: unknown; text: string; next: HostNode | string | undefined }> {
  const out = [];
  const visit = (node: HostNode | string) => {
    if (typeof node === "string") return;
    const children = node.children ?? [];
    children.forEach((child, index) => {
      if (typeof child !== "string" && child.props["data-ui-block-error"] !== undefined) {
        out.push({ label: String(child.props["data-ui-block-error"]), role: child.props.role, text: hostText(child), next: children[index + 1] });
      }
      visit(child);
    });
  };
  visit(renderer.toJSON() as HostNode);
  return out;
}

function expectParagraph(node: HostNode | string | undefined, text: string) {
  expect(typeof node === "string" ? node : { type: node?.type, className: node?.props.className }).toEqual({ type: "p", className: "chat-ui-text" });
  expect(hostText(node)).toBe(text);
}

describe("ChatUiBlock", () => {
  it("renders the pricing calculator natively and recomputes from local State", () => {
    const renderer = render(<ChatUiBlock source={PRICING_CALCULATOR} />);
    const group = renderer.root.find((node) => node.props.role === "group");
    expect(group.props["aria-label"]).toBe("Seat pricing");
    expect(stats(renderer)).toEqual({ Monthly: "$232.00", "Per seat": "$29.00", Yearly: "$2,784.00" });
    expect(errorChips(renderer)).toHaveLength(0);

    act(() => slider(renderer).props.onChange({ currentTarget: { value: "20" } }));
    expect(stats(renderer).Monthly).toBe("$580.00");
    expect(slider(renderer).props["aria-valuetext"]).toBe("20");

    const toggle = renderer.root.find((node) => node.props.role === "switch");
    expect(toggle.props["aria-checked"]).toBe(false);
    act(() => toggle.props.onClick());
    expect(renderer.root.find((node) => node.props.role === "switch").props["aria-checked"]).toBe(true);
    expect(stats(renderer).Monthly).toBe("$483.33");

    act(() => button(renderer, "Reset").props.onClick());
    expect(stats(renderer).Monthly).toBe("$193.33");
  });

  it("keeps State across streamed re-parses of the same mounted block", () => {
    const cut = PRICING_CALCULATOR.indexOf("<Toggle");
    const renderer = render(<ChatUiBlock source={PRICING_CALCULATOR.slice(0, cut)} streaming />);
    expect(renderer.root.find((node) => node.props.role === "group").props["aria-busy"]).toBe(true);
    act(() => slider(renderer).props.onChange({ currentTarget: { value: "12" } }));
    act(() => renderer.update(<ChatUiBlock source={PRICING_CALCULATOR.slice(0, cut + 200)} streaming />));
    act(() => renderer.update(<ChatUiBlock source={PRICING_CALCULATOR} />));
    expect(slider(renderer).props.value).toBe(12);
    expect(stats(renderer).Monthly).toBe("$348.00");
  });

  it("stays mounted inside StreamingMarkdownBlocks as the fence grows and closes", () => {
    const turn = `Here is a calculator.\n\n${uiBlockFence(PRICING_CALCULATOR)}\n\nTell me what you think.`;
    const at = (length: number, live = true) => {
      const partition = partitionStreamingMarkdown(turn.slice(0, length), { turnId: "turn-1", settled: !live });
      return (
        <UiBlockHostContext.Provider value={HOST}>
          <StreamingMarkdownBlocks {...partition} live={live} />
        </UiBlockHostContext.Provider>
      );
    };
    const firstStat = turn.indexOf("<Stat label");
    const renderer = render(at(firstStat));
    expect(renderer.root.findAll((node) => node.props["data-ui-block"] === "streaming")).toHaveLength(1);
    act(() => slider(renderer).props.onChange({ currentTarget: { value: "30" } }));
    act(() => renderer.update(at(turn.indexOf("</Card>"))));
    expect(slider(renderer).props.value).toBe(30);
    act(() => renderer.update(at(turn.length, false)));
    expect(renderer.root.findAll((node) => node.props["data-ui-block"] === "settled")).toHaveLength(1);
    expect(slider(renderer).props.value).toBe(30);
    expect(stats(renderer).Monthly).toBe("$870.00");
    // The raw fence never shows as text.
    expect(textOf(renderer.root)).not.toContain("```coven:ui");
  });

  it("retains independent block state when settlement replaces the streaming subtree", () => {
    const source = `${uiBlockFence(PRICING_CALCULATOR)}\n\n${uiBlockFence(PRICING_CALCULATOR)}`;
    const at = (settled: boolean, turnId = "turn-1") => (
      <UiBlockHostContext.Provider value={HOST}>
        <UiBlockStateScope key={turnId}>
          {settled ? <section>
            {splitSegmentsForUiBlocks([{ kind: "text", text: source }]).map((segment) =>
              segment.kind === "block" ? <div key={segment.key}>{segment.node}</div> : segment.text)}
          </section> : <StreamingMarkdownBlocks
            {...partitionStreamingMarkdown(source, { turnId, settled: false })} live
          />}
        </UiBlockStateScope>
      </UiBlockHostContext.Provider>
    );
    const ranges = (renderer) => renderer.root.findAll((node) => node.type === "input" && node.props.type === "range");
    const renderer = render(at(false));
    act(() => ranges(renderer)[0].props.onChange({ currentTarget: { value: "12" } }));
    act(() => ranges(renderer)[1].props.onChange({ currentTarget: { value: "30" } }));
    act(() => renderer.update(at(true)));
    expect(ranges(renderer).map((range) => range.props.value)).toEqual([12, 30]);
    act(() => renderer.update(at(true, "turn-2")));
    expect(ranges(renderer).map((range) => range.props.value)).toEqual([8, 8]);
  });

  it("isolates text spans and releases state when their scope unmounts", () => {
    const span = (key: string, settled: boolean) => <UiBlockStateScope key={key}>
      {settled ? <section><ChatUiBlock source={PRICING_CALCULATOR} /></section>
        : <ChatUiBlock source={PRICING_CALCULATOR} streaming />}
    </UiBlockStateScope>;
    const at = (settled: boolean, second = true) => <>{span("first", settled)}{second ? span("second", settled) : null}</>;
    const ranges = (renderer) => renderer.root.findAll((node) => node.type === "input" && node.props.type === "range");
    const renderer = render(at(false));
    act(() => ranges(renderer)[1].props.onChange({ currentTarget: { value: "40" } }));
    act(() => renderer.update(at(true)));
    expect(ranges(renderer).map((range) => range.props.value)).toEqual([8, 40]);
    act(() => renderer.update(at(true, false)));
    act(() => renderer.update(at(true)));
    expect(ranges(renderer).map((range) => range.props.value)).toEqual([8, 8]);
  });

  it("keeps an example indented under a list item literal while it streams (#6060)", () => {
    const turn = "- Use this:\n\n  ```coven:ui\n  <Badge>Example</Badge>\n  ```\n\nDone.";
    for (const length of [turn.indexOf("<Badge"), turn.indexOf("</Badge>"), turn.length]) {
      const partition = partitionStreamingMarkdown(turn.slice(0, length), { turnId: "t", settled: false });
      const renderer = render(
        <UiBlockHostContext.Provider value={HOST}>
          <StreamingMarkdownBlocks {...partition} live />
        </UiBlockHostContext.Provider>,
      );
      expect(renderer.root.findAll((node) => node.props["data-ui-block"] !== undefined)).toHaveLength(0);
      expect(textOf(renderer.root)).toContain("```coven:ui");
    }
  });

  it("hides a half-written fence opener instead of flashing it", () => {
    const partition = partitionStreamingMarkdown("Intro.\n\n```coven:u", { turnId: "t", settled: false });
    const renderer = render(
      <UiBlockHostContext.Provider value={HOST}>
        <StreamingMarkdownBlocks {...partition} live />
      </UiBlockHostContext.Provider>,
    );
    expect(textOf(renderer.root)).not.toContain("```coven");
  });

  it("leaves streamed fences as ordinary blocks on surfaces without a UI host (Quick Chat)", () => {
    const turn = `Intro.\n\n${uiBlockFence('<Badge tone="success">Hi</Badge>')}`;
    const partition = partitionStreamingMarkdown(turn, { turnId: "q", settled: true });
    const renderer = render(<StreamingMarkdownBlocks {...partition} live={false} />);
    expect(renderer.root.findAll((node) => node.props["data-ui-block"] !== undefined)).toHaveLength(0);
    expect(textOf(renderer.root)).toContain("```coven:ui");
  });

  it("prefills the composer and never sends", () => {
    const prefill = vi.fn();
    const announce = vi.fn();
    const renderer = render(
      <UiBlockHostContext.Provider value={{ prefill, announce }}>
        <ChatUiBlock source={PRICING_CALCULATOR} />
      </UiBlockHostContext.Provider>,
    );
    act(() => slider(renderer).props.onChange({ currentTarget: { value: "10" } }));
    const draft = button(renderer, "Draft upgrade request");
    expect(draft.props["data-ui-block-action"]).toBe("prefill");
    act(() => draft.props.onClick());
    expect(prefill).toHaveBeenCalledWith("Upgrade our workspace to 10 seats, billed monthly.");

    act(() => button(renderer, "Reset").props.onClick());
    expect(announce).toHaveBeenCalledWith("seats: 8.");

    const orphan = render(<ChatUiBlock source={PRICING_CALCULATOR} />);
    expect(button(orphan, "Draft upgrade request").props.disabled).toBe(true);
  });

  it("drives a Select-bound dashboard", () => {
    const renderer = render(<ChatUiBlock source={MINI_DASHBOARD} />);
    expect(stats(renderer)["Merged PRs"]).toBe("23");
    const select = renderer.root.find((node) => node.type === "select");
    act(() => select.props.onChange({ target: { value: "Last week" } }));
    expect(stats(renderer)["Merged PRs"]).toBe("17");
    const progress = renderer.root.find((node) => node.type === "progress");
    expect(progress.props.value).toBe(100);
  });

  it("isolates each malformed node to its own error chip", () => {
    const renderer = render(<ChatUiBlock source={MALFORMED_DASHBOARD} />);
    expect(errorChips(renderer).map((chip) => chip.props["data-ui-block-error"])).toEqual([
      "Marquee", "Badge", "Text", "Stat", "Stat", "Stat",
    ]);
    expect(stats(renderer)).toEqual({ "Valid stat": "6" });
    expect(textOf(renderer.root)).toContain("Still rendered after the failures.");
    expect(textOf(renderer.root)).not.toContain("alert");
  });

  it("contains a component that throws while rendering", () => {
    const source = '<Stack><BarChart label="Broken" data={[{ label: "boom", value: 1 }]} /><Badge>Sibling</Badge></Stack>';
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const renderer = render(<ChatUiBlock source={source} />);
    error.mockRestore();
    expect(errorChips(renderer).map((chip) => chip.props["data-ui-block-error"])).toEqual(["BarChart"]);
    expect(textOf(renderer.root)).toContain("Sibling");
  });

  it("keeps a build error's text readable beneath its chip, as one line", () => {
    const source = '<Stack><State name="score" initial={3} /><Text colour="red">Score: {score} of 5 checks pass</Text><Badge>Sibling</Badge></Stack>';
    const renderer = render(<ChatUiBlock source={source} />);
    const chips = chipsInOrder(renderer);
    expect(chips.map((chip) => [chip.label, chip.role])).toEqual([["Text", "note"]]);
    expectParagraph(chips[0].next, "Score: 3 of 5 checks pass");
    expect(textOf(renderer.root)).toBe(`Couldn't render <Text>: Unknown prop "colour" on <Text>Score: 3 of 5 checks passSibling`);
  });

  it("keeps a dynamic prop failure's text readable beneath its chip, as one line", () => {
    const source = '<Stack><State name="mood" initial="glow" /><Text tone={mood}>Mood is {mood} today</Text><Badge>Sibling</Badge></Stack>';
    const renderer = render(<ChatUiBlock source={source} />);
    const chips = chipsInOrder(renderer);
    expect(chips.map((chip) => [chip.label, chip.role])).toEqual([["Text", "note"]]);
    expect(chips[0].text).toMatch(/tone must be one of/);
    expectParagraph(chips[0].next, "Mood is glow today");
    expect(textOf(renderer.root)).toMatch(/^Couldn't render <Text>: tone must be one of [^]*Mood is glow todaySibling$/);
  });

  it("keeps a throwing component's text readable beneath its chip", () => {
    const source = '<Stack><State name="n" initial={0} /><Row><Button variant="ghost" set="n" to={1}>Try again</Button><Badge>Sibling</Badge></Row></Stack>';
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const renderer = render(<ChatUiBlock source={source} />);
    error.mockRestore();
    const chips = chipsInOrder(renderer);
    expect(chips.map((chip) => [chip.label, chip.role, chip.text])).toEqual([["Button", "note", "Couldn't render <Button>: button exploded"]]);
    expectParagraph(chips[0].next, "Try again");
    expect(renderer.root.findAll((node) => node.type === "button")).toHaveLength(0);
    expect(textOf(renderer.root)).toBe("Couldn't render <Button>: button explodedTry againSibling");
  });

  it("keeps script- and HTML-like markup inside failed nodes inert text, in reading order", () => {
    const renderer = render(<ChatUiBlock source={FAILED_CHILD_TEXT} />);
    const hosts = renderer.root.findAll((node) => typeof node.type === "string");
    for (const tag of ["script", "img", "iframe", "b"]) {
      expect(hosts.filter((node) => node.type === tag), tag).toHaveLength(0);
    }
    expect(hosts.filter((node) => Object.keys(node.props).some((key) => /^on[a-z]/.test(key)))).toHaveLength(0);

    const chips = chipsInOrder(renderer);
    expect(chips.map((chip) => chip.label)).toEqual(["Text", "Text", "Marquee", "script", "img", "Text"]);
    // The only innerHTML is each chip's bundled icon; no block text reaches it.
    const inner = hosts.filter((node) => node.props.dangerouslySetInnerHTML !== undefined);
    expect(inner.map((node) => node.type)).toEqual(chips.map(() => "svg"));
    expect(inner.map((node) => node.props.dangerouslySetInnerHTML.__html).join("")).not.toMatch(/covenUiInjected|script|onerror|onclick|<b\b/);
    expect(chips.every((chip) => chip.role === "note")).toBe(true);
    expectParagraph(chips[0].next, "Score: 3 of 5 checks pass");
    expectParagraph(chips[1].next, "Mood is glow today");
    expectParagraph(chips[3].next, "window.__covenUiInjected = true");
    expectParagraph(chips[5].next, "Shown as <b onclick='window.__covenUiInjected = true'>text</b>");
    expect(textOf(renderer.root)).toBe([
      "Release check",
      `Couldn't render <Text>: Unknown prop "colour" on <Text>`,
      "Score: 3 of 5 checks pass",
      "Couldn't render <Text>: tone must be one of neutral, muted, accent, success, warning, danger, info",
      "Mood is glow today",
      "Couldn't render <Marquee>: Unknown component <Marquee>",
      "Couldn't render <script>: Unknown component <script>",
      "window.__covenUiInjected = true",
      "Trend is up",
      "Couldn't render <img>: Unknown component <img>",
      "Couldn't render <Text>: size must be one of xs, sm, md, lg",
      "Shown as <b onclick='window.__covenUiInjected = true'>text</b>",
      "Still rendered",
    ].join(""));
  });

  it("renders the layout catalog with native semantics (#6062)", () => {
    const renderer = render(<ChatUiBlock source={RELEASE_BRIEF} />);
    expect(errorChips(renderer)).toHaveLength(0);
    expect(renderer.root.find((node) => node.props.role === "group").props["aria-label"]).toBe("Release brief");

    const callout = renderer.root.find((node) => typeof node.type === "string" && node.props.className === "chat-ui-callout");
    expect([callout.props.role, callout.props["data-tone"]]).toEqual(["note", "warning"]);
    const title = callout.find((node) => node.props.className === "chat-ui-callout__title");
    expect(callout.props["aria-labelledby"]).toBe(title.props.id);
    expect(textOf(title)).toBe("Warning: Freeze starts Thursday");
    expect(textOf(callout)).toBe("Warning: Freeze starts ThursdayRun pnpm test:app before you merge, and don't skip pnpm lint.");

    expect(renderer.root.findAll((node) => node.type === "code").map(textOf)).toEqual(["pnpm test:app", "pnpm lint"]);
    const strong = renderer.root.findAll((node) => node.type === "strong");
    expect(strong.map(textOf)).toEqual(["don't skip pnpm lint"]);
    expect(strong[0].findAll((node) => node.type === "code").map(textOf)).toEqual(["pnpm lint"]);

    const grid = renderer.root.find((node) => node.type === "div" && node.props.className === "chat-ui-grid");
    expect([grid.props["data-columns"], grid.props["data-gap"], grid.props["data-align"]]).toEqual(["3", "sm", "stretch"]);
    expect(grid.findAll((node) => node.props.className === "chat-ui-stat")).toHaveLength(3);
    expect(stats(renderer)).toEqual({ Merged: "42", Open: "7", Blocked: "2" });

    const dividers = renderer.root.findAll((node) => node.type === "hr");
    expect(dividers.map((node) => [node.props.className, node.props["data-gap"]])).toEqual([["chat-ui-divider", "md"]]);

    const lists = renderer.root.findAll((node) => (node.type === "ul" || node.type === "ol") && node.props.className === "chat-ui-list");
    expect(lists.map((list) => [list.type, list.findAll((node) => node.type === "li").map(textOf)])).toEqual([
      ["ul", ["Native UI blocks", "Faster startup", "Quieter inbox"]],
      ["ol", ["Tag the release", "Publish the notes", "Watch crash reports"]],
    ]);
  });

  it("labels a callout's tone for assistive tech and skips the label for plain tones", () => {
    const renderer = render(<ChatUiBlock source={'<Stack><Callout tone="danger"><Text>Stop</Text></Callout><Callout tone="neutral" title="Aside"><Text>Plain</Text></Callout><Callout tone="muted"><Text>Quiet</Text></Callout></Stack>'} />);
    const callouts = renderer.root.findAll((node) => typeof node.type === "string" && node.props.className === "chat-ui-callout");
    expect(callouts.map(textOf)).toEqual(["Important: Stop", "AsidePlain", "Quiet"]);
    expect(callouts.map((callout) => callout.props.role)).toEqual(["note", "note", "note"]);
    expect(callouts[2].props["aria-labelledby"]).toBeUndefined();
    expect(callouts.every((callout) => callout.findAll((node) => node.type === "svg" || node.props["aria-hidden"]).length > 0)).toBe(true);
  });

  it("keeps a failed layout node's children readable and its siblings rendered", () => {
    const source = '<Stack><State name="n" initial={6} /><Grid columns={n}><Text>Inside the grid</Text></Grid><List items={n} /><Badge>Sibling</Badge></Stack>';
    const renderer = render(<ChatUiBlock source={source} />);
    const chips = chipsInOrder(renderer);
    expect(chips.map((chip) => [chip.label, chip.role])).toEqual([["Grid", "note"], ["List", "note"]]);
    expectParagraph(chips[0].next, "Inside the grid");
    expect(textOf(renderer.root)).toBe(
      `Couldn't render <Grid>: columns must be one of 1, 2, 3, 4Inside the grid${"Couldn't render <List>: items needs a list like "}["A", "B"]Sibling`,
    );
  });

  it("renders an empty list as nothing and list items as plain text", () => {
    const renderer = render(<ChatUiBlock source={'<Stack><List items={[]} /><List items={["<b>bold?</b>", 3]} /></Stack>'} />);
    const lists = renderer.root.findAll((node) => node.props.className === "chat-ui-list" && typeof node.type === "string");
    expect(lists.map((list) => list.findAll((node) => node.type === "li").map(textOf))).toEqual([["<b>bold?</b>", "3"]]);
    expect(renderer.root.findAll((node) => node.type === "b")).toHaveLength(0);
  });

  it("keeps Bold and Code to their closed grammar and their words readable when misplaced", () => {
    const renderer = render(<ChatUiBlock source={"<Stack><Bold>Loud words</Bold><Heading>Title <Code>x</Code></Heading><Text>After</Text></Stack>"} />);
    const chips = chipsInOrder(renderer);
    expect(chips.map((chip) => chip.label)).toEqual(["Bold", "Code"]);
    expectParagraph(chips[0].next, "Loud words");
    expect(renderer.root.findAll((node) => node.type === "strong" || node.type === "code")).toHaveLength(0);
    expect(textOf(renderer.root)).toContain("After");
  });

  it("renders the data catalog: trends, sparkline, donut and badge cells (#6062)", () => {
    const renderer = render(<ChatUiBlock source={DELIVERY_PULSE} />);
    expect(errorChips(renderer)).toHaveLength(0);
    expect(stats(renderer)).toEqual({ "Merged PRs": "23", "Median review": "3.4", "Failed builds": "2" });

    const trends = renderer.root.findAll((node) => typeof node.type === "string" && node.props.className === "chat-ui-stat__trend");
    expect(trends.map((trend) => [textOf(trend), trend.props["data-tone"], trend.props["data-direction"]])).toEqual([
      ["+12% increase", "success", "up"],
      ["\u22120.8 decrease", "success", "down"],
      ["0 unchanged", "neutral", "flat"],
    ]);

    const spark = renderer.root.find((node) => typeof node.type === "string" && node.props.className === "chat-ui-chart chat-ui-sparkline");
    expect(spark.props["data-tone"]).toBe("accent");
    expect(textOf(spark.find((node) => node.type === "figcaption"))).toBe("Merges per day");
    expect(spark.find((node) => node.type === "ul").findAll((node) => node.type === "li").map(textOf)).toEqual([
      "Mon: 4", "Tue: 6", "Wed: 3", "Thu: 7", "Fri: 3",
    ]);
    expect(spark.findAll((node) => node.type === "svg")).toHaveLength(1);

    const donut = renderer.root.find((node) => typeof node.type === "string" && node.props.className === "chat-ui-chart chat-ui-donut");
    const chart = donut.find((node) => node.type === "svg");
    expect(chart.props["aria-label"]).toBe("Review load: Cody 9 (50%), Nova 6 (33%), Val 3 (17%)");
    expect(chart.props["data-donut-size"]).toBe(160);
    expect(chart.findAll((node) => node.type === "path").map((path) => path.props.fill)).toEqual([
      "var(--accent-presence)", "var(--color-warning)", "var(--color-success)",
    ]);
    const legend = donut.findAll((node) => node.type === "li");
    expect(legend.map(textOf)).toEqual(["Cody9 (50%)", "Nova6 (33%)", "Val3 (17%)"]);
    expect(legend.map((item) => item.find((node) => node.props.className === "chat-ui-donut__swatch").props["data-tone"])).toEqual([
      "accent", "warning", "success",
    ]);

    const cells = renderer.root.findAll((node) => node.type === "td");
    expect(cells.map(textOf)).toEqual(["api", "healthy", "exports", "down", "search", "n/a"]);
    const badges = renderer.root.findAll((node) => node.type === "td").flatMap((cell) =>
      cell.findAll((node) => typeof node.type === "string" && node.props.className === "chat-ui-badge"));
    expect(badges.map((badge) => [textOf(badge), badge.props["data-tone"]])).toEqual([["healthy", "success"], ["down", "danger"]]);
  });

  it("gives untoned slices the next tone no other slice is using", () => {
    const source = '<Donut label="Mix" data={[{ label: "a", value: 1, tone: "accent" }, { label: "b", value: 1 }, { label: "c", value: 1, tone: "success" }, { label: "d", value: 1 }]} />';
    const renderer = render(<ChatUiBlock source={source} />);
    const swatches = renderer.root.findAll((node) => node.props.className === "chat-ui-donut__swatch" && typeof node.type === "string");
    expect(swatches.map((swatch) => swatch.props["data-tone"])).toEqual(["accent", "warning", "success", "danger"]);
  });

  it("shows an empty donut as no data and an all-zero donut without invented shares", () => {
    const renderer = render(<ChatUiBlock source={'<Stack><Donut label="Empty" data={[]} /><Donut label="Idle" data={[{ label: "a", value: 0 }, { label: "b", value: 0 }]} /></Stack>'} />);
    const [empty, idle] = renderer.root.findAll((node) => typeof node.type === "string" && node.props.className === "chat-ui-chart chat-ui-donut");
    expect(textOf(empty)).toBe("EmptyNo data yet");
    expect(empty.findAll((node) => node.type === "svg")).toHaveLength(0);
    expect(idle.findAll((node) => node.type === "li").map(textOf)).toEqual(["a0", "b0"]);
    expect(idle.find((node) => node.type === "svg").props["aria-label"]).toBe("Idle: a 0, b 0");
  });

  it("isolates an invalid chart or trend and keeps its siblings", () => {
    const source = '<Stack><State name="n" initial={1} /><Donut label="Load" data={n} /><Stat label="S" value={1} trend={n > 0 ? "up" : 1} /><Badge>Sibling</Badge></Stack>';
    const renderer = render(<ChatUiBlock source={source} />);
    expect(chipsInOrder(renderer).map((chip) => chip.label)).toEqual(["Donut", "Stat"]);
    expect(textOf(renderer.root)).toContain("Sibling");
  });

  it("binds Tabs and a TextInput to local State, and only prefills (#6062)", () => {
    const prefill = vi.fn();
    const renderer = render(
      <UiBlockHostContext.Provider value={{ prefill }}>
        <ChatUiBlock source={RELEASE_DRAFT} />
      </UiBlockHostContext.Provider>,
    );
    expect(errorChips(renderer)).toHaveLength(0);
    const tablist = () => renderer.root.find((node) => node.props.role === "tablist");
    const tabs = () => renderer.root.findAll((node) => node.type === "button" && node.props.role === "tab");
    const panel = () => renderer.root.find((node) => typeof node.type === "string" && node.props.role === "tabpanel");
    expect(tablist().props["aria-label"]).toBe("Draft sections");
    expect(tabs().map((tab) => [textOf(tab), tab.props["aria-selected"]])).toEqual([["Summary", true], ["Details", false]]);
    expect(tabs().every((tab) => tab.props["aria-controls"] === panel().props.id)).toBe(true);
    expect(panel().props["aria-labelledby"]).toBe(tabs()[0].props.id);
    expect(tabs().map((tab) => tab.props.id).every((id) => /^[^\s]+$/.test(id))).toBe(true);

    const input = () => renderer.root.find((node) => node.type === "input" && node.props.type === "text");
    const label = renderer.root.find((node) => node.type === "label" && textOf(node) === "Headline");
    expect(label.props.htmlFor).toBe(input().props.id);
    expect([input().props.value, input().props.placeholder, input().props.maxLength]).toEqual(["Faster startup", "One line for the release page", 80]);
    for (const forbidden of ["name", "form", "formAction", "onSubmit"]) expect(input().props[forbidden]).toBeUndefined();

    act(() => input().props.onChange({ currentTarget: { value: "Quicker boot" } }));
    expect(input().props.value).toBe("Quicker boot");
    expect(textOf(panel())).toContain("Headline: Quicker boot");
    act(() => button(renderer, "Draft the announcement").props.onClick());
    expect(prefill).toHaveBeenCalledWith("Release headline: Quicker boot");

    act(() => input().props.onChange({ currentTarget: { value: "x".repeat(120) } }));
    expect(input().props.value).toHaveLength(80);

    act(() => tabs()[1].props.onClick());
    expect(tabs().map((tab) => tab.props["aria-selected"])).toEqual([false, true]);
    expect(panel().props["aria-labelledby"]).toBe(tabs()[1].props.id);
    expect(panel().findAll((node) => node.type === "li").map(textOf)).toEqual(["Startup is 40% faster", "The inbox is quieter"]);
    expect(renderer.root.findAll((node) => node.type === "input" && node.props.type === "text")).toHaveLength(0);
  });

  it("shows a Tabs chip, with every tab still readable, when State leaves the tab values", () => {
    const source = '<Stack><State name="v" initial="a" /><Tabs bind="v" label="Sections"><Tab value="a" label="First"><Text>One</Text></Tab><Tab value="b" label="Second"><Text>Two</Text></Tab></Tabs><Button set="v" to="z">Break</Button></Stack>';
    const renderer = render(<ChatUiBlock source={source} />);
    act(() => button(renderer, "Break").props.onClick());
    const chips = chipsInOrder(renderer);
    expect(chips.map((chip) => [chip.label, chip.text])).toEqual([["Tabs", `Couldn't render <Tabs>: "z" isn't one of the tabs`]]);
    expect(renderer.root.findAll((node) => node.props.role === "tablist")).toHaveLength(0);
    expect(textOf(renderer.root)).toContain("FirstOneSecondTwo");
  });

  it("falls back to the source as a code block when the body is not markup", () => {
    const renderer = render(<ChatUiBlock source={'{"type": "card"}'} />);
    expect(renderer.root.findAll((node) => node.props["data-ui-block"] === "fallback")).toHaveLength(1);
    const code = renderer.root.find((node) => node.type === "pre");
    expect(textOf(code)).toBe('```jsx\n{"type": "card"}\n```');
  });
});
