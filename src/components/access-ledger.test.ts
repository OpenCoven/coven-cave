import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The access ledger (#5897): one row grammar for every surface that decides
// who may reach the Cave. These pins keep the three panels on it, keep the
// seal's motion honest, and keep destructive actions behind a named confirm.

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const ledger = read("./access-ledger.tsx");
const css = read("../styles/access-ledger.css");
const clientAccess = read("./settings-client-access.tsx");
const deviceAccess = read("./settings-device-access.tsx");
const accessGroups = read("./access-groups-section.tsx");

test("the three access surfaces share one ledger", () => {
  for (const [name, source] of [["client access", clientAccess], ["device access", deviceAccess]] as const) {
    assert.match(source, /from "@\/components\/access-ledger"/, `${name} imports the shared ledger`);
    assert.match(source, /<AccessRow/, `${name} renders records as ledger rows`);
    assert.match(source, /<AccessStatus tone=/, `${name} pairs every seal with a status word`);
  }
  assert.match(accessGroups, /import "@\/styles\/access-groups\.css"/, "access groups own their stylesheet");
  assert.match(ledger, /import "@\/styles\/access-ledger\.css"/, "the ledger owns its stylesheet");
});

test("the seal breathes only while a request waits on the human, and holds still under reduced motion", () => {
  assert.match(css, /\.access-seal\[data-live="true"\] \{\s*animation: access-seal-breathe/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.access-seal\[data-live="true"\] \{\s*animation: none;/);
  assert.match(clientAccess, /live=\{pending\}/, "a client request is live only while pending");
  assert.match(deviceAccess, /live=\{pending\}/, "a device request is live only while pending");
  assert.doesNotMatch(clientAccess, /live(?:=\{true\}|\s*\n)/, "nothing is live unconditionally");
});

test("the device request code leads its row", () => {
  assert.match(deviceAccess, /lead=\{<AccessCode label="Request code" code=\{device\.id\.slice\(-8\)\} \/>\}/);
});

test("revoking and deleting name the object and the consequence before they happen", () => {
  for (const [name, source, label] of [
    ["client access", clientAccess, "Revoke access"],
    ["device access", deviceAccess, "Revoke access"],
    ["access groups", accessGroups, "Delete group"],
  ] as const) {
    assert.match(source, /useOptionalConfirm\(\)/, `${name} asks through the shared dialog when a provider is present`);
    assert.match(source, new RegExp(`confirmLabel: "${label}",\\s*danger: true`), `${name} keeps one verb through the flow`);
  }
  assert.match(deviceAccess, /decision === "revoked" && confirm/, "allow and deny stay one tap; only revoke confirms");
});

test("timestamps read as relative phrases and stay machine-readable", () => {
  assert.match(ledger, /relativeTimeSigned\(iso, now, prefs\.density\)/);
  assert.match(ledger, /<time dateTime=\{iso\} title=\{exact\}>/);
  assert.doesNotMatch(clientAccess, /toLocaleString|toISOString\(\)\.replace/, "no raw clock strings on client access");
  assert.doesNotMatch(deviceAccess, /toLocaleString/, "no raw clock strings on device access");
});

test("the ledger sheet spaces, sizes and rounds with tokens only", () => {
  const decl = /^\s*(padding|margin|gap|row-gap|column-gap|font-size|border-radius)(?:-[a-z]+)?\s*:\s*([^;]+);/gm;
  for (const [, prop, value] of css.matchAll(decl)) {
    const parts = value.split(/\s+/);
    for (const part of parts) {
      assert.ok(
        part === "0" || part.startsWith("var(--") || part === "auto" || part === "inherit",
        `${prop}: ${value} — use a token`,
      );
    }
  }
});
