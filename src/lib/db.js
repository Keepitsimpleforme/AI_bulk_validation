import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const db = new Pool({
  connectionString: config.databaseUrl
});

export const withTx = async (work) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
