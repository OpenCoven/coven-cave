import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./button.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

assert.match(source, /<span\s+className=\{`ui-btn-spinner\$\{loading \? " is-visible" : ""\}`\}/, "Button keeps the loading spinner mounted and toggles it with a class");
assert.doesNotMatch(source, /loading \? <span className="ui-btn-spinner"/, "Button must not insert the spinner only while loading");
assert.doesNotMatch(source, /!loading && leadingIcon/, "Button must not unmount the leading icon slot while loading");
assert.doesNotMatch(source, /!loading && trailingIcon/, "Button must not unmount the trailing icon slot while loading");
assert.match(source, /ui-btn-icon-slot\$\{loading \? " is-hidden" : ""\}/, "Button hides configured icon slots with CSS during loading");
assert.match(styles, /\.ui-btn-spinner\.is-visible\s*\{[\s\S]*display:\s*inline-block/, "Button spinner visibility is class-driven");
assert.match(styles, /\.ui-btn-icon-slot\.is-hidden\s*\{[\s\S]*display:\s*none/, "Button icon slots are hidden by CSS while loading");

console.log("button.test.ts OK");
