import type { Metadata, Viewport } from "next";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://equitie.vercel.app";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#141c28",
};

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "EquiTie — Investor Portal",
  description:
    "Private markets investor assistant. Deterministic finance engine, policy-guarded access, evidence-grounded answers — works fully offline with no API key.",
  keywords: ["private equity", "investor portal", "portfolio management", "venture capital"],
  authors: [{ name: "EquiTie" }],
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    type: "website",
    url: APP_URL,
    title: "EquiTie — Investor Portal",
    description:
      "Private markets investor assistant with a deterministic finance engine, policy-guarded access control, and evidence-grounded answers.",
    siteName: "EquiTie",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "EquiTie Investor Portal — deterministic finance engine, 381 tests, 112 investors",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "EquiTie — Investor Portal",
    description:
      "Private markets investor assistant. Deterministic finance engine, 381-test harness, evidence-grounded answers.",
    images: ["/api/og"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen overflow-hidden">{children}</body>
    </html>
  );
}
