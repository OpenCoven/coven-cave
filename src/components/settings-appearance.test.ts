// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settings = await readFile(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);
const themeScript = await readFile(
  new URL("./theme-script.tsx", import.meta.url),
  "utf8",
);

assert.match(
  settings,
  /aria-pressed=\{active\}/,
  "Theme preset cards should expose their selected state to assistive tech",
);

assert.doesNotMatch(
  settings,
  /url\.hostname\.endsWith\("tweakcn\.com"\)/,
  "tweakcn import should not allow attacker-controlled tweakcn.com suffix hosts",
);

assert.match(
  settings,
  /hostname === "tweakcn\.com"[\s\S]*hostname\.endsWith\("\.tweakcn\.com"\)/,
  "tweakcn import should allow only tweakcn.com or real tweakcn.com subdomains",
);

assert.match(
  settings,
  /encodeURIComponent\(themeId\)/,
  "tweakcn /r/themes/{id} imports should URL-encode the theme id",
);

assert.match(
  settings,
  /encodeURIComponent\(themeName\)/,
  "tweakcn editor imports should URL-encode the theme name",
);

assert.match(
  themeScript,
  /existingStyle\.endsWith\(";"\)/,
  "ThemeScript should preserve valid CSS when appending custom vars to existing inline style",
);
