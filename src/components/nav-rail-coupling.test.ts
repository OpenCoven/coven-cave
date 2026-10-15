// @ts-nocheck
// PR 3 / Task 1: the left nav is coupled to the code rail. When the code rail
// becomes visible, the shell soft-collapses the nav to its icon rail so the
// chat stays centered; it restores the nav when the rail closes UNLESS the user
// explicitly re-expanded the nav while the rail was open (their intent wins).
// The two components talk over a directional cave:code-rail-visibility event.
// Desktop-only — mobile nav is a drawer, so the coupling is a no-op there.
// Source-text guard — asserts the wiring survives refactors.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const railController = await readFile(new URL("../lib/use-workspace-rail-controller.ts", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");

// (a) the shared rail controller dispatches cave:code-rail-visibility with
//     detail:{open:showInline} from an effect keyed on showInline.
assert.match(
  railController,
  /useEffect\(\(\)\s*=>\s*\{[\s\S]*?new CustomEvent\("cave:code-rail-visibility", \{ detail: \{ open: showInline \} \}\)[\s\S]*?\}, \[showInline\]\)/,
  "the shared controller dispatches cave:code-rail-visibility { open: showInline }",
);
assert.match(
  railController,
  /useEffect\(\(\) => \(\) => \{[\s\S]*?new CustomEvent\("cave:code-rail-visibility", \{ detail: \{ open: false \} \}\)/,
  "the shared controller restores shell navigation when its rail unmounts",
);

// (b) shell.tsx listens for the cave:code-rail-visibility event.
assert.match(
  shell,
  /addEventListener\(\s*"cave:code-rail-visibility"/,
  "shell listens for cave:code-rail-visibility",
);
assert.match(
  shell,
  /"cave:code-rail-visibility"/,
  "shell references the cave:code-rail-visibility event name",
);

// The state-machine bookkeeping refs exist.
assert.match(
  shell,
  /railAutoCollapsedNavRef\s*=\s*useRef/,
  "shell keeps a railAutoCollapsedNavRef",
);
assert.match(
  shell,
  /userOverrodeNavRef\s*=\s*useRef/,
  "shell keeps a userOverrodeNavRef",
);

// (c) shell collapses via navRef.current?.collapse() and restores via
//     navRef.current?.expand() inside the rail-visibility handler.
assert.match(
  shell,
  /navRef\.current\?\.collapse\(\)/,
  "shell collapses the nav via navRef.current?.collapse()",
);
assert.match(
  shell,
  /navRef\.current\?\.expand\(\)/,
  "shell restores the nav via navRef.current?.expand()",
);

// (d) the restore is guarded by the user-override ref and !isMobile.
assert.match(
  shell,
  /railAutoCollapsedNavRef\.current\s*&&\s*!userOverrodeNavRef\.current\s*&&\s*!isMobile/,
  "the rail-close restore is guarded by railAutoCollapsed && !userOverrode && !isMobile",
);

// User-override detection: navOpen flipping true while the rail auto-collapsed
// it marks the user's intent so the later restore is suppressed.
assert.match(
  shell,
  /railAutoCollapsedNavRef\.current[\s\S]*?userOverrodeNavRef\.current\s*=\s*true/,
  "shell sets userOverrodeNavRef when the user re-opens the nav while rail-collapsed",
);

// Chat-list fit (#5956, G2): the open nav yields to Chat's thread list only
// where the two squeeze the reading column. The policy is pure and unit-tested
// in src/lib/shell-chat-rail-nav.test.ts; these pins keep the shell wiring.
const chatRailToggle = await readFile(new URL("../lib/chat-rail-toggle.ts", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
assert.match(
  chatSurface,
  /useEffect\(\(\) => \(\) => emitChatRailVisibility\(\{ available: false, open: false \}\), \[\]\);/,
  "leaving Chat retracts the list as { available: false, open: false }, which is what gives the nav back",
);
assert.match(
  chatRailToggle,
  /let lastVisibility: ChatRailVisibility/,
  "the list's visibility is latched for a listener that registers after ChatSurface announced it",
);
assert.match(
  shell,
  /setChatRail\(readChatRailVisibility\(\)\);[\s\S]{0,320}?window\.addEventListener\(CHAT_RAIL_VISIBILITY_EVENT, onChatRailVisibility\);/,
  "the shell reads the latched list visibility, then follows the event",
);
assert.match(
  shell,
  /const step = resolveChatRailNavYield\(\{\s*rail: chatRail,\s*isMobile,\s*navOpen: navIsOpen,\s*yieldNeeded: shouldNavYieldToChatRail\(\{\s*viewportWidth: window\.innerWidth,\s*navWidth: preferredNavWidth,\s*railWidth,\s*\}\),\s*state: chatRailNavRef\.current,\s*\}\);/,
  "the shell asks the pure policy, measuring the window, the nav's open width and the rendered list",
);
assert.match(
  shell,
  /const focusInNav = navAsideRef\.current\?\.contains\(document\.activeElement\) \?\? false;\s*panel\.collapse\(\);\s*if \(focusInNav\) detailElRef\.current\?\.focus\(\{ preventScroll: true \}\);/,
  "a yield that closes the nav under the focus lands it on the main content",
);
assert.match(
  shell,
  /<aside\s+ref=\{navAsideRef\}\s+className="shell-nav"/,
  "the focus check reads the nav's own landmark",
);
assert.match(
  shell,
  /if \(navOpen && navRef\.current && !navRef\.current\.isCollapsed\(\)\) \{\s*chatRailNavRef\.current = noteChatRailNavOpened\(chatRailNavRef\.current\);/,
  "only a nav that is really open again counts as the user taking it back",
);
assert.match(
  shell,
  /if \(panel && !railAutoCollapsedNavRef\.current && !chatRailNavRef\.current\.autoCollapsed\) \{/,
  "the remembered preference does not reopen a nav that is yielding",
);

console.log("nav-rail-coupling.test.ts ok");
