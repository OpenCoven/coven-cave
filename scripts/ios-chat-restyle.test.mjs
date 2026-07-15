import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Chat restyle (cave-5y5q): the premium dark-first chat chrome — circular
// glass icon buttons, the header agent pill, the composer's floating "+"
// menu, the empty-state starter rows, and the Chats side drawer. These pins
// hold the STRUCTURE of the restyle (a11y labels, dismissal paths, sparse
// accent usage, reduced-motion guards); behavior pins (send/enqueue/reply)
// live in their own ios-*.test.mjs files and are deliberately untouched.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const chrome = await read("apps/ios/CovenCave/CovenCave/Theme/ChatChrome.swift");
const chatView = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
const drawer = await read("apps/ios/CovenCave/CovenCave/Views/ChatDrawer.swift");
const home = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");
const modelControl = await read("apps/ios/CovenCave/CovenCave/Views/ChatModelControl.swift");
const camera = await read("apps/ios/CovenCave/CovenCave/Views/CameraPicker.swift");

// ── Reusable chrome: every icon-only control is labelled; accent is scarce ──
assert.match(chrome, /struct CircularIconButton: View/, "circular icon button is a shared component");
assert.match(chrome, /\.accessibilityLabel\(label\)/, "circular icon buttons always carry an accessibility label");
assert.match(chrome, /\.accentGlow\(active: active\)/, "the accent halo only appears on active/selected state");
assert.match(chrome, /struct PillSelector<Leading: View>: View/, "pill selector is a shared component");
assert.match(chrome, /struct FloatingActionMenu: View/, "the composer + menu is a shared component");
assert.match(
  chrome,
  /onDismiss\(\)\s*\n\s*item\.action\(\)/,
  "floating-menu rows dismiss the menu on selection before acting",
);
assert.match(chrome, /struct DrawerRow: View/, "drawer rows are a shared component");
assert.match(chrome, /accessibilityAddTraits\(active \? \[\.isSelected\] : \[\]\)/, "active drawer row is exposed as selected to AT");
assert.match(chrome, /struct EmptyChatSuggestionRow: View/, "empty-state suggestion rows are a shared component");

// ── ChatView header: the agent pill opens the model/agent picker ────────────
assert.match(
  chatView,
  /PillSelector\(label: thread\.title,[\s\S]{0,200}?action: \{ Task \{ await switchModel\(""\) \} \}/,
  "the direct-chat agent pill opens the model picker via the existing /model path",
);
assert.match(chatView, /if thread\.isGroup \{[\s\S]{0,300}?chevron: false/, "group chats keep a static pill (no single model to switch)");
assert.doesNotMatch(chatView, /ChatModelBar\(thread:/, "the between-list model bar is retired — model access lives in the header pill");

// ── Composer "+" menu: fan-out + all three dismissal paths ───────────────────
assert.match(
  chatView,
  /FloatingAction\(id: "camera"[\s\S]{0,80}?showCamera = true/,
  "+ menu offers Camera",
);
assert.match(chatView, /FloatingAction\(id: "photos"[\s\S]{0,100}?showPhotosPicker = true/, "+ menu offers Photos");
assert.match(chatView, /FloatingAction\(id: "files"[\s\S]{0,80}?showFileImporter = true/, "+ menu offers Files");
assert.match(chatView, /FloatingAction\(id: "commands"[\s\S]{0,90}?showCommands = true/, "+ menu offers the Commands tool entry");
assert.match(
  chatView,
  /if showActionMenu \{\s*\n\s*Color\.black\.opacity\(0\.15\)[\s\S]{0,200}?onTapGesture \{ showActionMenu = false \}/,
  "outside tap on the dimmed transcript dismisses the + menu",
);
assert.match(
  chatView,
  /onKeyPress\(keys: \[\.escape\]\) \{ _ in\s*\n\s*guard showActionMenu else \{ return \.ignored \}\s*\n\s*showActionMenu = false/,
  "hardware Escape dismisses the + menu",
);
assert.match(chatView, /\.photosPicker\(isPresented: \$showPhotosPicker/, "Photos presents via the programmatic photosPicker modifier");
assert.match(chatView, /\.fileImporter\(isPresented: \$showFileImporter/, "Files presents via fileImporter");
assert.match(chatView, /func stage\(_ image: UIImage\)/, "camera/photos/files share one staging path");
assert.match(camera, /UIImagePickerController/, "camera capture wraps the system picker (no custom pipeline)");

// ── Empty state: starter rows FILL the composer (not auto-send) ─────────────
assert.match(
  chatView,
  /EmptyChatSuggestionRow\(systemImage: suggestion\.icon, label: suggestion\.label\) \{\s*\n\s*draft = suggestion\.label\s*\n\s*composerFocused = true/,
  "empty-state suggestions fill the composer for tweak-and-send",
);

// ── Model picker: current leads, deeper config is a chevron hop ──────────────
assert.match(modelControl, /Section\("Current"\)/, "the picker names the current model at the top");
assert.match(
  modelControl,
  /var onSwitchFamiliar: \(\(\) -> Void\)\? = nil/,
  "the agent hop is optional so other call sites are unaffected",
);
assert.match(modelControl, /Chat with another familiar/, "deeper agent configuration is reachable from the picker");
assert.match(chatView, /onSwitchFamiliar: \{ showFamiliarPicker = true \}/, "the picker's agent hop opens the familiar picker");

// ── Side drawer: search, sections, pinned, recents, New Chat, dismissals ─────
assert.match(drawer, /struct ChatDrawer: View/, "the drawer is its own component");
assert.match(drawer, /TextField\("Search chats", text: \$query\)/, "the drawer leads with search");
assert.match(drawer, /sectionHeader\("Sections"\)[\s\S]*?sectionHeader\("Pinned"\)[\s\S]*?sectionHeader\("Recent"\)/, "drawer groups: sections, pinned, recents — in that order");
assert.match(drawer, /app\.selectedTab = tab/, "primary sections route through the existing tab selection");
assert.match(drawer, /Label\("New Chat", systemImage: "square\.and\.pencil"\)/, "a floating New Chat button sits near the lower edge");
assert.match(drawer, /onTapGesture \{ close\(\) \}/, "the scrim closes the drawer on outside tap");
assert.match(drawer, /value\.translation\.width < -40 \{ close\(\) \}/, "a leftward drag closes the drawer");
assert.match(drawer, /Color\.black\.opacity\(isOpen \? 0\.45 : 0\)/, "the list behind stays visible through a dim scrim, not hidden");
assert.match(drawer, /reduceMotion \? nil : \.snappy/, "drawer animation respects reduced motion");

// ── Chats home: menu + compose are labelled circular controls ────────────────
assert.match(home, /CircularIconButton\(systemImage: "line\.3\.horizontal",[\s\S]{0,120}?label: "Menu"\)/, "the header menu button is a labelled circular control");
assert.match(home, /CircularIconButton\(systemImage: "square\.and\.pencil",\s*\n\s*label: "New chat"\)/, "the header compose button is a labelled circular control");
assert.match(home, /ChatDrawer\(isOpen: \$drawerOpen/, "the drawer overlays the chats home");
assert.match(home, /drawerOpen && !reduceMotion \? 16 : 0/, "the content offsets behind the open drawer (reduced-motion aware)");

console.log("ios-chat-restyle.test.mjs: ok");
