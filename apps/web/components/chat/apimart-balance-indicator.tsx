"use client";

import type { ApimartAccountBalance } from "@chat-to-video/contracts";
import { WalletCardsIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { getApimartAccountBalance } from "@/lib/apimart-account-client";

const balanceFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function ApimartBalanceIndicator() {
  const [balance, setBalance] = useState<ApimartAccountBalance | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isActive = true;
    void getApimartAccountBalance().then((nextBalance) => {
      if (isActive) setBalance(nextBalance);
    }).catch(() => {
      if (isActive) setHasError(true);
    });
    return () => { isActive = false; };
  }, []);

  const displayedBalance = hasError
    ? "暂不可用"
    : balance?.isUnlimited
      ? "无限"
      : balance
        ? balanceFormatter.format(balance.remainingBalance ?? 0)
        : "…";
  const title = balance
    ? `APIMart 账户余额，更新于 ${new Date(balance.refreshedAt).toLocaleString("zh-CN")}`
    : "APIMart 账户余额";

  return <div
    aria-live="polite"
    className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 text-[11px] text-zinc-400"
    role="status"
    title={title}
  >
    <WalletCardsIcon className="size-3.5 text-zinc-500" />
    <span className="hidden md:inline">APIMart 余额</span>
    <span className="font-medium tabular-nums text-zinc-200">{displayedBalance}</span>
  </div>;
}
