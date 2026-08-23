// @ts-nocheck
import { createRef } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";

import { ComposerMarkdownLayer } from "./composer-markdown-layer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Every string the layer actually put on screen, in order. */
function renderedRuns(root): Array<{ className: string; text: string }> {
  return root
    .findAllByType("span")
    .map((span) => ({
      className: span.props.className ?? "",
      text: Array.isArray(span.props.children)
        ? span.props.children.join("")
        : String(span.props.children ?? ""),
    }));
}

async function renderLayer(value: string, onDecoratedChange = vi.fn()) {
  let renderer;
  await act(async () => {
    renderer = create(
      <ComposerMarkdownLayer
        value={value}
        textareaRef={createRef()}
        onDecoratedChange={onDecoratedChange}
      />,
    );
  });
  return renderer;
}

test("the layer paints the draft's characters exactly, with nothing added or dropped", async () => {
  // The layer sits under a live caret: if what it paints differs from the draft
  // by one character the two wrap differently and the decoration detaches from
  // the glyphs it describes. Asserted against the rendered output rather than
  // the tokenizer, so a rendering bug cannot hide behind a passing unit test.
  const draft = "Ship **now**: see [the doc (v2)](https://x.dev/a_(b)) and run `pnpm build`.\n- one\n";
  const renderer = await renderLayer(draft);
  const painted = renderedRuns(renderer.root)
    .map((run) => run.text)
    .join("");
  expect(painted).toBe(draft);

  // …plus one trailing newline, which is what gives the draft's final empty
  // line a line box the way a textarea already reserves one. Without it the
  // layer is a line short the moment the user presses Enter and the whole
  // thing reads as misaligned.
  expect(renderer.toJSON().children.at(-1)).toBe("\n");
});

test("each construct is inked with its own role", async () => {
  const renderer = await renderLayer("a **b** and `c` and [d](https://e.dev)");
  const runs = renderedRuns(renderer.root);
  const classOf = (text: string) => runs.find((run) => run.text === text)?.className ?? "";

  expect(classOf("b")).toContain("cave-md-tok--strong");
  expect(classOf("c")).toContain("cave-md-tok--code");
  expect(classOf("d")).toContain("cave-md-tok--link-text");
  expect(classOf("https://e.dev")).toContain("cave-md-tok--link-url");
  expect(classOf("**")).toContain("cave-md-tok--marker");
});

test("block context rides along with the inline role", async () => {
  const renderer = await renderLayer("> quoted **bold**");
  const runs = renderedRuns(renderer.root);
  const bold = runs.find((run) => run.text === "bold");
  expect(bold?.className).toContain("cave-md-tok--strong");
  expect(bold?.className).toContain("cave-md-blk--quote");
});

test("a fenced block's contents are inked as code, markdown and all", async () => {
  const renderer = await renderLayer("```md\n# not a heading here\n```");
  const runs = renderedRuns(renderer.root);
  const inner = runs.find((run) => run.text === "# not a heading here");
  expect(inner?.className).toContain("cave-md-tok--code");
  expect(inner?.className).toContain("cave-md-blk--code-block");
});

test("the layer is hidden from assistive tech and never claims the caret", async () => {
  const renderer = await renderLayer("**bold**");
  const layer = renderer.root.findByProps({ className: "cave-composer-md-layer" });
  // The textarea stays the only accessible, focusable, selectable thing in the
  // composer; the layer is decoration and must not be announced twice.
  expect(layer.props["aria-hidden"]).toBe("true");
});

test("the textarea is not blanked until the layer has been measured", async () => {
  // With no laid-out DOM there is no measurement, so the layer must report
  // itself undecorated — the fail-open path that leaves an ordinary readable
  // composer on any platform whose text metrics we could not match.
  const onDecoratedChange = vi.fn();
  await renderLayer("**bold**", onDecoratedChange);
  expect(onDecoratedChange).toHaveBeenCalledWith(false);
  expect(onDecoratedChange).not.toHaveBeenCalledWith(true);
});

test("a plain-prose draft renders one undecorated run", async () => {
  const draft = "no markdown in this sentence at all";
  const renderer = await renderLayer(draft);
  const runs = renderedRuns(renderer.root);
  expect(runs).toHaveLength(1);
  expect(runs[0].text).toBe(draft);
  expect(runs[0].className).toBe("cave-md-tok cave-md-tok--text");
});

test("the metric-safety flag starts off, so slant is never applied unmeasured", async () => {
  const renderer = await renderLayer("_emphasis_");
  const layer = renderer.root.findByProps({ className: "cave-composer-md-layer" });
  expect(layer.props["data-metric-safe"]).toBe("false");
  expect(layer.props["data-active"]).toBe("false");
});
