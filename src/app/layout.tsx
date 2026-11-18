import type { Metadata, Viewport } from "next";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "ownbank",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "ownbank", statusBarStyle: "black-translucent" },
  // Next emits the modern mobile-web-app-capable tag; older iOS wants the apple- one as well.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets env(safe-area-inset-*) report the notch and home bar on iPhone.
  viewportFit: "cover",
  themeColor: "#0f0d14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
