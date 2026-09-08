import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "atelier / 01 — Demo Gallery",
  description: "A quiet day by the sea — private client gallery demo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="bg">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
