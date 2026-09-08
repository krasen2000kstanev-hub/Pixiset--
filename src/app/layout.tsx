import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Client Gallery",
  description: "Private photo galleries for clients",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
