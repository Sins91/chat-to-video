import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

const DEMO_TENANT_ID = "demo";
const DEMO_PROJECT_ID = "demo";
const DEFAULT_DATABASE_URL = "mysql://chat_to_video:chat_to_video@localhost:4002/chat_to_video";

const atLocalMiddayDaysAgo = (now, daysAgo) => {
  const value = new Date(now);
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() - daysAgo);
  return value;
};

export const buildConversationHistorySeeds = (now = new Date()) => [
  {
    id: "10000000-0000-4000-8000-000000000001",
    title: "今天的产品定位讨论",
    createdAt: atLocalMiddayDaysAgo(now, 0),
    question: "这个产品适合哪些用户？",
    answer: "适合希望快速把想法整理成视频方案的创作者。",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    title: "昨天的文案建议",
    createdAt: atLocalMiddayDaysAgo(now, 1),
    question: "标题怎样写得更简洁？",
    answer: "保留核心对象和结果，删去重复的修饰词。",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    title: "本周的画面风格讨论",
    createdAt: atLocalMiddayDaysAgo(now, 3),
    question: "这段内容适合什么画面风格？",
    answer: "可以使用自然光和克制配色，保持画面清晰温和。",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    title: "更早的脚本结构讨论",
    createdAt: atLocalMiddayDaysAgo(now, 14),
    question: "短视频脚本应该怎样展开？",
    answer: "先说明问题，再给出解决方法，最后用一句话收束。",
  },
];

const loadEnvironment = () => {
  const requestedEnvironmentFile = process.env.ENV_FILE?.trim();
  const environmentFile = requestedEnvironmentFile
    ? resolve(process.cwd(), requestedEnvironmentFile)
    : resolve(import.meta.dirname, "../../..", ".env.local");
  if (existsSync(environmentFile)) loadEnvFile(environmentFile);
};

const seedConversationHistory = async () => {
  loadEnvironment();
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL,
    connectionLimit: 1,
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const seed of buildConversationHistorySeeds()) {
      const assistantCreatedAt = new Date(seed.createdAt.getTime() + 60_000);
      await connection.execute(
        `INSERT INTO conversations
          (id, tenant_id, project_id, title, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
          tenant_id = VALUES(tenant_id),
          project_id = VALUES(project_id),
          title = VALUES(title),
          deleted_at = NULL,
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at)`,
        [seed.id, DEMO_TENANT_ID, DEMO_PROJECT_ID, seed.title, seed.createdAt, assistantCreatedAt],
      );
      await connection.execute(
        `INSERT INTO conversation_messages
          (conversation_id, message_id, role, content, created_at)
         VALUES (?, ?, 'user', ?, ?)
         ON DUPLICATE KEY UPDATE
          role = VALUES(role), content = VALUES(content), created_at = VALUES(created_at)`,
        [seed.id, `history-seed-${seed.id}-user`, seed.question, seed.createdAt],
      );
      await connection.execute(
        `INSERT INTO conversation_messages
          (conversation_id, message_id, role, content, created_at)
         VALUES (?, ?, 'assistant', ?, ?)
         ON DUPLICATE KEY UPDATE
          role = VALUES(role), content = VALUES(content), created_at = VALUES(created_at)`,
        [seed.id, `history-seed-${seed.id}-assistant`, seed.answer, assistantCreatedAt],
      );
    }
    await connection.commit();
    process.stdout.write("Seeded 4 one-turn conversations across all history groups.\n");
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
};

const isMainModule = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (isMainModule) await seedConversationHistory();
