import type { ReactNode } from "react";

export default function StudioLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="studio-theme h-dvh min-h-0 overflow-hidden bg-background text-foreground">{children}</div>;
}
