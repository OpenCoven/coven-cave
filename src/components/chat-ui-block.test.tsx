// @ts-nocheck — react-test-renderer ships no types; matches the repository convention.
//
// Behavioral test for the native UI tier renderer: local State drives
// computed values, State survives streamed re-parses (including the real
// StreamingMarkdownBlocks seam), a Button only sets State or prefills the
// composer, and every failure stays an inline chip beside rendered siblings.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { partitionStreamingMarkdown } from "@/lib/streaming-markdown-blocks";
import {
  MALFORMED_DASHBOARD,
  MINI_DASHBOARD,
  PRICING_CALCULATOR,
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
      "Sparkline", "Badge", "Text", "Stat", "Stat", "Stat",
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

  it("falls back to the source as a code block when the body is not markup", () => {
    const renderer = render(<ChatUiBlock source={'{"type": "card"}'} />);
    expect(renderer.root.findAll((node) => node.props["data-ui-block"] === "fallback")).toHaveLength(1);
    const code = renderer.root.find((node) => node.type === "pre");
    expect(textOf(code)).toBe('```jsx\n{"type": "card"}\n```');
  });
});
