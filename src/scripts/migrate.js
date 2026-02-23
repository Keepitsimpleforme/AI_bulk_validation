import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../migrations");

const ensureMigrationsTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

const run = async () => {
  await ensureMigrationsTable();
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const already = await db.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename]
    );
    if (already.rowCount > 0) {
      continue;
    }
    const fullPath = path.join(migrationsDir, filename);
    const sql = await fs.readFile(fullPath, "utf8");
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query("INSERT INTO schema_migrations(filename) VALUES($1)", [filename]);
      await db.query("COMMIT");
      logger.info({ filename }, "migration applied");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }
};

run()
  .then(() => {
    logger.info("migrations complete");
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ err: error }, "migration failed");
    process.exit(1);
  });
