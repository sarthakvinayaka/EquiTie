import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EquiTie Investor Portal",
  description: "Your personalised AI investor assistant",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%2314b8a6'/><text x='16' y='22' text-anchor='middle' font-size='18' font-weight='700' fill='%23000'>E</text></svg>",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen overflow-hidden">{children}</body>
    </html>
  );
}
