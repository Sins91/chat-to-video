import type { ReactNode } from "react";
import { StudioShell } from "@/components/ported/studio-shell";

export default function StudioLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="dark studio-theme"><StudioShell>{children}</StudioShell></div>;
}
