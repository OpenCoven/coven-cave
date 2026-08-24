// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const source = read("./chat-view.tsx");
const css = read("../styles/cave-composer.css");
const transcriptCss = read("../styles/cave-chat/transcript.css");
const activityCss = read("../styles/cave-chat/activity.css");

assert.match(
  source,
  /className="cave-composer-mode-switch" role="group" aria-label="Access mode"[\s\S]*?aria-pressed=\{permissionMode === "read"\}[\s\S]*?setPermissionMode\("read"\)[\s\S]*?<span>Explore<\/span>[\s\S]*?aria-pressed=\{permissionMode === "full"\}[\s\S]*?setPermissionMode\("full"\)[\s\S]*?<span>Build<\/span>/,
  "the composer exposes the two enforceable access modes as a direct segmented control",
);
assert.match(
  source,
  /className="cave-composer-send cave-composer-send--busy[\s\S]*?<span>esc · stop<\/span>/,
  "streaming uses the reference-style labelled stop control",
);
assert.match(
  source,
  /<EnhanceControl[\s\S]*?className="cave-composer-footer-action focus-ring"[\s\S]*?<Icon name="ph:microphone"[\s\S]*?aria-label="Send message"/,
  "the right action rail keeps Enhance, microphone, and Send together",
);
assert.match(
  css,
  /\.cave-composer-edge-actions \{[\s\S]*?transform:\s*translateY\(-50%\);/,
  "Tools and Task ride across the input capsule's top border",
);
assert.match(
  css,
  /\.cave-composer-mode-switch \{[\s\S]*?display:\s*inline-flex;[\s\S]*?border:\s*1px solid var\(--border-strong\);/,
  "access modes share one compact segmented-control outline",
);
assert.match(
  css,
  /\.cave-composer-mode-option\[aria-pressed="true"\] \{[\s\S]*?border-color:\s*var\(--accent-presence\);[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\) 14%, transparent\);/,
  "the active access mode uses the design-system accent recipe",
);
assert.match(
  activityCss,
  /--cave-chat-measure:\s*64rem;/,
  "the transcript keeps its wide reading measure",
);
assert.doesNotMatch(activityCss, /--cave-composer-measure/, "the retired narrow composer measure stays removed");
assert.match(
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-shell \{[\s\S]*?max-width:\s*100%;/,
  "the composer spans the available chat dock",
);
assert.match(
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-input \{[\s\S]*?min-height:\s*var\(--space-10\);/,
  "desktop Chat uses a compact 40px writing field",
);
assert.match(
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-send--busy[\s\S]*?width:\s*auto;[\s\S]*?padding-inline:\s*var\(--space-2\);[\s\S]*?font-size:\s*var\(--text-xs\);/,
  "the stop action expands into a readable danger pill while streaming",
);

console.log("chat-composer-command-capsule.test.ts OK");
