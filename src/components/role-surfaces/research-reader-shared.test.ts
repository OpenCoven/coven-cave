import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./research-reader.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /import \{[\s\S]*?DocumentReader[\s\S]*?\} from "@\/components\/document-reader"/,
  "Research Reader must compose the shared document core",
);
assert.match(
  source,
  /<DocumentReader[\s\S]*?document=\{doc\}/,
  "the source-aware findings model must flow through DocumentReader",
);
assert.match(
  source,
  /renderBlock=\{renderBlock\}/,
  "Research-specific block and citation rendering stays in its adapter",
);
assert.match(
  source,
  /navigation=\{expanded && tocOn \? "rail" : "none"\}/,
  "Research keeps its existing expanded-only contents behavior",
);
assert.match(source, /<aside className="rr-col rr-rail"/);
assert.match(source, /onRefClick/);
assert.match(source, /onPublish/);

// ── "More sources" scrolls with the rail, never sideways (cave-l2hkx) ───────
// The strip used to be `display:flex` in row direction with `overflow-x:auto`
// and 152px fixed-width cards, which put a second, competing scroll axis inside
// a rail that already scrolls vertically (.rr-col is overflow:auto). Reported
// from the running app: s01 visible, s02 clipped mid-word at the rail edge, and
// 12 of 14 sources off-screen.
//
// Measured before/after against this stylesheet with a real browser: row
// direction overflowed the 268px rail by 1964px with cards clipped; column
// direction overflows by 0 and every card renders at the full 268px.
const css = await readFile(new URL("../../styles/research-reader.css", import.meta.url), "utf8");
const strip = css.match(/^\.rr-srcscroll \{([^}]*)\}/m);
assert.ok(strip, "the .rr-srcscroll rule still exists");
assert.match(strip[1], /flex-direction:\s*column/, "the sources strip stacks vertically");
assert.doesNotMatch(
  strip[1],
  /overflow-x\s*:\s*(auto|scroll)/,
  "the sources strip must not introduce its own horizontal scroll — the rail owns scrolling",
);
const mini = css.match(/^\.rr-srcmini \{([^}]*)\}/m);
assert.ok(mini, "the .rr-srcmini rule still exists");
assert.doesNotMatch(
  mini[1],
  /width:\s*\d+px/,
  "source cards fill the rail rather than sitting at a fixed pixel width that overflows it",
);
// The hand-rolled horizontal scrollbar went with the axis it scrolled; leaving
// it would render a drag-thumb wired to a container that no longer scrolls.
for (const dead of ["rr-srctrack", "rr-srcthumb"]) {
  assert.ok(!css.includes(dead), `${dead} is gone with the horizontal strip`);
  assert.ok(!source.includes(dead), `${dead} has no leftover markup or handler`);
}

console.log("research-reader-shared: all assertions passed");
