import fs from "node:fs/promises";
import path from "node:path";
import { stringify } from "csv-stringify/sync";

const GTINS_CSV_HEADER = ["GTIN_number", "Status", "Reason", "Date"];

/**
 * Append validated batch rows to the daily gtins CSV.
 * File: {baseDir}/{dateKey}/gtins_{dateKey}.csv
 * Columns: GTIN_number, Status, Reason, Date
 * Append-only per batch; creates file with header on first write.
 */
export const appendToGtinsCsv = async (dateKey, records, baseDir = "outputs") => {
  if (!dateKey || !records?.length) return;
  const dir = path.join(baseDir, dateKey);
  await fs.mkdir(dir, { recursive: true });
  const filename = `gtins_${dateKey}.csv`;
  const filePath = path.join(dir, filename);

  const rows = records.map((r) => ({
    GTIN_number: r.gtin ?? "",
    Status: r.validationStatus ?? "",
    Reason: Array.isArray(r.reasons) ? r.reasons.join("; ") : String(r.reasons ?? ""),
    Date: dateKey
  }));

  const csvRows = stringify(rows, { header: false, quoted: true });
  let exists = false;
  try {
    await fs.access(filePath);
    exists = true;
  } catch {
    /* file does not exist */
  }

  if (exists) {
    await fs.appendFile(filePath, csvRows);
  } else {
    const headerLine = GTINS_CSV_HEADER.join(",") + "\n";
    await fs.writeFile(filePath, headerLine + csvRows);
  }
};

/**
 * Save one batch's validation records to outputs for verification.
 * File: {baseDir}/{dateKey}/batches/{runId}_{batchId}.json
 * Each record: { GTIN_number, Status, Reason, Date }
 */
export const saveBatchValidationRecords = async (dateKey, runId, batchId, records, baseDir = "outputs") => {
  if (!dateKey || !runId || !batchId || !records?.length) return;
  const dir = path.join(baseDir, dateKey, "batches");
  await fs.mkdir(dir, { recursive: true });
  const rows = records.map((r) => ({
    GTIN_number: r.gtin ?? "",
    Status: r.validationStatus ?? "",
    Reason: Array.isArray(r.reasons) ? r.reasons.join("; ") : String(r.reasons ?? ""),
    Date: dateKey
  }));
  const filePath = path.join(dir, `${runId}_${batchId}.json`);
  await fs.writeFile(filePath, JSON.stringify(rows, null, 2));
};
