import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The connection setup screen — the first thing a new user hits — should help
// them get the address in: a Paste affordance (clipboard only read on tap, so no
// surprise "pasted from" banner), input cleanup, and a gentle malformed hint.

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const src = await read("apps/ios/CovenCave/CovenCave/Views/ConnectionView.swift");

// --- Paste affordance, gated on clipboard contents (no eager read) -----------
assert.match(src, /@State private var canPaste = false/, "should track whether the clipboard has text");
assert.match(
  src,
  /canPaste = UIPasteboard\.general\.hasStrings/,
  "the Paste button should be gated on hasStrings (no eager clipboard read)",
);
assert.match(
  src,
  /if canPaste \{[\s\S]*?Button\(action: pasteHost\) \{[\s\S]*?Label\("Paste", systemImage: "doc\.on\.clipboard"\)/,
  "a Paste button should appear when the clipboard has text",
);
assert.match(
  src,
  /func pasteHost\(\) \{[\s\S]*?UIPasteboard\.general\.string[\s\S]*?apply\(pasted\)/,
  "pasteHost should read the clipboard only on the explicit tap and route it through the invite parser",
);
assert.match(
  src,
  /func apply\(_ input: String\) \{[\s\S]*?CaveInvite\.parse\(cleanHost\(input\)\)/,
  "any input — typed, pasted, or scanned — is cleaned then parsed as an invite (host + optional credential)",
);

// --- Cleanup: trim + strip wrapping quotes/trailing slash, KEEP the scheme ----
assert.match(
  src,
  /func cleanHost\(_ raw: String\) -> String \{[\s\S]*?trimmingCharacters\(in: \.whitespacesAndNewlines\)[\s\S]*?hasSuffix\("\/"\)/,
  "cleanHost should trim whitespace and strip a trailing slash",
);
assert.match(
  src,
  /CaveInvite\.parse\(cleanHost\(host\)\)/,
  "connect should clean and invite-parse the host before configuring",
);

// --- Gentle, non-blocking malformed hint -------------------------------------
assert.match(
  src,
  /private var hostHint: String\? \{[\s\S]*?contains\(" "\)/,
  "a hostHint should nudge when the address has a stray space",
);
// The hint must NOT disable Connect — validation stays advisory (the connect flow
// does the real probing); the button stays gated only on empty/busy.
assert.match(
  src,
  /\.disabled\(host\.trimmingCharacters\(in: \.whitespaces\)\.isEmpty \|\| busy\)/,
  "Connect should stay enabled regardless of the advisory hint",
);

console.log("ios-connect-paste: OK");
