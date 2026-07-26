import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const model = await read(`${iosRoot}/State/AppModel.swift`);
const share = await read(`${iosRoot}/Views/ShareSheet.swift`);
const settings = await read(`${iosRoot}/Views/SettingsView.swift`);

// Model zips every thread's Markdown via NSFileCoordinator (no dependency).
assert.match(model, /func exportAllThreadsZip\(\) throws -> URL/, "AppModel should zip all threads");
assert.match(model, /for thread in threads \{[\s\S]*exportMarkdown\(thread\)\s*\.write\(to: staging/, "writes each thread's Markdown");
assert.match(model, /NSFileCoordinator\(\)\.coordinate\(readingItemAt: staging, options: \.forUploading/, "zips via NSFileCoordinator .forUploading");
assert.match(model, /while used\.contains\(name\.lowercased\(\)\)/, "de-duplicates filenames");

// Reusable share-sheet wrapper.
assert.match(share, /struct ActivityView: UIViewControllerRepresentable/, "an ActivityView wrapper should exist");
assert.match(share, /UIActivityViewController\(activityItems: items/, "wraps UIActivityViewController");
assert.match(share, /struct ExportArchive: Identifiable/, "an Identifiable archive wrapper should exist");

// Settings exposes the export, disabled when there are no chats, sharing the zip.
assert.match(settings, /Label\("Export all chats", systemImage: "square\.and\.arrow\.up\.on\.square"\)/, "Settings should offer Export all chats");
assert.match(settings, /ExportArchive\(url: try app\.exportAllThreadsZip\(\)\)/, "the button builds the archive");
assert.match(settings, /\.disabled\(app\.threads\.isEmpty\)/, "export is disabled with no chats");
assert.match(settings, /\.sheet\(item: \$exportArchive\) \{ archive in\s*ActivityView\(items: \[archive\.url\]\)/, "shares the zip via the activity sheet");

console.log("ios-export-all-zip.test.mjs: ok");
