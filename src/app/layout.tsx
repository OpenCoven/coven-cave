import type { Metadata, Viewport } from "next";
import { fontVariables } from "./fonts";
import "./globals.css";
import { SidecarAuthBridge } from "@/components/security/sidecar-auth-bridge";
import { SidecarAuthMonitor } from "@/components/security/sidecar-auth-monitor";
import { ScreenMagnificationController } from "@/components/screen-magnification-controller";
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
import { DevCacheResetScript } from "@/components/dev-cache-reset-script";
import { WebVitalsReporter } from "@/components/perf/web-vitals-reporter";
import { PerfOverlay } from "@/components/perf/perf-overlay";

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
  return (
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
      // ThemeScript sets data-theme/data-mode on <html> before hydration, so the
      // server markup intentionally differs from the post-script client markup.
      // Suppress the resulting attribute hydration mismatch (the next-themes pattern).
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="h-full flex flex-col">
        <DevCacheResetScript />
        <SidecarAuthBridge />
        <ShellBannersProvider>
          <LiveRegionProvider>
            <ConfirmProvider>
            <SidecarAuthMonitor />
            <ScreenMagnificationController />
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
            <WebVitalsReporter />
            <PerfOverlay />
            {children}
            </ConfirmProvider>
          </LiveRegionProvider>
        </ShellBannersProvider>
      </body>
    </html>
  );
}
