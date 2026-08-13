"use client";

import type { ApimartAccountBalance } from "@chat-to-video/contracts";
import { WalletCardsIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { getApimartAccountBalance } from "@/lib/apimart-account-client";

const balanceFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

let pageLoadBalanceRequest: Promise<ApimartAccountBalance> | undefined;

const getPageLoadBalance = (): Promise<ApimartAccountBalance> => {
  pageLoadBalanceRequest ??= getApimartAccountBalance();
  return pageLoadBalanceRequest.catch((error: unknown) => {
    pageLoadBalanceRequest = undefined;
    throw error;
  });
};

export function ApimartBalanceIndicator() {
  const [balance, setBalance] = useState<ApimartAccountBalance | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isActive = true;

    const loadBalance = async () => {
      try {
        const nextBalance = await getPageLoadBalance();
        if (isActive) {
          setBalance(nextBalance);
          setHasError(false);
        }
      } catch {
        if (isActive) setHasError(true);
      }
    };

    void loadBalance();

    return () => {
      isActive = false;
    };
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
    className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 font-sans text-[10px] text-muted-foreground"
    role="status"
    title={title}
  >
    <WalletCardsIcon className="size-3.5 text-muted-foreground" />
    <span className="hidden md:inline">APIMart 余额</span>
    <span className="font-numeric font-medium tabular-nums text-foreground">{displayedBalance}</span>
  </div>;
}
