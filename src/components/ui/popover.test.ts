// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const src = readFileSync(new URL("./popover.tsx", import.meta.url), "utf8");

const require = createRequire(import.meta.url);
const originalSucraseOptions = process.env.SUCRASE_OPTIONS;
process.env.SUCRASE_OPTIONS = JSON.stringify({ jsxRuntime: "automatic" });
require("sucrase/register/tsx");
if (originalSucraseOptions === undefined) delete process.env.SUCRASE_OPTIONS;
else process.env.SUCRASE_OPTIONS = originalSucraseOptions;
const Module = require("node:module");
const originalResolveFilename = Module._resolveFilename;
const suffixes = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
  let base = null;
  if (request.startsWith("@/")) {
    base = path.join(process.cwd(), "src", request.slice(2));
  } else if ((request.startsWith("./") || request.startsWith("../")) && parent?.filename) {
    base = path.resolve(path.dirname(parent.filename), request);
  }
  if (base) {
    for (const suffix of suffixes) {
      if (existsSync(base + suffix)) return base + suffix;
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const { PopoverItem } = require("./popover.tsx");
Module._resolveFilename = originalResolveFilename;

function renderItem(props) {
  return renderToStaticMarkup(
    createElement(PopoverItem, { onSelect: () => undefined, ...props }, "Example"),
  );
}

function jsxElements(fileName, source, tagName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = [];
  const readAttributes = (attributes) => {
    const values = new Map();
    for (const attr of attributes.properties) {
      if (!ts.isJsxAttribute(attr)) continue;
      if (!attr.initializer) {
        values.set(attr.name.text, true);
        continue;
      }
      if (ts.isStringLiteral(attr.initializer)) {
        values.set(attr.name.text, attr.initializer.text);
        continue;
      }
      if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
        values.set(attr.name.text, attr.initializer.expression.getText(sourceFile));
      }
    }
    return values;
  };
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === tagName) {
      elements.push({
        block: node.getText(sourceFile),
        attributes: readAttributes(node.openingElement.attributes),
      });
    } else if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === tagName) {
      elements.push({
        block: node.getText(sourceFile),
        attributes: readAttributes(node.attributes),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return elements;
}

// The popover must consume its own Escape: a capture-phase keydown listener that
// stopPropagation()s before the event reaches a parent dialog's bubble-phase
// handler (e.g. Settings, which closes itself on Escape). Without this, one Esc
// closes both the popover AND the surrounding Settings panel.
assert.match(src, /if \(e\.key === "Escape"\)/, "popover handles Escape");
assert.match(src, /e\.stopPropagation\(\)/, "popover stops Escape from propagating to parent handlers");
assert.match(src, /addEventListener\("keydown", onKey, true\)/, "popover keydown listens in the capture phase");
assert.match(src, /removeEventListener\("keydown", onKey, true\)/, "popover keydown cleanup matches the capture phase");

// Viewport-aware positioning: auto-flip to the opposite side when the preferred
// side can't fit the popover, clamp horizontally, and cap height so it never
// overflows the viewport (the color picker overflowed at laptop height before).
assert.match(src, /scrollHeight/, "measures the popover's natural content height for fit checks");
assert.match(src, /spaceBelow|spaceAbove/, "compares room below vs above the anchor to decide flip");
assert.match(src, /Math\.min\(r\.left/, "clamps the left edge within the viewport");
assert.match(src, /maxHeight/, "caps height (with overflowY:auto) so neither side overflows");

// Complex pickers can keep their own header/footer fixed and give scrolling to
// an inner results region. That must be opt-in so existing simple menus retain
// the shared popover's default outer scrolling behavior.
assert.match(
  src,
  /scrollStrategy\?: "popover" \| "content"/,
  "popover exposes an opt-in inner-content scrolling strategy",
);
assert.match(
  src,
  /scrollStrategy === "content" \? "hidden" : "auto"/,
  "content-owned scrolling disables the outer popover scroll container",
);
assert.match(
  src,
  /compactAtHeight\?: number/,
  "composite children can react to the popover's computed visual-viewport height",
);
assert.match(
  src,
  /data-compact=\{compact \|\| undefined\}/,
  "the popover exposes its computed compact state to descendant CSS",
);

// Visual-viewport awareness: the on-screen keyboard (iOS) shrinks the visible band
// without changing window.innerHeight. The popover must measure against
// window.visualViewport so it clamps inside the visible area instead of hiding
// under the keyboard, and must recompute when the keyboard opens/closes.
assert.match(src, /window\.visualViewport/, "measures against the visual viewport (keyboard-aware)");
assert.match(src, /vv\?\.height|visualViewport\b[\s\S]*?\.height/, "uses the visual viewport height for fit checks");
assert.match(
  src,
  /vv\?\.addEventListener\("resize"|visualViewport[\s\S]*?addEventListener\("resize"/,
  "recomputes when the visual viewport resizes (keyboard show/hide)",
);

// role="dialog" requires an accessible name. The popover takes an optional ariaLabel
// prop and wires it onto the dialog; without it screen readers announce the popover
// with no title.
assert.match(src, /ariaLabel\?: string/, "popover accepts an ariaLabel prop");
assert.match(src, /aria-label=\{ariaLabel\}/, "popover wires aria-label onto the dialog");

// On close the popover returns focus to the trigger when focus would otherwise be
// lost to document.body (Escape, item-select, outside-click on empty space), so
// keyboard users aren't stranded — but leaves focus alone if moved to another control.
assert.match(
  src,
  /active === document\.body[\s\S]{0,40}?anchor\?\.focus/,
  "popover restores focus to the anchor when it would otherwise land on body",
);

// Stacking: popovers portal to <body>, so they compete with every other
// portaled layer purely on z-index. The board task drawer (also portaled to
// <body>) sits at z 300/301 — the popover portal must layer ABOVE it, or the
// drawer's backdrop paints over the open menu and the click that "selects an
// option" lands on the backdrop and closes the drawer instead (the Tasks
// inspector's Status/Priority/Familiar/Project dropdowns were unusable).
const globalsCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const boardCss = readFileSync(new URL("../../styles/board.css", import.meta.url), "utf8");
const portalZ = Number(
  globalsCss.match(/\.ui-popover-portal\s*\{[^}]*?z-index:\s*(\d+)/)?.[1],
);
const drawerZ = Math.max(
  ...[...boardCss.matchAll(/\.board-drawer(?:-backdrop)?\s*\{[^}]*?z-index:\s*(\d+)/g)].map(
    (m) => Number(m[1]),
  ),
);
assert.ok(Number.isFinite(portalZ), "found .ui-popover-portal z-index in globals.css");
assert.ok(Number.isFinite(drawerZ), "found .board-drawer z-index in board.css");
assert.ok(
  portalZ > drawerZ,
  `popover portal (z ${portalZ}) must stack above the board drawer (z ${drawerZ})`,
);

// Non-modal dialog focus contract (cave-fu1y): the page behind stays
// interactive (light dismiss), so instead of a focus trap the popover must
// close when keyboard focus moves out — an open "dialog" must never float
// astray while Tab walks the page behind it. The container carries
// tabIndex={-1} so callers can seat focus on it programmatically.
assert.match(
  src,
  /role="dialog"[\s\S]{0,600}tabIndex=\{-1\}/,
  "dialog container is programmatically focusable (tabIndex={-1})",
);
assert.match(src, /onBlur=\{\(e\) => \{/, "popover watches for focus leaving");
assert.match(
  src,
  /if \(!next\) return;[\s\S]{0,300}onOpenChange\(false\)/,
  "focus-out closes the popover, but a null relatedTarget (window blur / native pickers) does not",
);
assert.match(
  src,
  /anchorRef\.current\?\.contains\(next\)/,
  "focus moving back to the anchor doesn't close the popover",
);

// A `checked` row used to be a menuitemradio unconditionally, so every
// standalone boolean toggle in a popover menu announced as one choice among
// mutually exclusive alternatives. Render the actual element so the coverage
// survives formatting-only refactors in the component source.
assert.match(
  renderItem({ checked: true }),
  /role="menuitemradio"[\s\S]*aria-checked="true"/,
  "checked rows stay menuitemradio by default",
);
assert.match(
  renderItem({ checked: false, checkedRole: "checkbox" }),
  /role="menuitemcheckbox"[\s\S]*aria-checked="false"/,
  "independent toggles can opt into menuitemcheckbox",
);
assert.match(
  renderItem({ checked: true, semantic: "button" }),
  /aria-pressed="true"/,
  "button-semantics toggles expose their pressed state",
);
assert.doesNotMatch(
  renderItem({ checked: true, semantic: "button" }),
  /aria-checked=|role="menuitem(?:radio|checkbox)"/,
  "button-semantics toggles keep native button semantics",
);

// The render assertions above prove the COMPONENT honors checkedRole. They say
// nothing about whether the five independent toggles actually pass it, and that
// is the bug: drop `checkedRole="checkbox"` from workspace-sidebar and every
// assertion above still passes while "Show archived" silently announces as one
// choice among mutually exclusive alternatives again. So the call sites are
// pinned too — component behavior and adoption are different claims. Read the
// TSX as JSX so the coverage survives formatting-only refactors in the callers.
const workspaceSidebar = readFileSync(new URL("../workspace-sidebar.tsx", import.meta.url), "utf8");
assert.ok(
  jsxElements("workspace-sidebar.tsx", workspaceSidebar, "PopoverItem").some(
    ({ block, attributes }) =>
      block.includes("Show archived") && attributes.get("checkedRole") === "checkbox",
  ),
  "Show archived is an independent toggle, not one of a mutually exclusive set",
);

const sessionHeader = readFileSync(new URL("../chat-session-header.tsx", import.meta.url), "utf8");
assert.ok(
  jsxElements("chat-session-header.tsx", sessionHeader, "PopoverItem").some(
    ({ attributes }) =>
      attributes.get("checked") === "item.checked" &&
      attributes.get("checkedRole") === "checkbox",
  ),
  "session menu toggles (thinking / instruments) opt into the checkbox role",
);

// Both "Keep chat" rows — the list row menu and the hover-kebab menu — carry
// it. Their indentation differs, so a single edit silently covers only one of
// them; that happened while writing this change, which is why the count is
// asserted rather than a bare match.
const chatList = readFileSync(new URL("../chat-list.tsx", import.meta.url), "utf8");
const chatListItems = jsxElements("chat-list.tsx", chatList, "PopoverItem");
assert.equal(
  chatListItems.filter(
    ({ block, attributes }) =>
      block.includes("Keep chat") && attributes.get("checkedRole") === "checkbox",
  ).length,
  2,
  "both Keep-chat toggles opt into the checkbox role",
);

// Guard the other direction: mutually exclusive pickers must NOT be converted.
// e2e specs pin these as menuitemradio (chat-response-output, chat-sessions-
// surface, composer-runtime-chip), so a stray conversion breaks them far from
// here.
for (const file of ["../composer-runtime-chip.tsx", "../project-picker.tsx", "../ui/select.tsx"]) {
  const caller = readFileSync(new URL(file, import.meta.url), "utf8");
  const elements = jsxElements(file, caller, "PopoverItem");
  assert.ok(
    !elements.some(({ attributes }) => attributes.get("checkedRole") === "checkbox"),
    `${file} is a one-of-a-set picker and must stay menuitemradio`,
  );
}

console.log("popover.test.ts: ok");
