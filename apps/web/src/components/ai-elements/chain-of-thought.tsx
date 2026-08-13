"use client";

import type { LucideIcon } from "lucide-react";
import { BrainIcon, ChevronDownIcon, DotIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, memo, useCallback, useContext, useMemo, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ChainOfThoughtContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(null);

const useChainOfThought = (): ChainOfThoughtContextValue => {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error("ChainOfThought components must be used within ChainOfThought");
  }
  return context;
};

export type ChainOfThoughtProps = ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(function ChainOfThought({
  children,
  className,
  defaultOpen = false,
  onOpenChange,
  open,
  ...props
}: ChainOfThoughtProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const setIsOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange, open]);
  const contextValue = useMemo(() => ({ isOpen, setIsOpen }), [isOpen, setIsOpen]);

  return <ChainOfThoughtContext.Provider value={contextValue}>
    <div className={cn("not-prose w-full space-y-2", className)} {...props}>
      {children}
    </div>
  </ChainOfThoughtContext.Provider>;
});

export type ChainOfThoughtHeaderProps = ComponentProps<typeof CollapsibleTrigger>;

export const ChainOfThoughtHeader = memo(function ChainOfThoughtHeader({
  children,
  className,
  ...props
}: ChainOfThoughtHeaderProps) {
  const { isOpen, setIsOpen } = useChainOfThought();
  return <Collapsible onOpenChange={setIsOpen} open={isOpen}>
    <CollapsibleTrigger
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 text-xs leading-4 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      <BrainIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 text-left">{children ?? "思考过程"}</span>
      <ChevronDownIcon
        aria-hidden="true"
        className={cn("size-4 shrink-0 transition-transform", isOpen ? "rotate-180" : "rotate-0")}
      />
    </CollapsibleTrigger>
  </Collapsible>;
});

export type ChainOfThoughtStepStatus = "complete" | "active" | "pending";

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon;
  isAnimated?: boolean;
  label: ReactNode;
  description?: ReactNode;
  status?: ChainOfThoughtStepStatus;
};

const stepStatusStyles = {
  active: "text-foreground",
  complete: "text-muted-foreground",
  pending: "text-muted-foreground/60",
} as const;

export const ChainOfThoughtStep = memo(function ChainOfThoughtStep({
  children,
  className,
  description,
  icon: Icon = DotIcon,
  isAnimated = true,
  label,
  status = "complete",
  ...props
}: ChainOfThoughtStepProps) {
  return <div
    className={cn(
      "flex gap-2 text-xs",
      isAnimated && "fade-in-0 slide-in-from-top-2 animate-in",
      stepStatusStyles[status],
      className,
    )}
    {...props}
  >
    <div className="relative mt-0.5">
      <Icon aria-hidden="true" className="size-4" />
      <div className="absolute bottom-0 left-1/2 top-7 -mx-px w-px bg-border" />
    </div>
    <div className="min-w-0 flex-1 space-y-2 overflow-hidden">
      <div className="min-h-4 break-words leading-4">{label}</div>
      {description ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      {children}
    </div>
  </div>;
});

export type ChainOfThoughtContentProps = ComponentProps<typeof CollapsibleContent>;

export const ChainOfThoughtContent = memo(function ChainOfThoughtContent({
  children,
  className,
  ...props
}: ChainOfThoughtContentProps) {
  const { isOpen } = useChainOfThought();
  return <Collapsible open={isOpen}>
    <CollapsibleContent
      className={cn(
        "mt-1 space-y-2 text-popover-foreground outline-none data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=closed]:animate-out data-[state=open]:slide-in-from-top-2 data-[state=open]:animate-in",
        className,
      )}
      {...props}
    >
      {children}
    </CollapsibleContent>
  </Collapsible>;
});
