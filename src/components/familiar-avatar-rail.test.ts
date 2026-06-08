// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-avatar-rail.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /export function FamiliarAvatarRail/,
  "Component must be named FamiliarAvatarRail",
);
assert.match(
  source,
  /familiar-avatar-rail/,
  "Root element must carry the .familiar-avatar-rail class for CSS hooks",
);
assert.match(
  source,
  /familiar-avatar-rail__avatar/,
  "Avatar buttons must carry the avatar class",
);
assert.match(
  source,
  /familiar-avatar-rail__avatar--active/,
  "Active state must be expressible via class modifier",
);
assert.match(
  source,
  /familiar-avatar-rail__add/,
  "Add (+) button must be present",
);
assert.match(
  source,
  /familiar-avatar-rail__toggle/,
  "Sidebar toggle (≡) button must be present at the bottom",
);
assert.match(
  source,
  /onSelect/,
  "Component must accept an onSelect handler for clicking an avatar",
);
assert.match(
  source,
  /onAddFamiliar/,
  "Component must accept an onAddFamiliar handler for the + button",
);
assert.match(
  source,
  /onToggleSidebar/,
  "Component must accept an onToggleSidebar handler for the ≡ button",
);
assert.match(
  source,
  /aria-label/,
  "Buttons must have aria-labels for screen readers",
);
