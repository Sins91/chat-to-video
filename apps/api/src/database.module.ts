import { Module } from "@nestjs/common";
import { ConversationRepository, createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";

import { loadDatabaseUrl } from "./video-workflow/video-workflow.config.js";
import { CONVERSATION_REPOSITORY, VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow/video-workflow.tokens.js";

const DATABASE = Symbol("DATABASE");

@Module({
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(loadDatabaseUrl()) },
    { provide: CONVERSATION_REPOSITORY, useFactory: (database: ReturnType<typeof createDatabase>) => new ConversationRepository(database), inject: [DATABASE] },
    { provide: VIDEO_WORKFLOW_REPOSITORY, useFactory: (database: ReturnType<typeof createDatabase>) => new VideoWorkflowRepository(database), inject: [DATABASE] },
  ],
  exports: [CONVERSATION_REPOSITORY, VIDEO_WORKFLOW_REPOSITORY],
})
export class DatabaseModule {}
