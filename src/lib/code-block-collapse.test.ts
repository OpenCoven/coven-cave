// @ts-nocheck
import assert from "node:assert/strict";

const { toggleCodeBlockCollapse, CODE_COLLAPSED_CLASS } = await import("./code-block-collapse.ts");

function makeWrap() {
  const set = new Set();
  return {
    classList: {
      toggle(t) { if (set.has(t)) { set.delete(t); return false; } set.add(t); return true; },
      contains: (t) => set.has(t),
    },
    has: (t) => set.has(t),
  };
}
function makeBtn() {
  const attrs = {};
  return { setAttribute: (k, v) => { attrs[k] = v; }, attrs };
}

// First click collapses; aria reflects collapsed (expanded=false, "Expand code").
{
  const wrap = makeWrap();
  const btn = makeBtn();
  const collapsed = toggleCodeBlockCollapse(wrap, btn);
  assert.equal(collapsed, true, "first toggle collapses");
  assert.ok(wrap.has(CODE_COLLAPSED_CLASS), "collapsed class added");
  assert.equal(btn.attrs["aria-expanded"], "false");
  assert.equal(btn.attrs["aria-label"], "Expand code");
}

// Second click expands; aria reflects expanded (expanded=true, "Collapse code").
{
  const wrap = makeWrap();
  const btn = makeBtn();
  toggleCodeBlockCollapse(wrap, btn);
  const collapsed = toggleCodeBlockCollapse(wrap, btn);
  assert.equal(collapsed, false, "second toggle expands");
  assert.ok(!wrap.has(CODE_COLLAPSED_CLASS), "collapsed class removed");
  assert.equal(btn.attrs["aria-expanded"], "true");
  assert.equal(btn.attrs["aria-label"], "Collapse code");
}

console.log("code-block-collapse.test.ts: ok");
