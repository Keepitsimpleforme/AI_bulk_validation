import { randomUUID } from "node:crypto";
import { db } from "../lib/db.js";

export const saveIdempotencyKeys = async (items) => {
  if (!items.length) {
    return;
  }
  for (const item of items) {
    await db.query(
      `INSERT INTO idempotency_keys(idempotency_key, run_id, batch_id, status)
       VALUES($1, $2, $3, $4)
       ON CONFLICT(idempotency_key) DO NOTHING`,
      [item.idempotencyKey, item.runId, item.batchId, item.status]
    );
  }
};

export const createOutboxRecord = async ({ runId, batchId, payload, errorText, nextRetryAt }) => {
  await db.query(
    `INSERT INTO delivery_outbox(outbox_id, run_id, batch_id, payload, attempts, next_retry_at, status, last_error, updated_at)
     VALUES($1, $2, $3, $4::jsonb, 1, $5, 'PENDING', $6, NOW())`,
    [randomUUID(), runId, batchId, JSON.stringify(payload), nextRetryAt, errorText]
  );
};

export const getDueOutboxRecords = async (limit = 100) => {
  const { rows } = await db.query(
    `SELECT * FROM delivery_outbox
     WHERE status = 'PENDING' AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
};

export const markOutboxDelivered = async (outboxId) => {
  await db.query(
    "UPDATE delivery_outbox SET status = 'DELIVERED', updated_at = NOW() WHERE outbox_id = $1",
    [outboxId]
  );
};

export const updateOutboxRetry = async (outboxId, attempts, nextRetryAt, errorText) => {
  await db.query(
    `UPDATE delivery_outbox
     SET attempts = $2, next_retry_at = $3, last_error = $4, updated_at = NOW()
     WHERE outbox_id = $1`,
    [outboxId, attempts, nextRetryAt, errorText]
  );
};
