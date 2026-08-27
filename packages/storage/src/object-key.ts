const DEMO_OBJECT_KEY_PATTERN = /^tenant\/demo\/project\/demo\/(?:source|derived|render|temp)\/[\p{L}\p{N}/ _\-.]+$/u;

export const assertSafeObjectKey = (objectKey: string): string => {
  if (!DEMO_OBJECT_KEY_PATTERN.test(objectKey) || objectKey.includes("..")) {
    throw new Error("Object key does not match the demo tenant/project namespace.");
  }
  return objectKey;
};
