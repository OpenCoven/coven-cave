// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const actionMenu = readFileSync(new URL("./workspace-sidebar-action-menu.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// Shared adapter: one typed action contract, one item renderer, reused by both
// the persistent overflow trigger and the right-click context path.
assert.match(actionMenu, /export type WorkspaceSidebarAction = \{[\s\S]*id: string;[\s\S]*label: string;[\s\S]*icon: IconName;[\s\S]*onSelect: \(\) => void;[\s\S]*danger\?: boolean;[\s\S]*disabled\?: boolean;[\s\S]*\}/, "exports the typed shared WorkspaceSidebarAction contract");
assert.match(actionMenu, /function SidebarActionItems\(/, "action menu helper exposes one shared item renderer");
assert.ok((actionMenu.match(/<SidebarActionItems/g) ?? []).length === 2, "both menu adapters render the same action-item mapper");
assert.match(actionMenu, /export function SidebarOverflowMenu[\s\S]*<OverflowMenu[\s\S]*className="cnav__overflow"[\s\S]*placement="bottom-end"/, "overflow adapter uses the shared OverflowMenu with the stable cnav__overflow trigger");
assert.match(actionMenu, /export function SidebarContextMenu[\s\S]*<ContextMenu[\s\S]*ariaLabel=\{ariaLabel\}/, "context adapter uses the shared ContextMenu");
assert.match(actionMenu, /<ContextMenu[\s\S]*closeOnSelect[\s\S]*>\s*<SidebarActionItems actions=\{actions\} \/>/, "context adapter delegates enabled-item close + focus restore to ContextMenu");

// Thread rows: one action contract powers the persistent overflow and the
// right-click path, while the row's primary click / alt-open / drag behavior stays.
assert.match(sidebar, /rowInstanceKey: string;/, "thread rows require a stable row-instance key");
assert.match(sidebar, /const \[contextMenu, setContextMenu\] = useState<ContextMenuState>\(null\);/, "thread rows keep focused local ContextMenuState");
assert.match(sidebar, /onContextMenu=\{\(e\) => \{[\s\S]*openContextMenuAt\(setContextMenu\)\(e\);[\s\S]*\}\}/, "thread rows open the shared context menu from the stable row");
assert.match(sidebar, /const actions = compactActions\(\[[\s\S]*onOpenInSplit[\s\S]*\? \{[\s\S]*label: "Open in split"[\s\S]*: null,[\s\S]*label: pinned \? "Unpin" : "Pin"[\s\S]*label: "Delete"/, "thread rows define one typed action array with split, pin, and delete");
assert.match(sidebar, /onSelect: \(\) => \{[\s\S]*queueMicrotask\(onRequestDelete\);[\s\S]*\}/, "delete action waits for the menu close path, then starts confirmation");
assert.doesNotMatch(sidebar, /onSelect: \(\) => \{[\s\S]*setContextMenu\(null\);[\s\S]*queueMicrotask\(onRequestDelete\);[\s\S]*\}/, "delete action no longer bypasses ContextMenu's close + focus restoration");
assert.match(sidebar, /useEffect\(\(\) => \{[\s\S]*if \(confirming\) setContextMenu\(null\);[\s\S]*\}, \[confirming\]\)/, "thread rows force-close the context menu while confirming");
assert.match(sidebar, /state=\{confirming \? null : contextMenu\}/, "confirming rows hide the context menu entirely");
assert.match(sidebar, /const confirmCancelRef = useRef<HTMLButtonElement \| null>\(null\);/, "thread rows keep a stable inline confirmation focus target");
assert.match(sidebar, /useLayoutEffect\(\(\) => \{[\s\S]*if \(confirming\) confirmCancelRef\.current\?\.focus\(\);[\s\S]*\}, \[confirming\]\)/, "delete confirmation moves focus onto the inline cancel button");
assert.match(sidebar, /<button type="button" ref=\{confirmCancelRef\} onClick=\{onCancelDelete\} className="cnav__confirm-cancel focus-ring">/, "Cancel is the stable inline confirmation control");
assert.match(sidebar, /<SidebarOverflowMenu ariaLabel=\{`Chat actions for \$\{title\}`\} actions=\{actions\} \/>/, "thread rows expose a persistent title-specific overflow trigger");
assert.match(sidebar, /<SidebarContextMenu[\s\S]*state=\{confirming \? null : contextMenu\}[\s\S]*onClose=\{\(\) => setContextMenu\(null\)\}[\s\S]*ariaLabel=\{`Chat actions for \$\{title\}`\}[\s\S]*actions=\{actions\}/, "thread rows reuse the same actions for the right-click context path when not confirming");
assert.match(sidebar, /if \(e\.altKey && onOpenInSplit\) \{[\s\S]*onOpenInSplit\(\);/, "alt-click split behavior stays intact");
assert.match(sidebar, /if \(e\.key === "Enter" && e\.altKey && onOpenInSplit\) \{/, "alt-enter split behavior stays intact");
assert.match(sidebar, /draggable=\{Boolean\(onOpenInSplit\)\}/, "whole-row drag-to-split stays intact");
assert.match(sidebar, /const \[confirmingDelete, setConfirmingDelete\] = useState<\{ rowKey: string; sessionId: string \} \| null>\(null\);/, "workspace sidebar tracks the invoking row instance and the session being deleted");

// Pinned rows render through the same ThreadRow contract rather than their own
// always-visible bookmark button.
const pinStart = sidebar.indexOf('aria-label="Pinned threads"');
const pinEnd = sidebar.indexOf('view === "recent"', pinStart);
assert.ok(pinStart !== -1 && pinEnd > pinStart, "pinned rail section exists before the recent view");
const pinnedRail = sidebar.slice(pinStart, pinEnd);
assert.match(pinnedRail, /<ThreadRow[\s\S]*rowInstanceKey=\{`pinned:\$\{session\.id\}`\}[\s\S]*pinned[\s\S]*confirming=\{confirmingDelete\?\.rowKey === `pinned:\$\{session\.id\}`\}[\s\S]*onTogglePin=\{\(\) => handlePinnedRailUnpin\(session\.id\)\}[\s\S]*onRequestDelete=\{\(\) => setConfirmingDelete\(\{ rowKey: `pinned:\$\{session\.id\}`, sessionId: session\.id \}\)\}/, "pinned rows render through ThreadRow with their own stable confirmation key and dedicated unpin focus handoff");
assert.doesNotMatch(pinnedRail, /aria-label=\{`Unpin \$\{title\}`\}/, "pinned rows no longer render a dedicated bookmark button");

// Project headers also share overflow + context actions from one definition.
assert.match(sidebar, /const projectHeaderActions = compactActions\(\[[\s\S]*unregistered[\s\S]*\? \{[\s\S]*label: "Register project"[\s\S]*disabled: registering[\s\S]*: null,[\s\S]*label: "New chat"/, "project headers define register/new-chat actions from one typed array");
assert.match(sidebar, /<SidebarOverflowMenu[\s\S]*ariaLabel=\{`Project actions for \$\{label\}`\}[\s\S]*actions=\{projectHeaderActions\}/, "project headers expose a persistent overflow trigger");
assert.match(sidebar, /<SidebarContextMenu[\s\S]*state=\{projectContextKey === key \? projectContextMenu : null\}[\s\S]*ariaLabel=\{`Project actions for \$\{label\}`\}[\s\S]*actions=\{projectHeaderActions\}/, "project headers reuse the same actions for right-click context");
assert.doesNotMatch(sidebar, /Register \$\{label\} as a project[\s\S]*className="cnav__icon-btn/, "the separate hover-only register button is removed");
assert.doesNotMatch(sidebar, /New chat in \$\{label\}[\s\S]*className="cnav__icon-btn/, "the separate hover-only new-chat button is removed");
assert.match(sidebar, /<ThreadRow[\s\S]*rowInstanceKey=\{`recent:\$\{session\.id\}`\}[\s\S]*confirming=\{confirmingDelete\?\.rowKey === `recent:\$\{session\.id\}`\}[\s\S]*onRequestDelete=\{\(\) => setConfirmingDelete\(\{ rowKey: `recent:\$\{session\.id\}`, sessionId: session\.id \}\)\}/, "recent rows confirm only the invoking copy");
assert.match(sidebar, /<ThreadRow[\s\S]*rowInstanceKey=\{`project:\$\{session\.id\}`\}[\s\S]*confirming=\{confirmingDelete\?\.rowKey === `project:\$\{session\.id\}`\}[\s\S]*onRequestDelete=\{\(\) => setConfirmingDelete\(\{ rowKey: `project:\$\{session\.id\}`, sessionId: session\.id \}\)\}/, "project rows confirm only the invoking copy");
assert.match(sidebar, /<ThreadRow[\s\S]*rowInstanceKey=\{`recent:\$\{session\.id\}`\}[\s\S]*onTogglePin=\{\(\) => togglePin\(session\.id\)\}/, "recent rows keep the normal pin toggle path");
assert.match(sidebar, /<ThreadRow[\s\S]*rowInstanceKey=\{`project:\$\{session\.id\}`\}[\s\S]*onTogglePin=\{\(\) => togglePin\(session\.id\)\}/, "project rows keep the normal pin toggle path");

// Hover-only action markup and hover geometry hacks are retired.
assert.doesNotMatch(sidebar, /cnav__row-actions|cnav__icon-btn/, "workspace sidebar markup no longer uses hover-only row-action wrappers");
assert.doesNotMatch(css, /\.cnav__icon-btn|\.cnav__row-actions/, "hover-only row-action CSS is removed");
assert.doesNotMatch(css, /\.cnav__thread:hover \.cnav__time/, "hover no longer hides timestamps");
assert.doesNotMatch(css, /\.cnav__thread:hover \.cnav__thread-main/, "hover no longer changes row geometry");
assert.match(css, /\.cnav__overflow \{[\s\S]*opacity: 0\.[0-9]+/, "overflow trigger stays quietly visible by default");
assert.match(css, /\.cnav__thread:hover \.cnav__overflow,[\s\S]*\.cnav__group-head:hover \.cnav__overflow,[\s\S]*\.cnav__overflow:focus-visible,[\s\S]*\.cnav__overflow\.ui-icon-btn--active \{[\s\S]*opacity: 1;/, "overflow trigger becomes fully opaque on hover, focus, or open");
assert.doesNotMatch(css, /data-\[state=open\]|data-open/, "overflow styling keys off the actual IconButton active class, not a nonexistent data attribute");

console.log("workspace-sidebar-actions: ok");
