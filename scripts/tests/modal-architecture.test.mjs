import assert from 'node:assert/strict';
import {findModalDeclarations} from '../check-modal-architecture.mjs';
const count = source => findModalDeclarations(source, '/fixture.tsx').length;
assert.equal(count('const kind = "dialog"; const props = {role: kind}; const UI = <div {...props} />;'), 1, 'literal role alias in a spread');
assert.equal(count('const kind = "dialog"; function View(){const kind="status"; return <div role={kind}/>;}'), 0, 'local bindings shadow outer literals');
assert.equal(count('const tag = "dialog"; document.createElement(tag); React.createElement("dialog", {});'), 2, 'native imperative and React constructors');
assert.equal(count('const kind="status"; const UI=<div role={kind}/>; document.createElement("div");'), 0, 'ordinary status and content elements stay allowed');
assert.equal(count('const UI=<dialog/>; const role = {role: "alertdialog"};'), 2, 'native JSX and alert dialog objects');
console.log('modal architecture fixtures: literal aliases, shadowing, spreads and constructors passed');
