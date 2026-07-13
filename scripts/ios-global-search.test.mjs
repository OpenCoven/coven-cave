import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = await readFile(new URL("../apps/ios/CovenCave/CovenCave/Views/RootView.swift", import.meta.url), "utf8");
const view = await readFile(new URL("../apps/ios/CovenCave/CovenCave/Views/SearchView.swift", import.meta.url), "utf8");
const model = await readFile(new URL("../apps/ios/CovenCave/CovenCave/Models/CaveSearch.swift", import.meta.url), "utf8");
const app = await readFile(new URL("../apps/ios/CovenCave/CovenCave/State/AppModel.swift", import.meta.url), "utf8");
const chats = await readFile(new URL("../apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift", import.meta.url), "utf8");

assert.match(root, /Tab\(value: \.search, role: \.search\)/, "Search is a system-pinned search-role tab");
assert.match(root, /SearchView\(\)/, "the search tab renders the native search destination");
assert.match(root, /\.search/, "hardware-keyboard tab order includes search");
assert.match(root, /app\.deepLink == \.search && app\.connectionState != \.connected/, "deep-linked Search remains available while the desktop is offline");

assert.match(model, /enum CaveSearchScope:[\s\S]*case all, chats, tasks, reminders/, "search exposes four explicit scopes");
assert.match(model, /case familiar\(String\)/, "search results can open familiar thread lists");
assert.match(model, /case localThread\(String\)/, "search results can open local chats");
assert.match(model, /case serverSession\(String, familiarId: String\)/, "search results can open desktop sessions");
assert.match(model, /case task\(String\)/, "search results can open tasks");
assert.match(model, /case reminders/, "search results can open reminders");

assert.match(view, /\.searchable\(text: \$query/, "native search owns a system search field");
assert.match(view, /Picker\("Search scope"/, "native search provides an explicit scope picker");
assert.match(view, /ContentUnavailableView\.search\(text: query\)/, "no matches use the native unavailable state");
assert.match(view, /app\.deepLink = nil/, "offline Search provides a return to connection setup");
assert.match(view, /app\.requestOpenFamiliar/, "familiar results route through AppModel");
assert.match(view, /app\.requestOpenTask/, "task results route through AppModel");
assert.match(view, /offlineThreadId = id/, "local chat results stay navigable while Search is offline");
assert.match(view, /app\.deepLink = \.reminders/, "reminder results open the existing reminder surface");

assert.match(app, /var familiarToOpen: Familiar\?/, "AppModel carries a one-shot familiar navigation intent");
assert.match(app, /func requestOpenFamiliar/, "AppModel exposes familiar navigation");
assert.match(app, /enum DeepLink: String \{ case tasks, reminders, calendar, search \}/, "Search is a first-class app deep link");
assert.match(app, /case \.search: selectedTab = \.search/, "the Search deep link selects the pinned tab");
assert.match(chats, /app\.familiarToOpen/, "Chats consumes the familiar navigation intent");

console.log("ios-global-search.test.mjs: ok");
