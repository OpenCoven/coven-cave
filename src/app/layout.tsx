import type { Metadata, Viewport } from "next";
import { Fredoka, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidecarAuthBridge } from "@/components/security/sidecar-auth-bridge";
import { SidecarAuthMonitor } from "@/components/security/sidecar-auth-monitor";
import { ScreenMagnificationController } from "@/components/screen-magnification-controller";
import { ShellBannersProvider } from "@/lib/shell-banners";
import { LiveRegionProvider } from "@/components/ui/live-region";
import { PwaRegister } from "@/components/pwa-register";
import { DevCacheResetScript } from "@/components/dev-cache-reset-script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fredoka.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <DevCacheResetScript />
        <SidecarAuthBridge />
        <ShellBannersProvider>
          <LiveRegionProvider>
            <SidecarAuthMonitor />
            <ScreenMagnificationController />
            <PwaRegister />
            {children}
          </LiveRegionProvider>
        </ShellBannersProvider>
      </body>
    </html>
  );
}
