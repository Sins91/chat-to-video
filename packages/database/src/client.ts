import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import * as schema from "./schema.js";

export const DATABASE_POOL_OPTIONS = Object.freeze({
  connectionLimit: 10,
  maxIdle: 2,
  idleTimeout: 30_000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export const createDatabase = (databaseUrl: string) => {
  const pool = mysql.createPool({ uri: databaseUrl, ...DATABASE_POOL_OPTIONS });
  return drizzle({ client: pool, schema, mode: "default" });
};

export type Database = ReturnType<typeof createDatabase>;
