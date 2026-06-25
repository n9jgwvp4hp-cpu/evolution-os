import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Evolution OS",
  description: "Your personal AI assistant dashboard.",
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
      </head>
      <body className="min-h-screen font-sans antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          {/* Main content area — left margin clears the fixed sidebar on desktop */}
          <main className="flex-1 lg:ml-64 px-4 pb-8 pt-20 lg:pt-8 lg:px-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
