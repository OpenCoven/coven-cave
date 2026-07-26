// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const homeComposer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  shell,
  /if \(!mounted\) \{[\s\S]{0,700}?<div className="shell-root flex-1 min-h-0" \/>/,
  "Shell must not paint an empty content root while waiting for a passive mount effect",
);

assert.match(
  shell,
  /<div className="shell-body flex flex-1 min-h-0">[\s\S]{0,900}?\b(?:horizontalGroup|<Group)\b/,
  "the first shell render must include the real panel group",
);

assert.match(
  shell,
  /const layoutStorage = mounted \? shellStorage : hydrationShellStorage/,
  "the first client render must use the same inert layout-storage snapshot as SSR",
);

assert.match(
  shell,
  /useDefaultLayout\(\{[\s\S]{0,180}?storage: layoutStorage/,
  "persisted panel layout reads must begin only after hydration",
);

assert.match(
  shell,
  /useLayoutEffect\(\(\) => setMounted\(true\), \[\]\)/,
  "the client must restore the live shell before its first post-hydration paint",
);

assert.match(
  shell,
  /const \[navOpen, setNavOpen\] = useState\(chatContextual\)/,
  "the server and first client render must share the collapsed default for non-contextual navigation",
);

assert.match(
  shell,
  /const defaultNavSize = chatContextual\s*\? "260px"\s*: mounted\s*\? `\$\{NAV_OPEN_PX\}px`\s*: `\$\{NAV_RAIL_PX\}px`/,
  "the first non-contextual panel paint must use the collapsed rail width",
);

assert.match(
  shell,
  /<Panel[\s\S]{0,240}?id="nav"[\s\S]{0,320}?defaultSize=\{defaultNavSize\}/,
  "the nav panel must consume the hydration-stable first-paint size",
);

assert.match(
  homeComposer,
  /const \[text, setText\] = useState\(""\)/,
  "HomeComposer must hydrate from the same empty draft snapshot emitted by SSR",
);

assert.match(
  homeComposer,
  /useLayoutEffect\(\(\) => \{\s*setText\(readComposerDraft\(HOME_DRAFT_KEY\)\);\s*setDraftRestored\(true\);\s*\}, \[\]\)/,
  "HomeComposer must restore a persisted draft before paint without hydrating mismatched controls",
);

console.log("shell-first-paint.test.ts OK");
