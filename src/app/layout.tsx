import type { Metadata } from "next";
import { Fredoka, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidecarAuthBridge } from "@/components/security/sidecar-auth-bridge";
import { SidecarAuthMonitor } from "@/components/security/sidecar-auth-monitor";
import { ShellBannersProvider } from "@/lib/shell-banners";
import { SalemWidget } from "@/components/salem/salem-widget";

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
        <ShellBannersProvider>
          <SidecarAuthBridge />
          <SidecarAuthMonitor />
          {children}
          <SalemWidget />
        </ShellBannersProvider>
      </body>
    </html>
  );
}
