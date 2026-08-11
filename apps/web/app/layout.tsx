import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/noto-sans-sc/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FilFil Studio", template: "%s · FilFil Studio" },
  description: "AI 短剧创作与内容展示 UI 原型。",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: `try{const t=localStorage.getItem("filfil-theme");const d=t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch{}` }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
