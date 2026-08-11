"use client";

import { MoonIcon, SunIcon } from "lucide-react";

const THEME_STORAGE_KEY = "filfil-theme";

export function ThemeToggle() {
  const toggleTheme = () => {
    const root = document.documentElement;
    const isDark = !root.classList.contains("dark");

    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
    } catch {
      // The active theme still applies when storage is unavailable.
    }
  };

  return (
    <button
      aria-label="切换明暗主题"
      className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
      onClick={toggleTheme}
      title="切换明暗主题"
      type="button"
    >
      <MoonIcon className="size-4 dark:hidden" />
      <SunIcon className="hidden size-4 dark:block" />
    </button>
  );
}
