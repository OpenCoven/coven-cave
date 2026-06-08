// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");

const addinsRule = styles.match(/\.sidebar-addins\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
const footerRules = [...styles.matchAll(/\.sidebar-actions--footer\s*\{(?<body>[^}]*)\}/g)];
const lastFooterRule = footerRules.at(-1)?.groups?.body ?? "";

assert.ok(addinsRule, "Sidebar add-ins styles should exist");

assert.doesNotMatch(
  addinsRule,
  /border-top\s*:/,
  "Add-ins should rely on the primary sidebar-folders bottom border instead of adding a second divider",
);

assert.doesNotMatch(
  addinsRule,
  /margin-top\s*:\s*auto/,
  "Add-ins should sit directly below the main side-panel options instead of being pushed to the footer",
);

assert.match(
  source,
  /<div className="sidebar-nav-scroll">/,
  "Sidebar should keep the main navigation in one continuous scrollable rail",
);

assert.match(
  source,
  /\{ id: "agents",\s+label: "Chats"/,
  "Sidebar should expose Chats as the familiar chat browser",
);

assert.match(
  source,
  /\{ id: "sessions",\s+label: "Sessions"/,
  "Sidebar should expose Sessions as a top-level cross-harness session browser",
);

assert.match(
  source,
  /fm\.id === "agents" \|\| fm\.id === "sessions" \|\| fm\.id === "board"/,
  "Sidebar Work section should include Chats, Sessions, and Tasks",
);

assert.match(
  source,
  /<SidebarSection label="Manage" className="sidebar-actions sidebar-actions--footer">/,
  "Utility navigation should sit with the main sidebar sections instead of floating at the bottom",
);

assert.match(
  lastFooterRule,
  /margin-top\s*:\s*0/,
  "Final footer styles should prevent the utility section from creating a large empty gap",
);

assert.match(
  styles,
  /\.sidebar-foot-bell,\n\.sidebar-foot-btn/,
  "Notifications and settings should share the same footer row treatment",
);

assert.match(
  source,
  /sidebar-foot-icon-cell/,
  "Settings should use the same fixed footer icon cell as notifications",
);

assert.match(
  styles,
  /\.sidebar-foot-bell > \.relative,\n\.sidebar-foot-icon-cell/,
  "Footer rows should align labels from matching icon cells",
);
