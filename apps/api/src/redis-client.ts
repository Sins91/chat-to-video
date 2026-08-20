import { Logger, type LoggerService } from "@nestjs/common";
import { Redis, type RedisOptions } from "ioredis";

import { findInfrastructureErrorCode } from "./infrastructure-error.js";

const REDIS_ERROR_LOG_INTERVAL_MS = 30_000;

export const observeRedisErrors = (
  client: Redis,
  owner: string,
  connectionName: string,
  logger: Pick<LoggerService, "warn"> = new Logger(owner),
): Redis => {
  let lastLoggedAt = 0;
  client.on("error", (error: unknown) => {
    const now = Date.now();
    if (now - lastLoggedAt < REDIS_ERROR_LOG_INTERVAL_MS) return;
    lastLoggedAt = now;
    logger.warn({
      message: "Redis connection interrupted; the client will reconnect automatically.",
      connectionName,
      code: findInfrastructureErrorCode(error) ?? "UNKNOWN",
    });
  });
  return client;
};

export const createObservedRedisClient = (
  redisUrl: string,
  owner: string,
  connectionName: string,
  options: RedisOptions,
): Redis => observeRedisErrors(
  new Redis(redisUrl, { ...options, connectionName }),
  owner,
  connectionName,
);
