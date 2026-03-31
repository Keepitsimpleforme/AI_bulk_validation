// send today's validated data to the main app as full csv
// runs every hour

import axios from "axios";
import { config } from "../config.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { getValidationResultsForMainAppExport } from "../repositories/validationRepository.js";
import { buildMainAppCsv } from "../services/mainAppCsvService.js";

function getTodayIST() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = ist.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function runMainAppCsv() {
  const url = config.mainAppCsvUrl;
  if (!url) {
    logger.debug("MAIN_APP_CSV_URL not set; skipping main-app CSV send");
    return;
  }

  const dateKey = getTodayIST();
  const rows = await getValidationResultsForMainAppExport(dateKey);

  if (rows.length === 0) {
    logger.info({ dateKey }, "main-app CSV: no validated results for today");
    return;
  }

  const csv = buildMainAppCsv(rows);

  try {
    await axios.post(url, csv, {
      timeout: config.mainAppCsvTimeoutMs,
      headers: { "Content-Type": "text/csv" },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    logger.info({ dateKey, count: rows.length, url }, "main-app CSV sent");
  } catch (err) {
    logger.error(
      { err: err.message, status: err.response?.status, dateKey, count: rows.length, url },
      "main-app CSV send failed"
    );
    throw err;
  }
}

async function main() {
  try {
    await runMainAppCsv();
    await db.end();
    process.exit(0);
  } catch (error) {
    await db.end();
    process.exit(1);
  }
}

main();
