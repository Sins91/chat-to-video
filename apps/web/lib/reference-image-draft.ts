type OwnedImage = { objectUrl: string | null; referenceImageId: string | null };

export const createReferenceImageDraft = (cleanup: {
  revokeObjectUrl: (url: string) => void;
  abandon: (referenceImageId: string) => void;
}) => {
  const images = new Map<string, OwnedImage>();
  let isDisposed = false;
  const revoke = (image: OwnedImage) => {
    if (image.objectUrl) cleanup.revokeObjectUrl(image.objectUrl);
    image.objectUrl = null;
  };
  const remove = (localId: string) => {
    const image = images.get(localId);
    if (!image) return;
    images.delete(localId);
    revoke(image);
    if (image.referenceImageId) cleanup.abandon(image.referenceImageId);
  };
  return {
    get size() { return images.size; },
    register: (localId: string, objectUrl: string): boolean => {
      if (isDisposed) { cleanup.revokeObjectUrl(objectUrl); return false; }
      images.set(localId, { objectUrl, referenceImageId: null });
      return true;
    },
    resolve: (localId: string, referenceImageId: string): boolean => {
      const image = images.get(localId);
      if (isDisposed || !image) {
        cleanup.abandon(referenceImageId);
        return false;
      }
      revoke(image);
      image.referenceImageId = referenceImageId;
      return true;
    },
    reject: (localId: string): boolean => {
      const image = images.get(localId);
      if (isDisposed || !image) return false;
      revoke(image);
      return true;
    },
    remove,
    // A successful submit transfers ownership to the message/queue.
    release: (): void => {
      for (const image of images.values()) revoke(image);
      images.clear();
    },
    dispose: (): void => {
      isDisposed = true;
      for (const localId of images.keys()) remove(localId);
    },
  };
};
