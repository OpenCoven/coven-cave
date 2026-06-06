// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/sidebar-minimal.css", import.meta.url), "utf8");

const addinsRule = styles.match(/\.sidebar-addins\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";

assert.ok(addinsRule, "Sidebar add-ins styles should exist");

assert.doesNotMatch(
  addinsRule,
  /border-top\s*:/,
  "Add-ins should rely on the primary sidebar-folders bottom border instead of adding a second divider",
);
