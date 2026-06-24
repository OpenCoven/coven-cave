// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Both surfaces gain a text filter via the shared SearchInput primitive.
const vault = read("./vault-panel.tsx");
assert.match(vault, /import \{ SearchInput \} from "@\/components\/ui\/search-input"/, "vault imports SearchInput");
assert.match(vault, /<SearchInput[\s\S]*?placeholder="Filter secrets…"/, "vault renders a secrets filter");
// Filter composes with the undo-pending hide and matches key / ref / description.
assert.match(vault, /\[m\.key, m\.ref \?\? "", m\.description \?\? ""\]\.join\(" "\)\.toLowerCase\(\)\.includes\(q\)/, "vault filters by key/ref/description");
assert.match(vault, /No secrets match/, "vault shows a no-matches message");

const auto = read("./automations-view.tsx");
assert.match(auto, /import \{ SearchInput \} from "@\/components\/ui\/search-input"/, "automations imports SearchInput");
assert.match(auto, /<SearchInput[\s\S]*?aria-label="Filter schedules"/, "automations renders a schedules filter");
// The text filter applies to all three tabs' source derivations.
assert.match(auto, /isScheduleInboxItem\(it\) && !hiddenIds\.has\(it\.id\) && \(!q \|\| \(it\.title \?\? ""\)\.toLowerCase\(\)\.includes\(q\)\)/, "reminders honor the text filter");
assert.match(auto, /a\.name\.toLowerCase\(\)\.includes\(q\)/, "automations honor the text filter");
assert.match(auto, /No matches for/, "automations show a no-matches message");
// The filter is scoped to the active tab — switching tabs clears it.
assert.match(auto, /setActiveTab\(tab\);\s*setQuery\(""\)/, "switching tabs clears the filter");

console.log("vault-automations-filter.test.ts OK");
