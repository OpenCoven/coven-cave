// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./familiar-dock.tsx", import.meta.url), "utf8");

assert.match(src, /export function FamiliarDock/, "exports FamiliarDock");
// All chip clears the scope (null) and reflects the no-filter state.
assert.match(src, /onFamiliarScopeChange\(null\)/, "All chip clears the scope to null");
assert.match(src, /aria-pressed=\{activeFamiliarId == null\}/, "All chip pressed when no familiar is active");
// Avatar select drives the global scope (filter), NOT a new chat.
assert.match(src, /onFamiliarScopeChange\(f\.id\)/, "avatar selects the familiar scope by id");
assert.doesNotMatch(src, /onNewChat/, "dock filters; it does not start chats");
// Add button quick-creates via the studio list (discoverable add path).
assert.match(src, /familiar-dock__add/, "renders the add button");

// Task 3: presence + unread
assert.match(src, /import \{ computePresence, REMOTE_HARNESSES \} from "@\/lib\/presence"/, "uses presence helpers");
assert.match(src, /familiar-dock__presence/, "renders a presence dot");
assert.match(src, /familiar-dock__unread/, "renders an unread dot");
assert.match(src, /responseNeeded\?\.has\(f\.id\)/, "unread comes from responseNeeded");

// Task 4: responsive overflow
assert.match(src, /computeDockInlineCount/, "uses the overflow helper");
assert.match(src, /ResizeObserver/, "measures the row width responsively");
assert.match(src, /familiar-dock__overflow/, "renders the overflow button");
assert.match(src, /overflowCount > 0/, "overflow button is conditional on hidden count");
assert.match(src, /aria-haspopup="dialog"/, "overflow trigger matches the shared Popover dialog role");

// Task 5: overflow + operations popover
assert.match(src, /from "@\/components\/ui\/popover"/, "uses the shared popover");
assert.match(src, /placeholder="Filter familiars…"/, "popover has a search field");
assert.match(src, /className="familiar-dock__pop-search focus-ring-inset"/, "popover search keeps visible focus styling");
assert.match(src, /Not shown in dock/, "popover groups overflow familiars");
assert.match(src, /openFamiliarStudioListView\(\)/, "Manage opens the studio list");
assert.match(src, /Reorder/, "footer exposes Reorder");

// Task 6: drag-reorder + roving keyboard nav
assert.match(src, /from "@dnd-kit\/core"/, "uses dnd-kit");
assert.match(src, /horizontalListSortingStrategy/, "horizontal sorting strategy");
assert.match(src, /setFamiliarOrder\(arrayMove/, "persists reorder via setFamiliarOrder");
assert.match(src, /useRovingTabIndex/, "roving tabindex for keyboard nav");
assert.match(src, /orientation: "horizontal"/, "roving nav is horizontal");

// Review polish: keyboard focus rings remain visible and accessible labels match actions.
assert.match(src, /className=\{`familiar-dock__all focus-ring/, "All chip uses the shared focus ring");
assert.match(src, /className=\{`familiar-dock__avatar focus-ring/, "dock avatars use the shared focus ring");
assert.doesNotMatch(src, /aria-label=\{`Reorder \$\{familiar\.display_name\}`\}/, "sortable avatar label should not claim click-only reorder");

console.log("familiar-dock.test.ts OK");
