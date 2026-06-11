// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./pwa-register.tsx", import.meta.url), "utf8");

assert.match(
  src,
  /process\.env\.NODE_ENV === "development"/,
  "dev mode should be handled explicitly",
);
assert.match(
  src,
  /getRegistrations\(\)[\s\S]*unregister\(\)/,
  "dev mode should unregister existing service workers",
);
assert.match(
  src,
  /caches[\s\S]*\.keys\(\)[\s\S]*covencave-pwa[\s\S]*caches\.delete/,
  "dev mode should clear stale CovenCave PWA caches",
);

const devBranch = src.indexOf('process.env.NODE_ENV === "development"');
const firstRegister = src.indexOf('register("/sw.js"');
const firstReturnAfterDevBranch = src.indexOf("return;", devBranch);
assert.ok(
  devBranch !== -1 && firstReturnAfterDevBranch > devBranch && firstReturnAfterDevBranch < firstRegister,
  "dev mode should return before registering the PWA service worker",
);

console.log("pwa-register.test.ts OK");
