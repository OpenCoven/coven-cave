import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const topBar = await readFile(new URL("./top-bar.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const modal = await readFile(new URL("./mobile-handoff-modal.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(topBar, /onOpenMobileHandoff/, "TopBar should accept a mobile handoff opener");
assert.match(topBar, /ph:phone/, "TopBar should render a recognizable phone icon");
assert.match(topBar, /top-bar__mobile-handoff/, "TopBar handoff button should have a stable desktop-only class");
assert.match(workspace, /MobileHandoffModal/, "Workspace should mount the mobile handoff modal");
assert.match(modal, /\/api\/mobile-handoff/, "Modal should call the mobile handoff API");
assert.match(modal, /dangerouslySetInnerHTML/, "Modal should render the QR SVG returned by the API");
assert.match(modal, /expiresAtIso/, "Modal should display the invite expiry");
assert.match(modal, /navigator\.clipboard\.writeText/, "Modal should support copying the authenticated URL");
assert.match(modal, /action: "reset"/, "Modal should expose explicit Tailscale Serve reset");
assert.match(css, /\.mobile-handoff-qr/, "QR block should have stable layout CSS");
assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.top-bar__mobile-handoff[\s\S]*display: none/, "Phone handoff button should hide on mobile/tablet chrome");

console.log("mobile-handoff.test.ts OK");
