// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-project-familiars.ts", import.meta.url), "utf8");

assert.match(
  source,
  /ids\.length === 1 && Array\.isArray\(payload\.familiars\)[\s\S]*?\[ids\[0\]\]: payload\.familiars/,
  "the batch project-familiar hook accepts the API's single-project response shape",
);

console.log("project familiar hook response compatibility passed");
