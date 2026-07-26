// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  contrastRatio,
  flattenOnto,
  resolveThemeColor,
  themeTokens,
  type Rgba,
} from "../lib/theme-contrast.ts";
import { THEME_IDS } from "../lib/theme-palettes.ts";

const componentUrl = new URL("./settings-about.tsx", import.meta.url);
const component = existsSync(componentUrl) ? readFileSync(componentUrl, "utf8") : "";
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const cssUrl = new URL("../styles/settings-about.css", import.meta.url);
const css = existsSync(cssUrl) ? readFileSync(cssUrl, "utf8") : "";
const themeCss = [
  readFileSync(new URL("../styles/globals/foundations.css", import.meta.url), "utf8"),
  readFileSync(new URL("../styles/globals/themes.css", import.meta.url), "utf8"),
].join("\n");

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
  assert.match(
    component,
    /<OpenCovenToolsUpdate[\s\S]*showDiagnosticsAction=\{false\}[\s\S]*onSnapshotChange=\{handleToolSnapshot\}/,
  );
});

test("About preserves truthful live status and safe diagnostic behavior", () => {
  assert.match(component, /classifyAboutDaemonStatus/);
  assert.match(component, /fetch\("\/api\/daemon\/status"/);
  assert.match(component, /onSnapshotChange=\{handleToolSnapshot\}/);
  assert.match(component, /buildSafeToolDiagnostics/);
  assert.match(
    component,
    /version:\s*exactSemver\(state\.version\)/,
    "copied daemon diagnostics independently allowlist exact semver",
  );
  assert.match(component, /installJobs:\s*snapshot\.installJobs/);
  assert.match(component, /installResults:\s*snapshot\.installResults/);
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
  assert.match(
    css,
    /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*\.settings-about-update-row \.ui-btn[\s\S]*\.settings-about-daemon-row \.ui-btn[\s\S]*\.settings-about-tools \.settings-tool-action[\s\S]*min-height:\s*var\(--touch-target\)/,
  );
  assert.match(
    css,
    /@container settings-about \(max-width: 36rem\)[\s\S]*?\.settings-about-update-row\s*\{[\s\S]*?flex-direction:\s*column[\s\S]*?\.settings-about-update-actions\s*\{[\s\S]*?width:\s*100%[\s\S]*?flex-wrap:\s*wrap/,
  );
  assert.match(
    css,
    /\.settings-about-build-sigil strong\s*\{[\s\S]*color:\s*var\(--text-primary\)/,
  );
  assert.match(
    css,
    /\.settings-about-link-card__copy small,[\s\S]*\.settings-about-release-card small\s*\{[\s\S]*color:\s*var\(--text-primary\)/,
  );
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});

test("About hero text and sigil keep computed contrast across all palettes", () => {
  const kickerToken = /\.settings-about-hero__kicker\s*\{[^}]*color:\s*var\((--[^)]+)\)/s.exec(css)?.[1];
  const sigilToken = /\.settings-about \.settings-about-sigil\s*\{[^}]*color:\s*var\((--[^)]+)\)/s.exec(css)?.[1];
  assert.ok(kickerToken, "the kicker exposes one theme token for computed auditing");
  assert.ok(sigilToken, "the sigil exposes one theme token for computed auditing");

  const black: Rgba = { r: 0, g: 0, b: 0, alpha: 1 };
  const failures: string[] = [];
  for (const id of THEME_IDS) {
    for (const mode of ["dark", "light"] as const) {
      const tokens = themeTokens(themeCss, id, mode);
      const base = resolveThemeColor(tokens, "--bg-base");
      const panelRaw = resolveThemeColor(tokens, "--bg-panel");
      assert.ok(base && panelRaw, `${id}/${mode} resolves About surfaces`);
      const panel = flattenOnto(panelRaw, flattenOnto(base, black));

      const aboutTokens = new Map(tokens);
      aboutTokens.set(
        "--about-hero-wash",
        "color-mix(in oklch, var(--accent-presence) 10%, transparent)",
      );
      aboutTokens.set(
        "--about-sigil-fill",
        "color-mix(in oklch, var(--accent-presence) 14%, transparent)",
      );
      const heroWash = resolveThemeColor(aboutTokens, "--about-hero-wash");
      const sigilFill = resolveThemeColor(aboutTokens, "--about-sigil-fill");
      const kicker = resolveThemeColor(tokens, kickerToken);
      const sigil = resolveThemeColor(tokens, sigilToken);
      assert.ok(heroWash && sigilFill && kicker && sigil);

      const heroBg = flattenOnto(heroWash, panel);
      const sigilBg = flattenOnto(sigilFill, heroBg);
      const kickerRatio = contrastRatio(flattenOnto(kicker, heroBg), heroBg);
      const sigilRatio = contrastRatio(flattenOnto(sigil, sigilBg), sigilBg);
      if (kickerRatio < 4.5) {
        failures.push(`${id}/${mode} kicker ${kickerRatio.toFixed(2)}:1`);
      }
      if (sigilRatio < 3) {
        failures.push(`${id}/${mode} sigil ${sigilRatio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});
