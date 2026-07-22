import assert from "node:assert/strict";

import { resolveTsxTarget, tokenizeTsxDesign } from "./tokenize-tsx-design.mjs";

{
  const source = `<div className="text-[9px] text-[11px] text-[14px] text-[18px] text-[28px]" />`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<div className="text-[length:var(--text-2xs)] text-[length:var(--text-xs)] text-[length:var(--text-md)] text-[length:var(--text-xl)] text-[length:var(--text-display)]" />`,
  );
}

{
  const source = `<div className="text-[length:11px] text-[11px]/[14px]" />`;
  assert.equal(
    tokenizeTsxDesign(source),
    `<div className="text-[length:var(--text-xs)] text-[length:var(--text-xs)]/[14px]" />`,
  );
}

{
  const source = `<div className="w-[32px] min-h-[40px] gap-[12px] p-[6px] rounded-[8px] rounded-[5px]" />`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<div className="w-[var(--space-8)] min-h-[var(--space-10)] gap-[var(--space-3)] p-[6px] rounded-[var(--radius-control)] rounded-[5px]" />`,
  );
}

{
  const source = `<div className="text-[var(--danger,#d95a5a)] border-[var(--border,#333)] hover:bg-[color-mix(in_oklch,var(--color-danger)_85%,#000)]" />`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<div className="text-[var(--color-danger)] border-[var(--border-hairline)] hover:bg-[color-mix(in_oklch,var(--color-danger)_85%,var(--color-mix-dark))]" />`,
  );
}

{
  const source = `const copy = "Use text-[11px] in this example";
const palette = "#e5e7eb";
export const A = () => <input type="color" value="#e5e7eb" aria-label={copy + palette} />;`;
  assert.equal(tokenizeTsxDesign(source), source, "ordinary strings and color values stay untouched");
}

{
  const source = `const PILL_CLASSES = {
  holds: "bg-[var(--ok-soft,rgba(80,180,120,0.15))] text-[var(--ok,#4dbd7a)]",
};`;
  assert.equal(tokenizeTsxDesign(source), source, "unreferenced class-like data stays untouched");
}

{
  const source = `<div className="before:content-['text-[11px]'] bg-[url(/assets/text-[11px].png#e5e7eb)] text-[11px]" />`;
  assert.equal(
    tokenizeTsxDesign(source),
    `<div className="before:content-['text-[11px]'] bg-[url(/assets/text-[11px].png#e5e7eb)] text-[length:var(--text-xs)]" />`,
  );
}

{
  const source = `<div className={cn(isVariant(kind, "text-[11px]"), "text-[11px]")} />`;
  assert.equal(
    tokenizeTsxDesign(source),
    `<div className={cn(isVariant(kind, "text-[11px]"), "text-[length:var(--text-xs)]")} />`,
  );
}

{
  const source = `<div className={(track(), "text-[11px]")} />`;
  assert.equal(
    tokenizeTsxDesign(source),
    `<div className={(track(), "text-[length:var(--text-xs)]")} />`,
  );
}

{
  const source = `const classification = "Use text-[11px]";
export const A = ({ variant }) => (
  <div className={variant === "text-[11px]" ? "text-sm" : "text-base"}>{classification}</div>
);`;
  assert.equal(tokenizeTsxDesign(source), source, "predicates and ordinary data stay untouched");
}

{
  const source = `<div className="base" style={{ display: "flex", gap: 8, fontSize: 11, opacity: 0.5 }} />`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<div className="base [display:flex]! [gap:var(--space-2)]! [font-size:var(--text-xs)]! [opacity:0.5]!" />`,
  );
}

{
  const source = `<div style={{ padding: "4px 12px", borderRadius: 8, color: "var(--text-primary)" }} />`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<div className="[padding:var(--space-1)_var(--space-3)]! [border-radius:var(--radius-control)]! [color:var(--text-primary)]!" />`,
  );
}

{
  const source = `<div className={active ? "active" : "idle"} style={{ width: 20, zIndex: 2 }} />`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<div className={[(active ? "active" : "idle"), "[width:var(--space-5)]! [z-index:2]!"].filter(Boolean).join(" ")} />`,
  );
}

{
  const source = `<div className='before:content-["*"]' style={{ color: "var(--text-primary)" }} />`;
  assert.equal(
    tokenizeTsxDesign(source),
    `<div className='before:content-["*"] [color:var(--text-primary)]!' />`,
  );
}

{
  const source = `<div className='base' style={{ fontFamily: "'Open Sans'" }} />`;
  assert.equal(
    tokenizeTsxDesign(source),
    `<div className="base [font-family:'Open_Sans']!" />`,
  );
}

{
  const source = `<div className={(track(), "base")} style={{ color: "var(--text-primary)" }} />`;
  const output = tokenizeTsxDesign(source);
  assert.ok(
    output.includes(`className={[((track(), "base")), "[color:var(--text-primary)]!"]`),
    "existing comma expressions stay grouped as one className value",
  );
}

{
  const source = `<div
  className="base"
  style={{
    display: "grid",
    ["--row-accent" as string]: "var(--accent-presence)",
  }}
/>`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<div
  className="base [display:grid]! [--row-accent:var(--accent-presence)]!"
/>`,
  );
}

{
  const source = `<label className="base"
  style={{ color: "var(--text-muted)" }}>
  Label
</label>`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<label className="base [color:var(--text-muted)]!">
  Label
</label>`,
  );
}

{
  const mixed = `<div className="text-[12px]" style={{ color: "var(--text-primary)", width }} />`;
  assert.equal(
    tokenizeTsxDesign(mixed),
    `<div className="text-[length:var(--text-sm)]" style={{ color: "var(--text-primary)", width }} />`,
  );
}

{
  const spread = `<div style={{ color: "var(--text-primary)", ...style }} />`;
  assert.equal(tokenizeTsxDesign(spread), spread);
}

{
  const spreadAttribute = `<div {...props} style={{ color: "var(--text-primary)" }} />`;
  assert.equal(tokenizeTsxDesign(spreadAttribute), spreadAttribute);
}

{
  const overlapping = `<div style={{ background: "red", backgroundColor: "blue" }} />`;
  assert.equal(tokenizeTsxDesign(overlapping), overlapping);
}

{
  const source = `<div style={{ transform: "translateX(10px)", padding: "calc(8px + 1px)" }} />`;
  const output = tokenizeTsxDesign(source);
  assert.equal(
    output,
    `<div className="[transform:translateX(10px)]! [padding:calc(8px_+_1px)]!" />`,
  );
}

{
  const source = `<div style={{ WebkitLineClamp: 2, floodOpacity: 0.5 }} />`;
  assert.equal(
    tokenizeTsxDesign(source),
    `<div className="[-webkit-line-clamp:2]! [flood-opacity:0.5]!" />`,
  );
}

{
  const source = `<div style={{ msZoom: 2, WebKitBoxFlexGroup: 4, WebkitBoxFlexGroup: 4, msLineClamp: 3 }} />`;
  assert.equal(
    tokenizeTsxDesign(source),
    `<div className="[-ms-zoom:2]! [-webkit-box-flex-group:4]! [-webkit-box-flex-group:4px]! [-ms-line-clamp:3px]!" />`,
  );
}

{
  const source = `<div className="text-[12px]" style={{ gap: 8 }} />`;
  const once = tokenizeTsxDesign(source);
  assert.equal(tokenizeTsxDesign(once), once, "codemod must be idempotent");
}

assert.ok(
  resolveTsxTarget("src/components/chat-view.tsx")
    .replaceAll("\\", "/")
    .endsWith("src/components/chat-view.tsx"),
  "the resolved target stays comparable on Windows and POSIX paths",
);
assert.throws(() => resolveTsxTarget("package.json"), /must end in \.tsx/);
assert.throws(
  () => resolveTsxTarget("src/app/layout.tsx"),
  /must stay inside src\/components/,
);

console.log("tokenize-tsx-design: ok");
