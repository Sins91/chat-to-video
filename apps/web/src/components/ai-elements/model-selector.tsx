"use client";

import type { ComponentProps, ReactNode } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const ModelSelector = (props: ComponentProps<typeof Dialog>) => <Dialog {...props} />;
export const ModelSelectorTrigger = (props: ComponentProps<typeof DialogTrigger>) => <DialogTrigger {...props} />;

export const ModelSelectorContent = ({
  children,
  className,
  title = "选择视频模型",
  ...props
}: ComponentProps<typeof DialogContent> & { title?: ReactNode }) => (
  <DialogContent className={cn("gap-0 overflow-hidden bg-[var(--card)] p-0 sm:max-w-md", className)} showCloseButton={false} {...props}>
    <DialogHeader className="sr-only">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>搜索并选择用于生成视频的模型</DialogDescription>
    </DialogHeader>
    <Command className="bg-inherit">{children}</Command>
  </DialogContent>
);

export const ModelSelectorInput = (props: ComponentProps<typeof CommandInput>) => <CommandInput {...props} />;
export const ModelSelectorList = (props: ComponentProps<typeof CommandList>) => <CommandList {...props} />;
export const ModelSelectorEmpty = (props: ComponentProps<typeof CommandEmpty>) => <CommandEmpty {...props} />;
export const ModelSelectorGroup = (props: ComponentProps<typeof CommandGroup>) => <CommandGroup {...props} />;
export const ModelSelectorItem = ({ className, ...props }: ComponentProps<typeof CommandItem>) => (
  <CommandItem
    className={cn(
      "data-selected:!bg-transparent hover:!bg-muted data-selected:hover:!bg-muted",
      className,
    )}
    {...props}
  />
);
export const ModelSelectorSeparator = (props: ComponentProps<typeof CommandSeparator>) => <CommandSeparator {...props} />;
export const ModelSelectorShortcut = (props: ComponentProps<typeof CommandShortcut>) => <CommandShortcut {...props} />;
export const ModelSelectorName = ({ className, ...props }: ComponentProps<"span">) => (
  <span className={cn("font-medium", className)} {...props} />
);
