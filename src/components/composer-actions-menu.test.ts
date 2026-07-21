import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) => {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  assert.ok(existsSync(path), `${relativePath} should exist`);
  return readFileSync(path, "utf8");
};

const actions = read("./composer-actions-menu.tsx");
const context = read("./composer-context-pill.tsx");
const linkedWork = read("./composer-linked-work-actions.tsx");
const options = read("./composer-options-menu.tsx");
const popover = read("./ui/popover.tsx");
const home = read("./home-composer.tsx");
const styles = read("../styles/cave-composer.css");

assert.match(actions, /export\s+function\s+ComposerActionsMenu/);
assert.match(actions, /export\s+function\s+ComposerLinkedWorkActions/);
assert.match(actions, /export\s+function\s+ComposerResponseSections/);
assert.match(actions, /context:\s*ComposerContextProps/);
assert.match(actions, /linkedWork:\s*ComposerLinkedWorkActionsProps/);
assert.match(actions, /improve:\s*ComposerImproveActions;/);
assert.match(actions, /response:\s*ComposerResponseActions;/);
assert.doesNotMatch(actions, /improve\?:/);
assert.match(actions, /promptSnippets:\s*\{\s*onSelect:/);
assert.doesNotMatch(actions, /promptSnippets\?:/);
assert.match(actions, /enhance:\s*\{\s*onEnhance:/);
assert.doesNotMatch(actions, /enhance\?:/);
assert.match(actions, /dictation\?:\s*\{/);
assert.match(actions, /onSaveAsTemplate:\s*\(\)\s*=>\s*void;/);
assert.doesNotMatch(actions, /onSaveAsTemplate\?:/);
assert.match(actions, /const \{ hostOptions, load, removeHost \} = useComposerResponseHosts\(response\.hostValue\)/);
assert.match(actions, /const hostRefreshPending = useRef\(false\)/);
assert.match(actions, /const hostsLoaded = useRef\(false\)/);
assert.match(
  actions,
  /usePopoverInitialFocus\(open, "\.composer-actions__panel"\);/,
  "opening the grouped panel uses the shared portal-aware focus entry helper",
);
assert.match(
  popover,
  /export function usePopoverInitialFocus\([\s\S]*?requestAnimationFrame[\s\S]*?querySelector<HTMLElement>\(panelSelector\)[\s\S]*?button:not\(:disabled\)[\s\S]*?\.focus\(\)[\s\S]*?cancelAnimationFrame/,
  "the shared focus helper scopes lookup to the panel, focuses an enabled control, and cancels stale work",
);
assert.match(actions, /ariaLabel\s*=\s*"Chat options"|aria-label="Chat options"/);
assert.match(actions, /title=\{\`Chat options · \$\{context\.summary\}\`\}/);
assert.match(
  actions,
  /showIndicator\s*\?\s*<span className="composer-actions__indicator"/,
  "the trigger dot should be wired from the actual JSX branch",
);
assert.match(actions, /<PopoverLabel id="composer-actions-improve-label">Improve<\/PopoverLabel>[\s\S]*Prompt snippets[\s\S]*Smart enhance[\s\S]*Enhance options…/);
assert.match(actions, /<ComposerResponseSections[\s\S]*onSaveAsTemplate=\{\(\) => \{[\s\S]*response\.onSaveAsTemplate\(\);[\s\S]*\}\}/);
assert.match(
  actions,
  /<ComposerLinkedWorkActions[\s\S]*<ComposerResponseSections|<ComposerResponseSections[\s\S]*<ComposerLinkedWorkActions/,
  "ComposerActionsMenu should render both reusable section surfaces",
);
assert.match(
  actions,
  /<PopoverLabel id="composer-actions-context-label">Context<\/PopoverLabel>[\s\S]*Linked Work[\s\S]*Improve[\s\S]*Response/,
  "the grouped actions menu keeps Context / Linked Work / Improve / Response in order",
);
for (const [section, labelId] of [
  ["context", "composer-actions-context-label"],
  ["linked", "composer-actions-linked-work-label"],
  ["improve", "composer-actions-improve-label"],
  ["response", "composer-actions-response-label"],
] as const) {
  assert.match(
    actions,
    new RegExp(
      `<section[^>]*className="composer-actions__section composer-actions__${section}"[^>]*role="group"[^>]*aria-labelledby="${labelId}"[^>]*>[\\s\\S]*?<PopoverLabel id="${labelId}"`,
    ),
    `${section} actions should be exposed as a group labelled by its visible heading`,
  );
}
assert.match(
  popover,
  /export function PopoverLabel\(\{ children, id \}: \{ children: ReactNode; id\?: string \}\)[\s\S]*?<div id=\{id\} className="ui-popover-label"/,
  "PopoverLabel should optionally expose a stable id without changing existing callers",
);
assert.match(
  actions,
  /<\/Popover>[\s\S]*<ComposerContextPickers[\s\S]*\{connectOpen && \([\s\S]*<ConnectHostDialog/,
  "child context pickers and the host dialog stay sibling surfaces beside the one grouped popover",
);
assert.match(
  actions,
  /hostRefreshPending\.current = true/,
  "a successful host connection schedules one forced refresh for the next grouped-menu open",
);
assert.match(
  actions,
  /if \(force\) hostsLoaded\.current = false;[\s\S]*?void load\(force\)\.then\(\(loaded\) => \{[\s\S]*?if \(!cancelled && loaded\) hostsLoaded\.current = true;/,
  "the grouped menu caches only successful host loads, so failures retry on the next open",
);
assert.doesNotMatch(
  actions,
  /hostsLoaded\.current = true;\s*\n\s*void load/,
  "the grouped menu must not mark hosts loaded before the request succeeds",
);
assert.match(actions, /response\.onSaveAsTemplate\(\);/);
assert.match(styles, /\.composer-actions__panel/);
assert.match(styles, /\.composer-actions__indicator/);
assert.match(styles, /\.composer-actions__linked/);
assert.match(styles, /\.composer-actions__response/);
assert.match(styles, /\.composer-actions__panel \.ui-popover-item[\s\S]*min-height: var\(--touch-target\);/);
assert.match(styles, /\.composer-actions__inline-action[\s\S]*min-height: var\(--touch-target\);/);
assert.match(styles, /\.composer-actions__panel \[role="radio"\][\s\S]*min-height: var\(--touch-target\);/);
assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.composer-actions__panel \{\n\s*width: calc\(100vw - 16px\);\n\s*min-width: 0 !important;/);
assert.match(styles, /\.composer-actions__panel[\s\S]*overscroll-behavior: contain;/);

assert.match(
  context,
  /export\s+type\s+ComposerContextView\s*=\s*null\s*\|\s*"project"\s*\|\s*"model"\s*\|\s*"branch"/,
);
assert.match(context, /export\s+type\s+ComposerContextProps\s*=\s*\{/);
assert.match(context, /export\s+function\s+useComposerContextActions/);
assert.match(context, /export\s+function\s+ComposerContextActionRows/);
assert.match(
  context,
  /itemSemantic\?: PopoverItemSemantic/,
  "reusable context rows accept an optional item semantic",
);
assert.match(
  context,
  /<PopoverItem\s+semantic=\{itemSemantic\}/,
  "context rows forward the requested semantic to their PopoverItems",
);
assert.match(context, /export\s+function\s+ComposerContextPickers/);
assert.match(context, /context\.hasGit && context\.branch \? \[context\.branch\] : \[\]/);
assert.match(context, /title=\{summary\}/);
assert.match(context, /icon="ph:git-branch"[\s\S]*title=\{`Branch: \$\{context\.branch\} · \$\{context\.dirtyLabel\}/);
assert.match(context, /icon="ph:git-branch"[\s\S]*>\s*\{context\.branch\}/);

assert.match(linkedWork, /createSmartTaskFromChat/);
assert.match(linkedWork, /TaskLinkPicker/);
assert.match(linkedWork, /marked[- ]done/i);
assert.match(
  linkedWork,
  /itemSemantic\?: PopoverItemSemantic/,
  "reusable linked-work rows accept an optional item semantic",
);
assert.match(
  linkedWork,
  /<PopoverItem\s+semantic=\{itemSemantic\}/,
  "linked-work rows forward the requested semantic to their PopoverItems",
);

assert.match(
  actions,
  /<ComposerContextActionRows[\s\S]*?itemSemantic="button"/,
  "the composite grouped dialog requests native-button semantics for context rows",
);
assert.match(
  actions,
  /<ComposerLinkedWorkActions[\s\S]*?itemSemantic="button"/,
  "the composite grouped dialog requests native-button semantics for linked-work rows",
);
assert.doesNotMatch(
  actions,
  /<PopoverItem(?!\s+semantic="button")/,
  "every PopoverItem owned directly by the composite grouped dialog uses native-button semantics",
);
assert.doesNotMatch(
  actions,
  /<PopoverBody[^>]*\srole="menu"/,
  "the mixed grouped dialog body must not claim pure-menu semantics",
);
assert.match(
  popover,
  /semantic\?: PopoverItemSemantic/,
  "PopoverItem exposes an opt-in native-button semantic mode",
);
assert.match(
  popover,
  /semantic === "button" \? undefined : radio \? "menuitemradio" : "menuitem"/,
  "native-button rows omit the forced menuitem role while pure-menu rows keep the existing default",
);
assert.match(
  popover,
  /semantic === "button" \? undefined : radio \? checked : undefined/,
  "native-button rows do not carry menuitemradio aria-checked",
);

assert.match(options, /role="radiogroup"/);
assert.match(options, /ComposerHostChoices/);
assert.match(options, /ConnectHostDialog/);
assert.match(options, /Save draft as template…/);
assert.match(
  options,
  /composer-options__action composer-actions__inline-action focus-ring disabled:opacity-40/,
);

assert.match(home, /<ComposerPlusMenu/);
assert.match(home, /<ComposerContextPill/);
assert.match(home, /<ComposerOptionsMenu/);
assert.doesNotMatch(home, /<ComposerActionsMenu/);

console.log("composer-actions-menu.test.ts: ok");
