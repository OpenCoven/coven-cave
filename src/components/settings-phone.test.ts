// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const componentUrl = new URL("./settings-phone.tsx", import.meta.url);
const component = existsSync(componentUrl)
  ? readFileSync(componentUrl, "utf8")
  : "";
const shell = readFileSync(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);
const cssUrl = new URL("../styles/settings-phone.css", import.meta.url);
const css = existsSync(cssUrl) ? readFileSync(cssUrl, "utf8") : "";
const foundations = readFileSync(
  new URL("../styles/globals/foundations.css", import.meta.url),
  "utf8",
);
const desktopChrome = readFileSync(
  new URL("../styles/globals/desktop-chrome.css", import.meta.url),
  "utf8",
);
const sections = readFileSync(
  new URL("./settings-sections.ts", import.meta.url),
  "utf8",
);
const pairingSteps = readFileSync(
  new URL("./pairing-steps-list.tsx", import.meta.url),
  "utf8",
);

test("Settings delegates the Phone surface to a focused component", () => {
  assert.match(
    shell,
    /import \{ PhoneSection \} from "\.\/settings-phone"/,
  );
  assert.match(
    shell,
    /section === "mobile"\s*&&\s*<PhoneSection onUseAsHub=/,
  );
  assert.doesNotMatch(shell, /function MobileSection\(/);
  assert.match(component, /import "@\/styles\/settings-phone\.css";/);
});

test("Phone ports the handoff control-sheet hierarchy", () => {
  assert.match(component, /className="settings-phone"/);
  assert.match(component, /className="settings-phone-hero"/);
  assert.match(component, />Settings · Phone</);
  assert.match(component, /<h1[^>]*>Phone<\/h1>/);
  assert.match(component, /className="settings-phone-hero__chips"/);
  assert.match(
    component,
    /mobileModeEnabled\s*\?\s*"pairing starting"\s*:\s*"pairing paused"/,
  );
  assert.match(component, /className="settings-phone-mode"/);
  assert.match(component, />Mobile mode</);
  assert.match(component, /className="settings-phone-control-grid"/);
  assert.match(component, /className="settings-phone-pair-sheet"/);
  assert.match(component, /className="settings-phone-side-stack"/);
  assert.match(component, />Get the app</);
  assert.match(component, />Keep this Mac reachable</);
  assert.match(component, />Why there’s no password</);
  assert.match(component, /className="settings-phone-permissions-grid"/);
  assert.match(component, />\s*Phone write access\s*</);
  assert.match(
    sections,
    /section: "mobile", group: "Pair"/,
  );
  assert.doesNotMatch(
    sections,
    /section: "mobile", group: "Steps"/,
  );
});

test("Phone preserves production pairing and settings behavior", () => {
  assert.match(component, /readMobileModeEnabled/);
  assert.match(component, /writeMobileModeEnabled/);
  assert.match(component, /reconcileMobileModeRequest/);
  assert.match(
    component,
    /reconcileMobileMode\(true, \{ busy: true, force: true \}\)/,
  );
  assert.match(
    component,
    /<PairingStepsList[\s\S]*showAllDetails/,
  );
  assert.match(pairingSteps, /showAllDetails\?: boolean/);
  assert.match(
    pairingSteps,
    /showAllDetails \|\| step\.state === "fail" \|\| step\.state === "pending"/,
  );
  assert.match(component, /dangerouslySetInnerHTML=\{\{ __html: handoff\.qrSvg \}\}/);
  assert.match(component, /handoff\?\.lastSeenAt/);
  assert.match(component, /copyText/);
  assert.match(component, /action: "install-info"/);
  assert.match(component, /readDesktopReachability/);
  assert.match(component, /writeDesktopReachability/);
  assert.match(component, /fetch\("\/api\/mobile-permissions"/);
  assert.match(component, /method: "PATCH"/);
  assert.match(component, /useAnnouncer/);
  assert.match(component, /className=\{`settings-switch focus-ring/);
  assert.match(component, /settings-switch__knob/);
});

test("Phone never promotes prototype-only device facts to production UI", () => {
  assert.doesNotMatch(component, /iPhone 15 Pro|tail5c1a2|paired 12 Jul/);
  assert.doesNotMatch(component, /\b7717\b|code rotates every 5 min/);
  assert.doesNotMatch(component, /\bv0\.2\.0\b|\b12 ms\b/);
  assert.doesNotMatch(component, /PAIR CODE|fake QR/i);
});

test("Phone CSS follows the token and responsive-pane contracts", () => {
  assert.match(
    css,
    /\.settings-phone\s*\{[\s\S]*container-type:\s*inline-size/,
  );
  assert.match(
    css,
    /\.settings-phone-control-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.55fr\)\s+minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /\.settings-phone-permissions-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,/,
  );
  assert.match(css, /@container settings-phone/);
  assert.match(css, /var\(--accent-presence\)/);
  assert.match(css, /var\(--border-hairline\)/);
  assert.match(css, /var\(--font-serif\)/);
  assert.match(
    css,
    /\.settings-phone-hero__chips\s*\{[\s\S]*width:\s*calc\(100% - var\(--space-10\) - var\(--space-3\)\)/,
    "the wrapped status rail must not add a left margin on top of 100% width",
  );
  assert.match(css, /color:\s*var\(--surface-paper-muted\)/);
  assert.match(foundations, /--surface-paper-ink:\s*#111;/);
  assert.match(foundations, /--surface-paper-muted:\s*#444;/);
  assert.match(desktopChrome, /color:\s*var\(--surface-paper-ink\)/);
  assert.match(desktopChrome, /color:\s*var\(--surface-paper-muted\)/);
  assert.doesNotMatch(
    css,
    /var\(--qr-ink\)/,
    "the focused surface must not depend on the modal-scoped QR custom property",
  );
  assert.match(css, /var\(--font-mono\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
