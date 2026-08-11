"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bot, ChevronDown, CircleHelp, Clapperboard, Coins, FolderKanban, Gem, Image, MessageSquareText, Mic2, Settings, Shapes, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const navigation = [
  { href: "/studio", label: "短剧项目", icon: FolderKanban },
  { href: "/studio/agent", label: "创作 Agent", icon: MessageSquareText },
  { href: "/studio/library/characters", label: "角色库", icon: Users },
  { href: "/studio/library/scenes", label: "场景库", icon: Image },
  { href: "/studio/library/props", label: "道具库", icon: Shapes },
  { href: "/studio/library/voices", label: "声音库", icon: Mic2 },
  { href: "/studio/settings/ai-config", label: "AI 配置", icon: Bot },
];

export function StudioShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const collapsed = false;
  const isFilm = pathname.includes("/episodes/") && pathname.endsWith("/film");
  if (pathname.startsWith("/studio/invite/")) return children;

  if (isFilm) {
    return <div className="grid h-dvh min-h-0 grid-rows-[56px_minmax(0,1fr)] overflow-hidden bg-background"><StudioUserBar /><main className="min-h-0 [&>div]:h-full [&>div]:min-h-0">{children}</main></div>;
  }

  return (
    <div className={`grid h-dvh overflow-hidden bg-background ${collapsed ? "grid-cols-[72px_1fr]" : "grid-cols-[232px_1fr]"}`}>
      <aside className="sticky top-0 flex h-dvh flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground">
        <div className={`mb-6 flex h-10 items-center ${collapsed ? "justify-center" : "px-2"}`}>
          <Link href="/" className="flex items-center gap-2 font-bold"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><Clapperboard className="size-4" /></span>{collapsed ? null : <span>FilFil Studio</span>}</Link>
        </div>
        <nav className="space-y-1">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === "/studio" ? pathname === href : pathname.startsWith(href);
            return <Link title={collapsed ? label : undefined} key={href} href={href} className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${active ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}><Icon className="size-4 shrink-0" />{collapsed ? null : label}</Link>;
          })}
        </nav>
        <div className="mt-auto space-y-1 border-t pt-3">
          <Link href="/studio/pricing" className="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-zinc-600 hover:bg-zinc-100"><Gem className="size-4" />{collapsed ? null : "套餐与价格"}</Link>
          <Link href="/studio/settings/credits" className="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-zinc-600 hover:bg-zinc-100"><Coins className="size-4" />{collapsed ? null : "积分明细"}</Link>
          <Link href="/studio/settings/profile" className="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-zinc-600 hover:bg-zinc-100"><Settings className="size-4" />{collapsed ? null : "账号设置"}</Link>
          <div className={`mt-2 flex items-center gap-3 rounded-md bg-zinc-50 p-2 ${collapsed ? "justify-center" : ""}`}><span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-blue-500 text-xs font-bold text-white">DE</span>{collapsed ? null : <div className="min-w-0"><p className="truncate text-xs font-medium">Demo Studio</p><p className="truncate text-[11px] text-zinc-500">静态演示账号</p></div>}</div>
        </div>
        {/* <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "展开侧栏" : "收起侧栏"} className="absolute -right-3 top-20 grid size-6 place-items-center rounded-full border bg-white text-zinc-500">{collapsed ? <ChevronRight className="size-3" /> : <ChevronLeft className="size-3" />}</button> */}
      </aside>
      <main className="grid min-h-0 min-w-0 grid-rows-[56px_minmax(0,1fr)] overflow-hidden"><StudioUserBar /><div className="min-h-0 overflow-auto">{children}</div></main>
    </div>
  );
}

function StudioUserBar() {
  return <header className="relative z-30 flex h-14 items-center border-b bg-card px-4 sm:px-6">
    {/* <div className="hidden items-center gap-2 text-sm sm:flex"><span className="text-zinc-400">当前工作区</span><button type="button" className="inline-flex h-8 items-center gap-2 rounded-md px-2 font-medium text-zinc-700 hover:bg-zinc-100">Demo Studio<ChevronDown className="size-3 text-zinc-400" /></button></div> */}
    <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
      <button type="button" className="hidden h-8 items-center gap-2 rounded-md border bg-zinc-50 px-3 text-xs text-zinc-600 sm:inline-flex"><Coins className="size-3.5 text-amber-500" /><span>2,480 积分</span></button>
      <ThemeToggle />
      <button type="button" aria-label="帮助中心" className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100"><CircleHelp className="size-4" /></button>
      <button type="button" aria-label="通知，2 条未读" className="relative grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100"><Bell className="size-4" /><span className="absolute right-1 top-1 size-2 rounded-full border border-white bg-red-500" /></button>
      <span className="mx-1 h-5 w-px bg-zinc-200" />
      <button type="button" className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-zinc-100"><span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-blue-500 text-[10px] font-bold text-white">DE</span><span className="hidden text-left sm:block"><span className="block text-xs font-medium text-zinc-700">Demo Creator</span><span className="block text-[10px] text-zinc-400">所有者</span></span><ChevronDown className="hidden size-3 text-zinc-400 sm:block" /></button>
    </div>
  </header>;
}

export function StudioHeader({ title, description, action = "新建" }: { readonly title: string; readonly description?: string; readonly action?: string }) {
  return <header className="flex min-h-20 items-center justify-between border-b bg-white px-6 lg:px-9"><div><h1 className="text-xl font-semibold tracking-tight">{title}</h1>{description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}</div><button type="button" className="inline-flex h-9 items-center gap-2 rounded-md bg-black px-4 text-sm font-medium text-white"><Sparkles className="size-4" />{action}</button></header>;
}
