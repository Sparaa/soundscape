import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Soundscape", description: "A radio that never runs out of songs" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
