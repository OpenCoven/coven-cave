// @ts-nocheck
// The bell trigger's glyph must be sized deliberately, on both axes, and the
// desktop top chrome must normalise it like every other control in that bar.
//
// It previously did neither. `<Icon name="ph:bell" />` passed no size at all,
// so both dimensions fell through to the 1em default and the bell scaled with
// whatever font-size it inherited — inside a 28px button on desktop and a 44px
// touch target on mobile. Nothing failed, because nothing asserted a size.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const iconSource = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");
const chromeCss = readFileSync(
  new URL("../styles/globals/desktop-chrome.css", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /import \{ Icon, CAVE_ICON_SIZE \} from "@\/lib\/icon"/,
  "NotificationBell should import the shared icon size constants with the Icon wrapper",
);

// Both axes, not one. Height defaults to 1em independently of width in the Icon
// wrapper, so a width-only call silently renders a non-square glyph.
assert.match(
  source,
  /name=\{displayBadgeCount > 0 \? "ph:bell-fill" : "ph:bell"\}\s*\n\s*width=\{CAVE_ICON_SIZE\.headerAction\}\s*\n\s*height=\{CAVE_ICON_SIZE\.headerAction\}/,
  "The bell trigger glyph should carry both width and height from CAVE_ICON_SIZE.headerAction",
);

// Pin the reason both axes are required, so a later refactor of Icon's defaults
// has to come past this assertion.
assert.match(
  iconSource,
  /height=\{height \?\? "1em"\}/,
  "Icon still defaults height independently — a width-only call site renders a non-square glyph",
);

// Desktop parity: the bell sits in the same status cluster as .menu-bar__status
// and must be in the rule that pins that cluster to the compact glyph size.
assert.match(
  chromeCss,
  /\.menu-bar__task > svg,\s*\n\s*\.menu-bar__status > svg,\s*\n\s*\.menu-bar__group--status \.notification-bell__trigger > svg \{[\s\S]*?width: var\(--icon-sm\);[\s\S]*?height: var\(--icon-sm\);/,
  "The desktop top-chrome icon standard should cover the notification bell trigger",
);
