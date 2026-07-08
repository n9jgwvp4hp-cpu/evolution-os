import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import VoiceAssistant from "@/components/VoiceAssistant";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "Evolution OS",
  description: "Your personal real-estate AI assistant.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Evolution OS",
  },
};

export const viewport: Viewport = {
  themeColor: "#05060f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Inter font loaded via a plain link tag (works regardless of the
            special character in this project's folder path). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* iOS home-screen icon (SVG is supported by modern Safari). */}
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AppShell>{children}</AppShell>
        {/* Persistent voice interface, available on every page (hidden on the root chat, which has its own). */}
        <VoiceAssistant />
        {/* Installs the app-shell service worker for offline / PWA support. */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
