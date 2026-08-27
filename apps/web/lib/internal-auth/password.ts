import { createHash, timingSafeEqual } from "node:crypto";

export const passwordsMatch = (received: string, expected: string): boolean => {
  const receivedDigest = createHash("sha256").update(received, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
};
