import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Darpan: your talking magic mirror", template: "%s | Darpan" },
  description:
    "Darpan is a talking magic mirror that measures your skin with YouCam AI, coaches your skincare ritual one calm sentence at a time, previews makeup, and tells you honestly whether it helped.",
  applicationName: "Darpan",
  robots: { index: true, follow: true },
  appleWebApp: { capable: true, title: "Darpan", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f5ff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
