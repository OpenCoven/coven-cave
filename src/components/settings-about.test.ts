// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const componentUrl = new URL("./settings-about.tsx", import.meta.url);
const component = existsSync(componentUrl) ? readFileSync(componentUrl, "utf8") : "";
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const cssUrl = new URL("../styles/settings-about.css", import.meta.url);
const css = existsSync(cssUrl) ? readFileSync(cssUrl, "utf8") : "";

test("Settings delegates the About surface to a focused component", () => {
  assert.match(shell, /import \{ AboutSection \} from "\.\/settings-about"/);
  assert.match(shell, /section === "about"\s*&&\s*<AboutSection \/>/);
  assert.doesNotMatch(shell, /function AboutSection\(/);
  assert.match(component, /import "@\/styles\/settings-about\.css";/);
});

test("About ports the Claude Design hero and live control-sheet hierarchy", () => {
  assert.match(component, /className="settings-about"/);
  assert.match(component, /className="settings-about-hero"/);
  assert.match(component, />Settings · About</);
  assert.match(component, /<h1[^>]*>About<\/h1>/);
  assert.match(component, /className="settings-about-hero__chips"/);
  assert.match(component, /Copy diagnostics/);
  assert.match(component, /updateActionRef/);
  assert.match(component, /className="settings-about-control-grid"/);
  assert.match(component, />CovenCave</);
  assert.match(
    component,
    /<SectionRule[\s\S]*?>\s*OpenCoven tools\s*<\/SectionRule>/,
  );
  assert.match(component, /<UpdateSettingsRow[\s\S]*actionRef=\{updateActionRef\}/);
  assert.match(component, /<OpenCovenToolsUpdate showDiagnosticsAction=\{false\} \/>/);
});

test("About preserves truthful live status and safe diagnostic behavior", () => {
  assert.match(component, /classifyAboutDaemonStatus/);
  assert.match(component, /fetch\("\/api\/daemon\/status"/);
  assert.match(component, /fetch\("\/api\/onboarding\/update"/);
  assert.match(component, /buildSafeToolDiagnostics/);
  assert.match(component, /copyText/);
  assert.match(component, /useAnnouncer/);
  assert.match(component, /role="status"/);
  assert.doesNotMatch(component, /\b(?:stable|beta) channel\b/i);
  assert.doesNotMatch(component, /tailscale.*1password-cli.*piper/s);
});

test("About ports the handoff link grid with production destinations", () => {
  assert.match(component, /className="settings-about-elsewhere"/);
  assert.match(component, />The Coven, elsewhere</);
  assert.match(component, /https:\/\/github\.com\/OpenCoven\/coven-cave/);
  assert.match(component, /https:\/\/docs\.opencoven\.ai/);
  assert.match(component, /https:\/\/x\.com\/OpenCvn/);
  assert.match(component, /https:\/\/discord\.gg\/opencoven/);
  assert.match(component, /https:\/\/mind\.opencoven\.ai/);
  assert.match(component, /https:\/\/pod\.opencoven\.ai/);
  assert.match(component, /openExternalUrl/);
  assert.match(component, /git clone https:\/\/github\.com\/OpenCoven\/coven-cave\.git/);
});

test("About follows the revised handoff artwork and full-width release rail", () => {
  assert.match(component, /className="settings-about-grimoire-mark"/);
  assert.match(component, />Open Coven Weekly</);
  assert.match(component, />Shipping notes, every Friday\.</);
  assert.match(component, />OCW</);
  assert.match(
    css,
    /\.settings-about-release-card\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/,
  );
  assert.match(
    css,
    /\.settings-about-grimoire-mark\s*\{[\s\S]*position:\s*absolute[\s\S]*top:\s*var\(--space-3\)[\s\S]*right:\s*var\(--space-3\)/,
  );
});

test("About CSS follows the token, focus, motion, and narrow-pane contracts", () => {
  assert.match(css, /\.settings-about\s*\{[\s\S]*container-type:\s*inline-size/);
  assert.match(css, /\.settings-about-control-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.settings-about-links-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4/);
  assert.match(css, /@container settings-about/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /var\(--accent-presence\)/);
  assert.match(css, /var\(--border-hairline\)/);
  assert.match(css, /var\(--font-serif\)/);
  assert.match(css, /var\(--font-mono\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
