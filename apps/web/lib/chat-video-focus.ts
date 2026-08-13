export interface ChatVideoFocusBounds {
  readonly currentScrollTop: number;
  readonly maximumScrollTop: number;
  readonly targetBottom: number;
  readonly targetTop: number;
  readonly viewportHeight: number;
}

export const getChatVideoFocusScrollTop = (
  bounds: ChatVideoFocusBounds,
  paddingPx = 24,
): number => {
  const visibleTop = bounds.currentScrollTop + paddingPx;
  const visibleBottom = bounds.currentScrollTop + bounds.viewportHeight - paddingPx;
  let nextScrollTop = bounds.currentScrollTop;

  if (bounds.targetTop < visibleTop) {
    nextScrollTop = bounds.targetTop - paddingPx;
  } else if (bounds.targetBottom > visibleBottom) {
    nextScrollTop = bounds.targetBottom - bounds.viewportHeight + paddingPx;
  }

  return Math.min(Math.max(0, nextScrollTop), Math.max(0, bounds.maximumScrollTop));
};
