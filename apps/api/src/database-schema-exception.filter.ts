import { Catch, HttpStatus, Inject, Injectable, Logger, type ArgumentsHost } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";

import { findTransientDatabaseErrorCode } from "./infrastructure-error.js";

const DATABASE_SCHEMA_ERROR_CODES = new Set([
  "ER_BAD_FIELD_ERROR",
  "ER_NO_SUCH_TABLE",
]);

const getCause = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "cause" in value
    ? value.cause
    : undefined;

export const findDatabaseSchemaErrorCode = (error: unknown): string | null => {
  let current = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) return null;
    visited.add(current);
    if ("code" in current && typeof current.code === "string" &&
        DATABASE_SCHEMA_ERROR_CODES.has(current.code)) {
      return current.code;
    }
    current = getCause(current);
  }
  return null;
};

@Catch()
@Injectable()
export class DatabaseSchemaExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(DatabaseSchemaExceptionFilter.name);

  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const databaseErrorCode = findDatabaseSchemaErrorCode(exception);
    const connectionErrorCode = findTransientDatabaseErrorCode(exception);
    if (connectionErrorCode) {
      this.logger.warn(`Database connection interrupted (${connectionErrorCode}).`);
      this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), {
        code: "DATABASE_TEMPORARILY_UNAVAILABLE",
        message: "服务器连接错误，请稍后重试。",
      }, HttpStatus.SERVICE_UNAVAILABLE);
      return;
    }
    if (!databaseErrorCode) {
      super.catch(exception, host);
      return;
    }

    this.logger.error(
      `Database schema mismatch detected (${databaseErrorCode}). Apply pending Drizzle migrations before serving requests.`,
    );
    this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), {
      code: "DATABASE_SCHEMA_OUTDATED",
      message: "Database schema is behind the application. Apply pending Drizzle migrations and restart the API.",
    }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
