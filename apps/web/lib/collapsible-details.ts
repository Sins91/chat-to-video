import type { MouseEvent } from "react";

const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, [role='button'], [role='link']";

export const collapseExpandedDetails = (event: MouseEvent<HTMLElement>): void => {
  const target = event.target;
  if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return;
  const details = event.currentTarget.closest("details");
  if (details?.open) details.open = false;
};
