import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const postcss = require(require.resolve("postcss", { paths: [dirname(require.resolve("next/package.json"))] }));
const shared = postcss.parse(readFileSync("src/styles/globals/primitives.css", "utf8"));

test("long modal documents override viewport root locks when printing", () => {
  let rootReset = false, paperColors = false;
  shared.walkAtRules("media", (media: { params: string; walkRules: (fn: (rule: { selector: string; nodes: {prop: string; value: string; important: boolean}[] }) => void) => void }) => {
    if (media.params !== "print") return;
    media.walkRules(rule => {
      const declarations = new Map(rule.nodes.map(decl => [decl.prop, decl]));
      if (rule.selector.includes("html:has(") && rule.selector.includes("body:has(")) {
        rootReset = declarations.get("height")?.value === "auto" && declarations.get("height")?.important === true && declarations.get("overflow")?.value === "visible" && declarations.get("overflow")?.important === true;
      }
      if (rule.selector === '.ui-modal-backdrop[data-printable="true"]:not([hidden], [inert])') paperColors = declarations.get("--text-primary")?.value === "CanvasText" && declarations.get("--bg-base")?.value === "Canvas";
    });
  });
  assert.ok(rootReset, "print must release html/body viewport clipping, including inline scroll locks");
  assert.ok(paperColors, "dark mode exports need paper and ink tokens");
});

test("the fullscreen call compact rules include header, body and reply", () => {
  const voice = readFileSync("src/styles/voice-call.css", "utf8");
  assert.match(voice, /@media \(max-width: 640px\)\s*\{\s*\.voice-call-overlay__duration/);
  assert.doesNotMatch(voice, /container-type:\s*inline-size/, "the body cannot serve as its own or its siblings' query ancestor");
});

test("portaled Research Studio owns its responsive content and editor fill layout", () => {
  const source = readFileSync("node_modules/@opencoven/research/src/components/role-surfaces/research-studio-modals.tsx", "utf8");
  const css = readFileSync("node_modules/@opencoven/research/src/styles/globals/surface-research-studio.css", "utf8");
  assert.match(source, /bodyLayout=\{variant === "editor" \? "fill" : "scroll"\}/);
  assert.match(source, /className="research-studio-content"/);
  assert.match(css, /container-name:\s*research-studio/);
  assert.match(css, /@container research-studio \(max-width: 560px\)/);
  assert.match(css, /var\(--research-accent, var\(--accent-presence\)\)/, "body portals have a canonical accent fallback");
});
