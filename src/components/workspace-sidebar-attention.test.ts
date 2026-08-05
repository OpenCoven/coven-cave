// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/globals/shell-navigation.css", import.meta.url), "utf8");

assert.match(
  sidebar,
  /const attentionSessions = useMemo\(\s*\(\) =>\s*visibleSessions\s*\.filter\(\(session\) => session\.attention\.state !== "none" && !session\.archived_at\)\s*\.sort\(compareChatAttention\)/,
  "attentionSessions should derive from visible non-archived rows and sort by compareChatAttention",
);
assert.match(
  sidebar,
  /const attentionIds = useMemo\(\(\) => new Set\(attentionSessions\.map\(\(session\) => session\.id\)\), \[attentionSessions\]\);/,
  "attention ids should memoize the promoted rows",
);
assert.match(
  sidebar,
  /const recentSessions = useMemo\(\(\) => \{[\s\S]*?const rows = hasSearch \? visibleSessions : visibleSessions\.filter\(\(session\) => !attentionIds\.has\(session\.id\)\);[\s\S]*?return rows\.filter\(\(s\) => sessionRailTitle\(s\)\.toLowerCase\(\)\.includes\(q\)\);[\s\S]*?\}, \[visibleSessions, query, hasSearch, attentionIds\]\);/,
  "ordinary recent rows should drop promoted attention ids unless search is active",
);
assert.match(
  sidebar,
  /const attentionState = archived \? "none" : session\.attention\.state;[\s\S]*?chatAttentionLabel\(attentionState\)/,
  "ThreadRow should derive the visible attention label from the shared helper",
);
assert.match(
  sidebar,
  /archived \? null : chatAttentionDescription\(session\.attention, now\)/,
  "ThreadRow should derive the accessible attention description from the shared helper",
);
assert.match(
  sidebar,
  /const attentionState = archived \? "none" : session\.attention\.state;[\s\S]*?data-attention=\{attentionState\}/,
  "ThreadRow rows should expose their attention state to CSS",
);
assert.match(
  sidebar,
  /aria-describedby=\{attentionLabel \? attentionDescriptionId : undefined\}/,
  "attention rows should expose their description through the row button semantics",
);
assert.match(
  sidebar,
  /<span id=\{attentionDescriptionId\} className="cnav__attention">[\s\S]*?<span className="cnav__attention-dot" aria-hidden \/>[\s\S]*?<span>\{attentionLabel\}<\/span>[\s\S]*?<span className="sr-only">\{attentionDescription \? `\. \$\{attentionDescription\}` : ""\}<\/span>/,
  "attention rows should render a visible label plus a screen-reader sentence in the described content",
);
assert.match(
  sidebar,
  /function groupMeta\(group: ChatProjectGroup, now: number\): string \{[\s\S]*?const awaiting = group\.sessions\.filter\(\(session\) => session\.attention\.state !== "none" && !session\.archived_at\)\.length;[\s\S]*?return awaiting > 0 \? `\$\{awaiting\} awaiting · \$\{meta\}` : meta;/,
  "project group metadata should prefix a nonzero awaiting count",
);
const recentViewBlock = sidebar.match(/\{view === "recent" \? \([\s\S]*?\) : visibleGroups\.length === 0 \?/);
assert.ok(recentViewBlock, "recent view block should exist");
assert.match(
  recentViewBlock[0],
  /!hasSearch && attentionSessions\.length > 0[\s\S]*?<section aria-label="Awaiting you">[\s\S]*?<\/section>[\s\S]*?recentBuckets\.map/,
  "Awaiting you should render as a real labeled section before ordinary recent buckets only when search is inactive",
);
assert.match(
  recentViewBlock[0],
  /!hasSearch && attentionSessions\.length > 0 \? \(/,
  "search results should keep row cues without creating a separate attention section",
);

for (const state of ["left-hanging", "awaiting-human", "overdue-human"]) {
  assert.match(
    css,
    new RegExp(`\\.cnav__thread\\[data-attention="${state}"\\]`),
    `shell navigation should style ${state} rows`,
  );
}
assert.match(css, /\.cnav__attention\s*\{[\s\S]*?color:\s*var\(--color-warning\);/, "attention label should use warning text by default");
assert.match(css, /\.cnav__attention-dot\s*\{[\s\S]*?background:\s*var\(--color-warning\);/, "attention dot should use warning by default");
assert.match(css, /data-attention="left-hanging"[\s\S]*color-mix\(in oklch, var\(--color-warning\) 7%, transparent\)/, "left-hanging should use the subtle warning tint");
assert.match(css, /data-attention="awaiting-human"[\s\S]*color-mix\(in oklch, var\(--color-warning\) 14%, transparent\)/, "awaiting-human should use the warning fill tint");
assert.match(css, /data-attention="awaiting-human"[\s\S]*color-mix\(in oklch, var\(--color-warning\) (3[0-9]|4[0-5])%, var\(--border-hairline\)\)/, "awaiting-human should derive its warning border from color-mix");
assert.match(css, /data-attention="overdue-human"[\s\S]*background:\s*var\(--danger-bg\);/, "overdue-human should use the existing danger background token");
assert.match(css, /data-attention="overdue-human"[\s\S]*border-color:\s*var\(--danger-border\);/, "overdue-human should use the existing danger border token");
assert.match(css, /data-attention="overdue-human"[\s\S]*\.cnav__attention[\s\S]*color:\s*var\(--danger-text\);/, "overdue-human attention copy should use the danger text token");

console.log("workspace-sidebar-attention: ok");
