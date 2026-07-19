// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");

assert.match(
  sidebar,
  /const rowButtonRefs = useRef\(new Map<string, HTMLButtonElement>\(\)\);/,
  "workspace sidebar keeps stable primary-row refs keyed by session id",
);
assert.match(
  sidebar,
  /const \[pendingPinnedRailFocusSessionId, setPendingPinnedRailFocusSessionId\] = useState<string \| null>\(null\);/,
  "workspace sidebar tracks pending focus restoration only for pinned-rail unpins",
);
assert.match(
  sidebar,
  /const registerRowButton = useCallback\(\(sessionId: string, el: HTMLButtonElement \| null\) => \{/,
  "workspace sidebar exposes a stable row-button ref registrar",
);
assert.match(
  sidebar,
  /useEffect\(\(\) => \{[\s\S]*if \(!pendingPinnedRailFocusSessionId\) return;[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*rowButtonRefs\.current\.get\(pendingPinnedRailFocusSessionId\)[\s\S]*target\.focus\(\);[\s\S]*setPendingPinnedRailFocusSessionId\(null\);[\s\S]*\}\);[\s\S]*\}, \[pendingPinnedRailFocusSessionId\]\);/,
  "pinned-rail focus restoration waits until the post-update frame and guards missing rows",
);
assert.match(
  sidebar,
  /const handlePinnedRailUnpin = useCallback\(\(sessionId: string\) => \{[\s\S]*setPendingPinnedRailFocusSessionId\(sessionId\);[\s\S]*toggleStoredPinnedSession\(sessionId\);[\s\S]*\}, \[\]\);/,
  "only the pinned-rail unpin path schedules surviving-row focus",
);
assert.match(
  sidebar,
  /<ThreadRow[\s\S]*rowInstanceKey=\{`pinned:\$\{session\.id\}`\}[\s\S]*onTogglePin=\{\(\) => handlePinnedRailUnpin\(session\.id\)\}/,
  "pinned rows use the dedicated unpin focus-restoration path",
);
assert.match(
  sidebar,
  /<ThreadRow[\s\S]*rowButtonRef=\{\(el\) => registerRowButton\(session\.id, el\)\}/,
  "non-pinned rows register their primary button refs for focus restoration",
);

console.log("workspace-sidebar-focus.test.ts passed");
