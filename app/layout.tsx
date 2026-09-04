import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "幕友｜一起看番看剧",
  description: "和朋友一起同步看番看剧的观影房。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
