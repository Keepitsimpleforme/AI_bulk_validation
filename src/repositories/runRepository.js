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

/**
 * Get the last run's cursor_out for the given date (any status).
 * Used when creating a new run to continue from where the previous run left off.
 * Only uses cursor from runs that fetched items AND did not complete (cursor still useful).
 * Skips: items_fetched=0, or ingestion_completed=true (cursor is "end of stream" → returns 0 items).
 */
export const getLastRunCheckpointForDate = async (date) => {
  const dateStr = String(date).slice(0, 10);
  const query = `
    SELECT rc.cursor_out
    FROM runs r
    JOIN run_checkpoints rc ON rc.run_id = r.run_id
    WHERE r.from_date::text LIKE $1 || '%'
      AND rc.cursor_out IS NOT NULL
      AND r.items_fetched > 0
      AND (r.ingestion_completed = FALSE OR r.ingestion_completed IS NULL)
    ORDER BY r.start_time DESC
    LIMIT 1
  `;
  const { rows } = await db.query(query, [dateStr]);
  if (rows[0]?.cursor_out) return rows[0].cursor_out;
  const fallbackQuery = `
    SELECT be.cursor_out
    FROM runs r
    JOIN batch_events be ON be.run_id = r.run_id
    WHERE r.from_date::text LIKE $1 || '%'
      AND be.cursor_out IS NOT NULL
      AND r.items_fetched > 0
      AND (r.ingestion_completed = FALSE OR r.ingestion_completed IS NULL)
    ORDER BY r.start_time DESC, be.source_page_seq DESC
    LIMIT 1
  `;
  const { rows: fallbackRows } = await db.query(fallbackQuery, [dateStr]);
  return fallbackRows[0]?.cursor_out ?? null;
};

/**
 * Find a run for the given date that can be resumed (ingestion incomplete, has checkpoint).
 * Used by scheduler to resume instead of creating a new run.
 */
export const getResumableRunForDate = async (date) => {
  const query = `
    SELECT r.run_id, r.status, r.status_filter, r.from_date, r.to_date, r.result_per_page
    FROM runs r
    WHERE r.from_date::text LIKE $1 || '%'
      AND r.status IN ('RUNNING', 'PARTIAL_FAILED')
      AND r.ingestion_completed = FALSE
      AND EXISTS (
        SELECT 1 FROM run_checkpoints rc
        WHERE rc.run_id = r.run_id AND rc.cursor_out IS NOT NULL
      )
    ORDER BY r.start_time DESC
    LIMIT 1
  `;
  const { rows } = await db.query(query, [date]);
  if (rows[0]) return rows[0];
  // Fallback: run_checkpoints might be empty but batch_events has cursor
  const fallbackQuery = `
    SELECT r.run_id, r.status, r.status_filter, r.from_date, r.to_date, r.result_per_page
    FROM runs r
    JOIN batch_events be ON be.run_id = r.run_id
    WHERE r.from_date::text LIKE $1 || '%'
      AND r.status IN ('RUNNING', 'PARTIAL_FAILED')
      AND r.ingestion_completed = FALSE
      AND be.cursor_out IS NOT NULL
    ORDER BY r.start_time DESC, be.source_page_seq DESC
    LIMIT 1
  `;
  const { rows: fallbackRows } = await db.query(fallbackQuery, [date]);
  return fallbackRows[0] ?? null;
};

export const getCheckpoint = async (runId) => {
  let { rows } = await db.query("SELECT * FROM run_checkpoints WHERE run_id = $1", [runId]);
  if (rows[0]) return rows[0];
  const { rows: batchRows } = await db.query(
    `SELECT source_page_seq, cursor_in, cursor_out
     FROM batch_events WHERE run_id = $1 ORDER BY source_page_seq DESC LIMIT 1`,
    [runId]
  );
  if (!batchRows[0]) return null;
  const b = batchRows[0];
  return {
    run_id: runId,
    source_page_seq: b.source_page_seq,
    cursor_in: b.cursor_in,
    cursor_out: b.cursor_out,
    updated_at: null
  };
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
