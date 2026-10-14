import type { Metadata, Viewport } from "next";
import { fontFamilyStyle, fontVariables } from "./fonts";
import "./globals.css";
import { SidecarAuthBridge } from "@/components/security/sidecar-auth-bridge";
import { SidecarAuthMonitor } from "@/components/security/sidecar-auth-monitor";
import { ScreenMagnificationController } from "@/components/screen-magnification-controller";
import { ReadingSizeController } from "@/components/reading-size-controller";
import { ReadingLeadingController } from "@/components/reading-leading-controller";
import { ReadingTrackingController } from "@/components/reading-tracking-controller";
import { ReadingAlignController } from "@/components/reading-align-controller";
import { ReadingWidthController } from "@/components/reading-width-controller";
import { ReadingWeightController } from "@/components/reading-weight-controller";
import { ReadingHyphensController } from "@/components/reading-hyphens-controller";
import { CornerRadiusController } from "@/components/corner-radius-controller";
import { RemoteThemeController } from "@/components/remote-theme-controller";
import { TauriTitlebarMarker } from "@/components/tauri-titlebar-marker";
import { ThemeScript } from "@/components/theme-script";
import { ShellBannersProvider } from "@/lib/shell-banners";
import { LiveRegionProvider } from "@/components/ui/live-region";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { PwaRegister } from "@/components/pwa-register";
import { FileEditDraftGuard } from "@/components/file-edit-draft-guard";
import { DevCacheResetScript } from "@/components/dev-cache-reset-script";
import { DevShellRecovery } from "@/components/dev-shell-recovery";
import { WebVitalsReporter } from "@/components/perf/web-vitals-reporter";
import { PerfOverlay } from "@/components/perf/perf-overlay";
import { PreferencesBootstrapController } from "@/components/preferences-bootstrap-controller";
import { DaemonReleaseAlignmentTrigger } from "@/components/update-available";
import { createDefaultPreferences } from "@/lib/preferences-schema";
import { SettingsSaveToast } from "@/components/ui/settings-save-toast";

export const metadata: Metadata = {
  title: "CovenCave",
  description: "Coven desktop cave for familiars, memory, and tools.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CovenCave",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // First shell delivery must never enter the reconciled preference store. The
  // uninitialized snapshot is paint-only: ThemeScript may combine it with this
  // origin's compatibility cache, while PreferencesBootstrapController fetches
  // the canonical snapshot after the shell has mounted.
  const preferences = createDefaultPreferences(false);
  return (
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
      // Each --font-* var with every vendored subset's family (fonts.ts).
      style={fontFamilyStyle}
      // ThemeScript sets data-theme/data-mode on <html> before hydration, so the
      // server markup intentionally differs from the post-script client markup.
      // Suppress the resulting attribute hydration mismatch (the next-themes pattern).
      suppressHydrationWarning
    >
      <head>
        <ThemeScript preferences={preferences} authoritative={false} />
      </head>
      <body className="h-full flex flex-col">
        {/* PROBE (local only, never commit): mark the instrumented debug window. */}
        <div style={{ position: "fixed", top: 6, left: "50%", transform: "translateX(-50%)", zIndex: 2147483647, background: "#d4351c", color: "#fff", font: "600 12px/1 system-ui", padding: "6px 10px", borderRadius: 6, pointerEvents: "none" }}>DEBUG PROBE</div>
        <script dangerouslySetInnerHTML={{ __html: "\n(function () {\n  try { localStorage.setItem(\"cave:onboarding:dismissed\", \"1\"); } catch (e) {}\n  try { if (sessionStorage.getItem(\"probe:autocall\")) return; } catch (e) {}\n  var log = function (m) { try { fetch(\"http://127.0.0.1:3999/\", { method: \"POST\", mode: \"no-cors\", body: \"autocall \" + m, keepalive: true }); } catch (e) {} };\n  var CHAT = \"#chat-6b3d35ed-cde9-4c18-84f1-7bd72ae51400\";\n  var sel = '[data-testid=\"chat-main\"] button[aria-label=\"Voice call\"]';\n  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };\n  var waitFor = async function (find, ms) { var t0 = Date.now(); while (Date.now() - t0 < ms) { var el = find(); if (el) return el; await sleep(250); } return null; };\n  var waitVisible = function () { return new Promise(function (r) { if (document.visibilityState === \"visible\") return r(); log(\"window hidden; waiting for it to be visible\"); document.addEventListener(\"visibilitychange\", function on() { if (document.visibilityState === \"visible\") { document.removeEventListener(\"visibilitychange\", on); r(); } }); }); };\n  document.addEventListener(\"visibilitychange\", function () { log(\"visibility \" + document.visibilityState); });\n  window.addEventListener(\"load\", async function () {\n    await sleep(4000);\n    await waitVisible();\n    log(\"visible; opening Charm chat\");\n    if (location.hash !== CHAT) location.hash = CHAT;\n    var btn = await waitFor(function () { var b = document.querySelector(sel); return b && !b.disabled && b.getAttribute(\"aria-disabled\") !== \"true\" ? b : null; }, 45000);\n    if (!btn) { log(\"Voice call button not ready; page text: \" + JSON.stringify(document.body.innerText.replace(/\\s+/g, \" \").slice(0, 200))); return; }\n    log(\"chat: \" + JSON.stringify(document.querySelector('[data-testid=\"chat-main\"]').innerText.replace(/\\s+/g, \" \").slice(0, 70)));\n    await sleep(2500);\n    var dialog = null;\n    for (var attempt = 1; attempt <= 3 && !dialog; attempt++) {\n      var b = document.querySelector(sel);\n      log(\"click attempt \" + attempt + \" disabled=\" + (b && b.disabled));\n      if (b) b.click();\n      dialog = await waitFor(function () { return document.querySelector(\"[role=dialog]\"); }, 5000);\n    }\n    if (!dialog) { log(\"no call overlay appeared\"); return; }\n    try { sessionStorage.setItem(\"probe:autocall\", \"1\"); } catch (e) {}\n    var last = \"\"; var t0 = Date.now();\n    while (Date.now() - t0 < 240000) {\n      var d = document.querySelector(\"[role=dialog]\");\n      var txt = d ? (d.innerText || \"\").replace(/\\s+/g, \" \").replace(/\\b\\d\\d:\\d\\d\\b/g, \"\").slice(0, 260) : \"(overlay closed)\";\n      if (txt !== last) { log(\"overlay: \" + JSON.stringify(txt)); last = txt; }\n      if (!d) break;\n      await sleep(700);\n    }\n  });\n})();\n" }} />
        <DevCacheResetScript />
        <DevShellRecovery />
        <SidecarAuthBridge />
        <ShellBannersProvider>
          <DaemonReleaseAlignmentTrigger />
          <LiveRegionProvider>
            <ConfirmProvider>
            <PreferencesBootstrapController />
            <SidecarAuthMonitor />
            <ScreenMagnificationController />
            <ReadingSizeController />
            <ReadingLeadingController />
            <ReadingTrackingController />
            <ReadingAlignController />
            <ReadingWidthController />
            <ReadingWeightController />
            <ReadingHyphensController />
            <CornerRadiusController />
            <RemoteThemeController />
            <TauriTitlebarMarker />
            <PwaRegister />
            <FileEditDraftGuard />
            <WebVitalsReporter />
            <PerfOverlay />
            {children}
            <SettingsSaveToast />
            </ConfirmProvider>
          </LiveRegionProvider>
        </ShellBannersProvider>
      </body>
    </html>
  );
}
