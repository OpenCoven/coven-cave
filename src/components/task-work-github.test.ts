import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./task-work-github.tsx", import.meta.url), "utf8");
const cockpit = await readFile(new URL("./task-work-cockpit.tsx", import.meta.url), "utf8");

assert.match(source, /links: readonly CardGitHubLink\[\]/);
assert.match(source, /fetch\(`\/api\/github\/item\?\$\{params\.toString\(\)\}`/);
assert.match(source, /fetch\(`\/api\/github\/checks\?\$\{params\.toString\(\)\}`/);
assert.match(source, /aria-label="Linked GitHub work"/);
assert.match(source, /Open in app browser/);
assert.match(source, /onManage/);
assert.match(source, /Couldn't fully refresh/);
assert.match(source, /checksJson\?\.error \?\? "GitHub checks lookup failed"/);
assert.match(source, /catch \(reason\) \{\s*checksError = reason instanceof Error/);
// Copilot review on #3601: the no-hydratable-links early return must clear
// loading, and item buttons must not be focusable no-ops without onOpenUrl.
assert.match(
  source,
  /if \(hydratable\.length === 0\) \{\s*setItems\(\{\}\);\s*setError\(null\);\s*setLoading\(false\);/,
  "empty-links early return clears the loading flag",
);
assert.match(source, /disabled=\{!onOpenUrl\}/, "item buttons disable without an onOpenUrl handler");
assert.doesNotMatch(source, /GitHubView/);
assert.match(cockpit, /<TaskWorkGitHub/);
assert.match(cockpit, /stopTerminalOnUnmount: true/);
