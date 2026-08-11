import type { ReactNode } from "react";
import { StudioShell } from "@/components/ported/studio-shell";

export default function StudioLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="studio-theme min-h-dvh bg-background text-foreground"><StudioShell>{children}</StudioShell></div>;
}
