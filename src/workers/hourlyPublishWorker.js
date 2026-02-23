/**
 * Publishes cumulative validated results for the day to an external downstream URL every hour.
 * Payload: all validated rows for today (IST) in format GTIN_number, Status, Reason, Date.
 * Run via PM2 cron (e.g. 0 * * * *) or standalone.
 */

import axios from "axios";
import { config } from "../config.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { getValidationResultsForDate } from "../repositories/validationRepository.js";

function getTodayIST() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toHourlyRow(r, dateKey) {
  return {
    GTIN_number: r.gtin ?? "",
    Status: r.validation_status ?? "",
    Reason: Array.isArray(r.reasons) ? r.reasons.join("; ") : String(r.reasons ?? ""),
    Date: dateKey
  };
}

async function runHourlyPublish() {
  const url = config.hourlyPublishUrl;
  if (!url) {
    logger.debug("HOURLY_PUBLISH_URL not set; skipping hourly publish");
    return;
  }

  const dateKey = getTodayIST();
  const rows = await getValidationResultsForDate(dateKey);
  const data = rows.map((r) => toHourlyRow(r, dateKey));
  const payload = { data };

  if (data.length === 0) {
    logger.info({ dateKey }, "hourly publish: no validated results for today");
    return;
  }

  try {
    await axios.put(url, payload, {
      timeout: config.hourlyPublishTimeoutMs,
      headers: { "Content-Type": "application/json" }
    });
    logger.info({ dateKey, count: data.length, url }, "hourly publish completed");
  } catch (err) {
    logger.error(
      { err: err.message, status: err.response?.status, dateKey, count: data.length, url },
      "hourly publish failed"
    );
    throw err;
  }
}

async function main() {
  try {
    await runHourlyPublish();
    await db.end();
    process.exit(0);
  } catch (error) {
    await db.end();
    process.exit(1);
  }
}

main();
