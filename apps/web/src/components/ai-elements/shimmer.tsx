"use client";

import { cn } from "@/lib/utils";
import type { MotionProps } from "motion/react";
import { motion, useReducedMotion } from "motion/react";
import type { ElementType, JSX } from "react";
import { memo } from "react";

type MotionHTMLProps = MotionProps & Record<string, unknown>;

// Cache motion components at module level to avoid creating during render
const motionComponentCache = new Map<
  keyof JSX.IntrinsicElements,
  React.ComponentType<MotionHTMLProps>
>();

const getMotionComponent = (element: keyof JSX.IntrinsicElements) => {
  let component = motionComponentCache.get(element);
  if (!component) {
    component = motion.create(element);
    motionComponentCache.set(element, component);
  }
  return component;
};

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
}: TextShimmerProps) => {
  const shouldReduceMotion = useReducedMotion();
  const MotionComponent = getMotionComponent(
    Component as keyof JSX.IntrinsicElements
  );

  return (
    <MotionComponent
      animate={{ backgroundPosition: shouldReduceMotion ? "50% 0" : ["100% 0", "0% 0"] }}
      className={cn(
        "relative inline-block bg-[linear-gradient(90deg,var(--muted-foreground)_0%,var(--muted-foreground)_35%,var(--foreground)_50%,var(--muted-foreground)_65%,var(--muted-foreground)_100%)] bg-[length:250%_100%] bg-clip-text text-transparent",
        className
      )}
      initial={{ backgroundPosition: "100% 0" }}
      transition={{
        duration: shouldReduceMotion ? 0 : duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </MotionComponent>
  );
};

export const Shimmer = memo(ShimmerComponent);
