import { z } from "zod";

import { ConversationIdSchema, ConversationMessageIdSchema } from "./conversation.js";
import {
  MAX_REFERENCE_IMAGES_PER_MESSAGE,
  ReferenceImageViewSchema,
} from "./reference-image.js";
import { VideoModelSchema } from "./video-workflow-common.js";

export const PERSISTED_CHAT_QUEUE_VERSION = 1 as const;

export const PersistedChatQueueReferenceImageSchema = ReferenceImageViewSchema.pick({
  id: true,
  fileName: true,
  mimeType: true,
});

export const PersistedChatQueueItemStatusSchema = z.enum([
  "queued",
  "dispatching",
  "failed",
]);

export const PersistedChatQueueItemSchema = z.object({
  version: z.literal(PERSISTED_CHAT_QUEUE_VERSION),
  id: z.string().uuid(),
  messageId: ConversationMessageIdSchema,
  conversationId: ConversationIdSchema,
  text: z.string().trim().max(8_000),
  referenceImages: z.array(PersistedChatQueueReferenceImageSchema)
    .max(MAX_REFERENCE_IMAGES_PER_MESSAGE),
  videoModel: VideoModelSchema,
  subtitlesEnabled: z.boolean(),
  status: PersistedChatQueueItemStatusSchema,
  attemptCount: z.number().int().nonnegative().max(100),
  nextAttemptAt: z.string().datetime({ offset: true }).nullable(),
  errorMessage: z.string().trim().min(1).max(500).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((item, context) => {
  if (!item.text && item.referenceImages.length === 0) {
    context.addIssue({
      code: "custom",
      message: "A persisted chat queue item requires text or a reference image.",
      path: ["text"],
    });
  }
});

export const PersistedChatQueueSchema = z.object({
  version: z.literal(PERSISTED_CHAT_QUEUE_VERSION),
  items: z.array(PersistedChatQueueItemSchema).max(500),
}).strict();

export type PersistedChatQueueItem = z.infer<typeof PersistedChatQueueItemSchema>;
export type PersistedChatQueue = z.infer<typeof PersistedChatQueueSchema>;
