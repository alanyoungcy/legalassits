import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Capco Contract Assists",
  description: "Chat-first contract workspace with Capco Wayne copilot.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={
          {
            ["--font-sans" as string]: "'Figtree', 'Helvetica Neue', sans-serif",
          } as CSSProperties
        }
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
