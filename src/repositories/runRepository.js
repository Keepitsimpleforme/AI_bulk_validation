import { db } from "../lib/db.js";

export const createRun = async ({ runId, statusFilter, from, to, resultPerPage }) => {
  const query = `
    INSERT INTO runs (run_id, status, status_filter, from_date, to_date, result_per_page)
    VALUES ($1, 'RUNNING', $2, $3, $4, $5)
    RETURNING *;
  `;
  const { rows } = await db.query(query, [runId, statusFilter, from, to, resultPerPage]);
  return rows[0];
};

export const getRun = async (runId) => {
  const { rows } = await db.query("SELECT * FROM runs WHERE run_id = $1", [runId]);
  return rows[0] ?? null;
};

export const updateRunStatus = async (runId, status) => {
  const endTime = status === "RUNNING" ? null : new Date();
  const { rows } = await db.query(
    "UPDATE runs SET status = $2, end_time = COALESCE($3, end_time) WHERE run_id = $1 RETURNING *",
    [runId, status, endTime]
  );
  return rows[0] ?? null;
};

export const incrementRunCounters = async (runId, counters) => {
  const fields = Object.keys(counters);
  if (fields.length === 0) {
    return;
  }

  const updates = fields
    .map((field, index) => `${field} = ${field} + $${index + 2}`)
    .join(", ");
  const values = [runId, ...fields.map((f) => counters[f])];
  await db.query(`UPDATE runs SET ${updates} WHERE run_id = $1`, values);
};

export const upsertCheckpoint = async (runId, sourcePageSeq, cursorIn, cursorOut) => {
  const query = `
    INSERT INTO run_checkpoints(run_id, source_page_seq, cursor_in, cursor_out, updated_at)
    VALUES($1, $2, $3, $4, NOW())
    ON CONFLICT (run_id)
    DO UPDATE SET
      source_page_seq = EXCLUDED.source_page_seq,
      cursor_in = EXCLUDED.cursor_in,
      cursor_out = EXCLUDED.cursor_out,
      updated_at = NOW()
    RETURNING *;
  `;
  const { rows } = await db.query(query, [runId, sourcePageSeq, cursorIn, cursorOut]);
  return rows[0];
};

export const getCheckpoint = async (runId) => {
  const { rows } = await db.query("SELECT * FROM run_checkpoints WHERE run_id = $1", [runId]);
  return rows[0] ?? null;
};

export const insertBatchEvent = async (event) => {
  await db.query(
    `INSERT INTO batch_events(batch_id, run_id, source_page_seq, items_count, cursor_in, cursor_out, event_type)
     VALUES($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.batchId,
      event.runId,
      event.sourcePageSeq,
      event.itemsCount,
      event.cursorIn,
      event.cursorOut,
      event.eventType
    ]
  );
};

export const markIngestionCompleted = async (runId) => {
  await db.query("UPDATE runs SET ingestion_completed = TRUE WHERE run_id = $1", [runId]);
};

/**
 * Marks run as SUCCESS when ingestion and validation are complete.
 * Delivery is optional—runs complete without waiting for delivery so the scheduler
 * can start new runs frequently. Delivery (DOWNSTREAM_URL) still runs when configured.
 */
export const tryFinalizeRun = async (runId) => {
  const { rows } = await db.query(
    `UPDATE runs
     SET status = 'SUCCESS', end_time = NOW()
     WHERE run_id = $1
       AND status = 'RUNNING'
       AND ingestion_completed = TRUE
       AND validated_count = items_fetched
     RETURNING *`,
    [runId]
  );
  return rows[0] ?? null;
};
