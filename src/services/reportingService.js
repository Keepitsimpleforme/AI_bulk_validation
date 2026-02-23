import fs from "node:fs/promises";
import path from "node:path";
import { stringify } from "csv-stringify/sync";
import { db } from "../lib/db.js";

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

export const generateValidationResultsCSV = async (runId, baseDir = "outputs") => {
  const runResult = await db.query("SELECT * FROM runs WHERE run_id = $1", [runId]);
  const run = runResult.rows[0];
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const dateKey = run.start_time.toISOString().slice(0, 10);
  const outDir = path.join(baseDir, dateKey, "runs", String(runId));
  await ensureDir(outDir);

  const results = await db.query(
    `SELECT 
      gtin,
      validation_status,
      reasons,
      schema_valid,
      business_valid,
      created_at
     FROM validation_results
     WHERE run_id = $1
     ORDER BY created_at ASC`,
    [runId]
  );

  const rows = results.rows.map((r) => ({
    gtin: r.gtin,
    validation_status: r.validation_status,
    reasons: Array.isArray(r.reasons) ? r.reasons.join("; ") : String(r.reasons ?? ""),
    schema_valid: r.schema_valid ? "Yes" : "No",
    business_valid: r.business_valid ? "Yes" : "No",
    validated_at: r.created_at ? new Date(r.created_at).toISOString() : ""
  }));

  const csvPath = path.join(outDir, `validation_results_${runId}.csv`);
  const csv = stringify(rows, { header: true });
  await fs.writeFile(csvPath, csv);

  return { csvPath, recordCount: rows.length };
};

export const generateRunReport = async (runId, baseDir = "outputs") => {
  const runResult = await db.query("SELECT * FROM runs WHERE run_id = $1", [runId]);
  const run = runResult.rows[0];
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const dateKey = run.start_time.toISOString().slice(0, 10);
  const outDir = path.join(baseDir, dateKey, "runs", String(runId));
  await ensureDir(outDir);

  const report = {
    run_id: run.run_id,
    status: run.status,
    status_filter: run.status_filter,
    from: run.from_date,
    to: run.to_date,
    start_time: run.start_time,
    end_time: run.end_time,
    pages_fetched: run.pages_fetched,
    items_fetched: run.items_fetched,
    schema_invalid: run.schema_invalid,
    validated: run.validated_count,
    accepted: run.accepted_count,
    rejected: run.rejected_count,
    delivered: run.delivered_count,
    delivery_failed: run.delivery_failed_count
  };

  const jsonPath = path.join(outDir, `run_report_${runId}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  const csvPath = path.join(outDir, `run_report_${runId}.csv`);
  const csv = stringify([report], { header: true });
  await fs.writeFile(csvPath, csv);

  const { csvPath: resultsCsvPath } = await generateValidationResultsCSV(runId, baseDir);

  return { report, jsonPath, csvPath, resultsCsvPath };
};

export const generateDailySummary = async (date, baseDir = "outputs") => {
  const result = await db.query(
    `SELECT
      $1::date as report_date,
      COUNT(*) FILTER (WHERE status = 'RUNNING') AS runs_running,
      COUNT(*) FILTER (WHERE status = 'SUCCESS') AS runs_success,
      COUNT(*) FILTER (WHERE status IN ('FAILED', 'PARTIAL_FAILED')) AS runs_failed,
      COALESCE(SUM(items_fetched), 0) AS total_items_fetched,
      COALESCE(SUM(validated_count), 0) AS total_validated,
      COALESCE(SUM(accepted_count), 0) AS total_accepted,
      COALESCE(SUM(rejected_count), 0) AS total_rejected,
      COALESCE(SUM(delivered_count), 0) AS total_delivered,
      COALESCE(SUM(delivery_failed_count), 0) AS total_delivery_failed
     FROM runs
     WHERE DATE(start_time) = $1::date`,
    [date]
  );
  const summary = result.rows[0];
  const outDir = path.join(baseDir, date);
  await ensureDir(outDir);

  const jsonPath = path.join(outDir, `daily_summary_${date}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(summary, null, 2));
  const csvPath = path.join(outDir, `daily_summary_${date}.csv`);
  await fs.writeFile(csvPath, stringify([summary], { header: true }));
  return { summary, jsonPath, csvPath };
};
