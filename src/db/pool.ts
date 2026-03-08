import pg from "pg";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

pool.on("error", (err) => {
  logger.error("db", "Erro no pool de conexão:", err.message);
});
