import { db } from "../lib/db.js";

export const insertValidationResults = async (records) => {
  if (!records.length) {
    return;
  }
  const values = [];
  const placeholders = records
    .map((record, index) => {
      const base = index * 7;
      values.push(
        record.runId,
        record.batchId,
        record.gtin,
        record.validationStatus,
        JSON.stringify(record.reasons ?? []),
        record.schemaValid,
        record.businessValid
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7})`;
    })
    .join(", ");

  await db.query(
    `INSERT INTO validation_results(run_id, batch_id, gtin, validation_status, reasons, schema_valid, business_valid)
     VALUES ${placeholders}`,
    values
  );
};

/**
 * All validation results for runs that started on the given date (IST).
 * Used for hourly cumulative publish to downstream.
 */
export const getValidationResultsForDate = async (dateYyyyMmDd) => {
  const result = await db.query(
    `SELECT vr.gtin, vr.validation_status, vr.reasons
     FROM validation_results vr
     JOIN runs r ON r.run_id = vr.run_id
     WHERE DATE(r.start_time AT TIME ZONE 'Asia/Kolkata') = $1::date
     ORDER BY vr.created_at ASC`,
    [dateYyyyMmDd]
  );
  return result.rows;
};
