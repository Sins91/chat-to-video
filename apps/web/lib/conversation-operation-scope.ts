// Tracks UI ownership only; invalidation never cancels a server request.
export const createConversationOperationScope = () => {
  let generation = 0;
  const latest = new Map<string, object>();
  const capture = (): (() => boolean) => {
    const capturedGeneration = generation;
    return () => generation === capturedGeneration;
  };
  return {
    capture,
    start: (key: string): (() => boolean) => {
      const isGenerationCurrent = capture();
      const token = {};
      latest.set(key, token);
      return () => isGenerationCurrent() && latest.get(key) === token;
    },
    invalidate: (key?: string): void => {
      if (key !== undefined) {
        latest.delete(key);
        return;
      }
      generation += 1;
      latest.clear();
    },
  };
};
