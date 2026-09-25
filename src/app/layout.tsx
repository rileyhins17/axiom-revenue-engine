import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import { ToastProvider } from "@/components/ui/toast-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PerformanceProvider } from "@/lib/ui/performance";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "Axiom Revenue Engine",
  description: "Evidence-first lead quality, outreach review, and revenue operations for Axiom Web.",
  applicationName: "Axiom Revenue Engine",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Axiom Revenue",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="font-sans antialiased">
        <PerformanceProvider>
          <TooltipProvider delayDuration={0}>
            <ToastProvider>
              <AppShell>{children}</AppShell>
              <PwaServiceWorker />
            </ToastProvider>
          </TooltipProvider>
        </PerformanceProvider>
      </body>
    </html>
  );
}
