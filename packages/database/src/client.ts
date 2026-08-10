import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import * as schema from "./schema.js";

export const createDatabase = (databaseUrl: string) => {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 10 });
  return drizzle({ client: pool, schema, mode: "default" });
};

export type Database = ReturnType<typeof createDatabase>;
