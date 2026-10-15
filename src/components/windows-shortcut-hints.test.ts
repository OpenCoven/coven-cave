// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Windows and Linux hosts used to read macOS glyphs (⌘ ⌥ ⇧ ↵) in labels that
// were authored as literals (#5970). Each site below now routes its hint
// through `platformizeHint` or reads `keys.mod` / `keys.enter` from
// `useKeySymbols`, so this pins both halves per site: the literal is gone
// from the rendered label, and the platformizer is called with the
// Mac-canonical hint instead.

const read = (relative: string) => readFile(new URL(relative, import.meta.url), "utf8");

const undoToast = await read("./ui/undo-toast.tsx");
assert.doesNotMatch(undoToast, /aria-hidden>⌘Z<\/kbd>/, "UndoToast no longer hard-codes ⌘Z");
assert.match(undoToast, /platformizeHint\("⌘Z", keys\)/, "UndoToast platformizes the Undo shortcut");

const chatFindBand = await read("./chat-find-band.tsx");
assert.doesNotMatch(chatFindBand, /cave-find-band__kbd">⌘K</, "ChatFindBand no longer hard-codes ⌘K");
assert.match(chatFindBand, /platformizeHint\("⌘K", keys\)/, "ChatFindBand platformizes the palette hint");

const artifactViewer = await read("./chat-artifact-viewer.tsx");
assert.doesNotMatch(artifactViewer, /refine-hint">⌘↵ to refine</, "ChatArtifactViewer no longer hard-codes the refine hint");
assert.match(artifactViewer, /platformizeHint\("⌘↵ to refine", keys\)/, "ChatArtifactViewer platformizes the refine hint");

const trayQuickChat = await read("./tray-quick-chat.tsx");
assert.doesNotMatch(trayQuickChat, /title="Close chat \(⌘W\)"|title="New chat \(⌘N\)"|familiars · ⌘N new chat/, "TrayQuickChat no longer hard-codes its ⌘W / ⌘N hints");
assert.match(trayQuickChat, /platformizeHint\("Close chat \(⌘W\)", keys\)[\s\S]*platformizeHint\("New chat \(⌘N\)", keys\)[\s\S]*platformizeHint\("⌘N new chat", keys\)/, "TrayQuickChat platformizes every tab hint");

const needsYou = await read("./needs-you-popover.tsx");
assert.doesNotMatch(needsYou, /title=\{count > 0 \? `Needs you, \$\{count\} · ⇧⌘A` : "Needs you · ⇧⌘A"\}/, "NeedsYouPopover no longer renders ⇧⌘A verbatim");
assert.match(needsYou, /title=\{platformizeHint\(count > 0 \? `Needs you, \$\{count\} · ⇧⌘A` : "Needs you · ⇧⌘A", keys\)\}/, "NeedsYouPopover platformizes the inbox shortcut");

const chatView = await read("./chat-view.tsx");
assert.doesNotMatch(chatView, /title="Find in conversation \(⌘F\)"/, "ChatView no longer hard-codes the find hint");
assert.match(chatView, /platformizeHint\("Find in conversation \(⌘F\)", keys\)/, "ChatView platformizes the find hint");

const canvasAddTile = await read("./canvas-add-tile.tsx");
assert.doesNotMatch(canvasAddTile, /\? "Refine preview \(⌘↵\)"|\? "Create preview \(⌘↵\)"|sketch this · ⌘↵ to run</, "CanvasAddTile no longer hard-codes its ⌘↵ hints");
assert.match(canvasAddTile, /platformizeHint\("Refine preview \(⌘↵\)", keys\)[\s\S]*platformizeHint\("Create preview \(⌘↵\)", keys\)[\s\S]*platformizeHint\("⌘↵ to run", keys\)/, "CanvasAddTile platformizes every ⌘↵ hint");

const browserPane = await read("./browser-pane.tsx");
assert.doesNotMatch(browserPane, /title="Address bar \(⌘L\)"|^\s*⌘L address · ⌘K tabs/m, "BrowserPane no longer hard-codes its shortcut strip");
assert.match(browserPane, /platformizeHint\("Address bar \(⌘L\)", keys\)[\s\S]*platformizeHint\("⌘L address · ⌘K tabs · ⌘\[ back · ⌘\] forward · ⌘R reload", keys\)/, "BrowserPane platformizes the address bar hint and footer strip");

const repoViewer = await read("./role-surfaces/research-github-repo-viewer.tsx");
assert.doesNotMatch(repoViewer, /<kbd>\{shortcut\.keys\}<\/kbd>|<kbd>⌘B<\/kbd>|<kbd>⌘⇧U<\/kbd>|title="[^"]*[⌘⌥⇧↵][^"]*"|: "Open on GitHub  ⌘↵";/, "ResearchGithubRepoViewer no longer renders a Mac glyph verbatim");
assert.match(repoViewer, /platformizeHint\("⌘B", keys\)[\s\S]*platformizeHint\("⌘⇧U", keys\)[\s\S]*platformizeHint\(shortcut\.keys, keys\)/, "ResearchGithubRepoViewer platformizes the shortcuts sheet and overflow menu");
assert.match(repoViewer, /platformizeHint\("Copy repository URL  ⌘⇧U", keys\)[\s\S]*platformizeHint\("Hide file browser  ⌘\\\\", keys\)[\s\S]*platformizeHint\("Show file browser  ⌘\\\\", keys\)[\s\S]*platformizeHint\("Copy path  ⌘⇧C", keys\)[\s\S]*platformizeHint\("Soft wrap  ⌥Z", keys\)/, "ResearchGithubRepoViewer platformizes every tooltip");

const sidebarMinimal = await read("./sidebar-minimal.tsx");
assert.doesNotMatch(sidebarMinimal, /newChatTitle="New chat \(⌘N\)"|rail-header__new-kbd">⌘N<|\(\$\{kbd\}\)/, "SidebarMinimal no longer hard-codes ⌘N or the raw destination kbd");
assert.match(sidebarMinimal, /platformizeHint\(kbd, keys\)[\s\S]*platformizeHint\("New chat \(⌘N\)", keys\)[\s\S]*platformizeHint\("⌘N", keys\)/, "SidebarMinimal platformizes row titles and the New chat hint");

const analyticsShell = await read("./analytics-page-shell.tsx");
assert.doesNotMatch(analyticsShell, /\(\$\{item\.kbd\}\)/, "AnalyticsPageShell no longer renders the raw destination kbd");
assert.match(analyticsShell, /platformizeHint\(item\.kbd, keys\)/, "AnalyticsPageShell platformizes destination titles");

const settingsProfile = await read("./settings-profile.tsx");
assert.doesNotMatch(settingsProfile, /settings-profile__shortcut">⌘S save</, "ProfileSection no longer hard-codes ⌘S save");
assert.match(settingsProfile, /platformizeHint\("⌘S save", keys\)/, "ProfileSection platformizes the save hint");

const githubView = await read("./github-view.tsx");
assert.doesNotMatch(githubView, /placeholder="Reply… \(⌘↵ to send\)"|title="Refresh \(⌘R\)"/, "GitHubView no longer hard-codes its reply and refresh hints");
assert.match(githubView, /platformizeHint\("Reply… \(⌘↵ to send\)", keys\)[\s\S]*platformizeHint\("Refresh \(⌘R\)", keys\)/, "GitHubView platformizes the reply placeholder and refresh title");

const cardComposer = await read("./github-card-composer.tsx");
assert.doesNotMatch(cardComposer, /: "⌘↵"\}|foot-key">↵</, "GitHubCardComposer no longer hard-codes ⌘↵ or ↵");
assert.match(cardComposer, /foot-key">\{keys\.enter\}<[\s\S]*: platformizeHint\("⌘↵", keys\)\}/, "GitHubCardComposer platformizes the send hint and the run key");

const navigator = await read("./role-surfaces/navigator-surface.tsx");
assert.doesNotMatch(navigator, /cr-help__body">\{body\}<|in this session\) — ⌘Z`\s*:/, "NavigatorSurface no longer renders help copy or the undo title verbatim");
assert.match(navigator, /platformizeHint\(body, keys\)[\s\S]*platformizeHint\(`Undo the last chart edit \(\$\{history\.length\} in this session\) — ⌘Z`, keys\)/, "NavigatorSurface platformizes help copy and the undo title");

const familiarMultiSelect = await read("./automation-familiar-select.tsx");
assert.doesNotMatch(familiarMultiSelect, /⌘-click/, "FamiliarMultiSelect no longer hard-codes ⌘-click");
assert.match(familiarMultiSelect, /\$\{keys\.mod\}-click to multi-select[\s\S]*\{keys\.mod\}-click to combine/, "FamiliarMultiSelect reads the modifier from useKeySymbols");

const familiarCarousel = await read("./automations/familiar-carousel.tsx");
assert.doesNotMatch(familiarCarousel, /(aria-label|__role">)[^\n]*⌘-click/, "FamiliarCarousel no longer hard-codes ⌘-click in rendered copy");
assert.match(familiarCarousel, /\$\{keys\.mod\}-click to combine\.[\s\S]*\{keys\.mod\}-click cards/, "FamiliarCarousel reads the modifier from useKeySymbols");

const familiarSwitcher = await read("./familiar-switcher.tsx");
assert.doesNotMatch(familiarSwitcher, /checkbox or ⌘-click multi-selects/, "FamiliarSwitcher no longer hard-codes ⌘-click");
assert.match(familiarSwitcher, /checkbox or \$\{keys\.mod\}-click multi-selects/, "FamiliarSwitcher reads the modifier from useKeySymbols");

const boardGantt = await read("./board-gantt.tsx");
assert.doesNotMatch(boardGantt, /(aria-label|title)=[^\n]*⌘-scroll/, "BoardGantt no longer hard-codes ⌘-scroll in rendered copy");
assert.match(boardGantt, /pinch \/ \$\{keys\.mod\}-scroll the timeline[\s\S]*pinch \/ \$\{keys\.mod\}-scroll to zoom freely/, "BoardGantt reads the modifier from useKeySymbols");

const browserQuickOpen = await read("./browser-quick-open.tsx");
assert.doesNotMatch(browserQuickOpen, />⌘<\/span>|>↵<\/span>|>↵ open</, "BrowserQuickOpen no longer hard-codes ⌘ or ↵");
assert.match(browserQuickOpen, /\{keys\.mod\}<\/span>[\s\S]*\{keys\.enter\}<\/span>[\s\S]*\{keys\.enter\} open</, "BrowserQuickOpen reads its glyphs from useKeySymbols");

const shell = await read("./shell.tsx");
assert.doesNotMatch(shell, /= labelPanelShortcut\(panelShortcuts\.toggle(Left|Right)Panel\);/, "Shell no longer renders the Mac-canonical panel labels verbatim");
assert.match(shell, /platformizeHint\(labelPanelShortcut\(panelShortcuts\.toggleLeftPanel\), keys\)[\s\S]*platformizeHint\(labelPanelShortcut\(panelShortcuts\.toggleRightPanel\), keys\)/, "Shell platformizes both panel toggle labels");

const terminalWorkspace = await read("./code-terminal-workspace.tsx");
assert.doesNotMatch(terminalWorkspace, /\(\$\{CODE_ROOM_SHORTCUT_HINTS\["[a-z-]+"\]\}\)/, "CodeTerminalWorkspace no longer renders the Mac-canonical room hints verbatim");
assert.match(terminalWorkspace, /platformizeHint\(CODE_ROOM_SHORTCUT_HINTS\["close-terminal"\], keys\)[\s\S]*platformizeHint\(CODE_ROOM_SHORTCUT_HINTS\["split-right"\], keys\)[\s\S]*platformizeHint\(CODE_ROOM_SHORTCUT_HINTS\["split-down"\], keys\)[\s\S]*platformizeHint\(CODE_ROOM_SHORTCUT_HINTS\["toggle-broadcast"\], keys\)/, "CodeTerminalWorkspace platformizes every room shortcut tooltip");

console.log("windows-shortcut-hints.test.ts: ok");
