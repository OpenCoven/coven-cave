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
assert.match(
  source,
  /--familiar-accent/,
  "Avatars must set a --familiar-accent CSS custom property",
);
assert.match(
  source,
  /familiar-avatar-rail__edit/,
  "Hover-reveal edit (…) affordance must be present per avatar",
);
assert.match(
  source,
  /onContextMenu/,
  "Right-click handler must be wired",
);
assert.match(
  source,
  /useFamiliarStudio/,
  "Rail must call into the Familiar Studio context",
);
assert.match(source, /draggable/, "Avatars must be draggable for reorder");
assert.match(source, /onDragStart/, "onDragStart handler must be present");
assert.match(source, /onDragOver/, "onDragOver handler must be present");
assert.match(source, /onDrop/, "onDrop handler must be present");
assert.match(source, /setFamiliarOrder/, "Must call setFamiliarOrder on drop");
assert.match(source, /openFamiliarStudioListView/, "Right-click on + opens list view");
