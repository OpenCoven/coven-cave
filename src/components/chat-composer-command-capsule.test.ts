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
  /const composerResponseSections:[\s\S]*?id:\s*"access"[\s\S]*?label:\s*"Access"[\s\S]*?value:\s*permissionMode[\s\S]*?value:\s*"read",\s*label:\s*"Explore · read only"[\s\S]*?value:\s*"full",\s*label:\s*"Build · full access"[\s\S]*?setPermissionMode\(value\)/,
  "the functional access modes live in the low-profile Response options surface",
);
assert.doesNotMatch(source, /cave-composer-mode-switch|cave-composer-mode-option/, "access mode should not consume the composer command rail");
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
  /\.cave-composer-control-row \{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
  "the command rail gives context the flexible column and actions only their intrinsic width",
);
assert.doesNotMatch(css, /\.cave-composer-mode-switch|\.cave-composer-mode-option/, "retired access switch CSS should stay removed");
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
