// publish daily cumulative results to dashboard and main app every hour

import axios from "axios";
import { config } from "../config.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { getValidationResultsForMainAppExport } from "../repositories/validationRepository.js";
import { rowToMainAppCsvRow } from "../services/mainAppCsvService.js";

function getTodayIST() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const sendPut = async (url, payload) => {
  await axios.put(url, payload, {
    timeout: config.hourlyPublishTimeoutMs,
    headers: { "Content-Type": "application/json" }
  });
};

async function runHourlyPublish() {
  const dashboardUrl = config.hourlyPublishUrl;
  const mainAppUrl = config.mainAppPublishUrl;
  if (!dashboardUrl && !mainAppUrl) {
    logger.debug("HOURLY_PUBLISH_URL and MAIN_APP_PUBLISH_URL not set; skipping hourly publish");
    return;
  }

  const dateKey = process.argv[2] || getTodayIST();
  const rows = await getValidationResultsForMainAppExport(dateKey);

  // dedup by gtin to keep the richest payload over blanks
  const byGtin = new Map();
  for (const row of rows) {
    const snapshot = row.product_snapshot;
    const keyCount =
      snapshot && typeof snapshot === "object" ? Object.keys(snapshot).length : 0;
    const existing = byGtin.get(row.gtin);
    if (!existing || keyCount > existing.keyCount) {
      byGtin.set(row.gtin, { row, keyCount });
    }
  }
  const dedupedRows = [...byGtin.values()].map((v) => v.row);

  const data = dedupedRows.map((row) => rowToMainAppCsvRow(row));
  const payload = { data };

  if (rows.length !== dedupedRows.length) {
    logger.info(
      { dateKey, rowsBefore: rows.length, uniqueGtins: dedupedRows.length },
      "hourly publish: deduped by GTIN"
    );
  }

  if (data.length === 0) {
    logger.info({ dateKey }, "hourly publish: no validated results for today");
    return;
  }

  // chunk payloads to avoid dashboard 504 timeouts
  const CHUNK_SIZE = 5000;
  const chunks = [];
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    chunks.push(data.slice(i, i + CHUNK_SIZE));
  }

  if (dashboardUrl) {
    try {
      for (const [idx, chunk] of chunks.entries()) {
        await sendPut(dashboardUrl, { data: chunk });
        logger.info({ dateKey, chunk: idx + 1, totalChunks: chunks.length, count: chunk.length, url: dashboardUrl }, "hourly publish (dashboard) chunk completed");
      }
      logger.info({ dateKey, count: data.length, url: dashboardUrl }, "hourly publish (dashboard) fully completed");
    } catch (err) {
      logger.error(
        { err: err.message, status: err.response?.status, dateKey, count: data.length, url: dashboardUrl },
        "hourly publish (dashboard) failed"
      );
      throw err;
    }
  }

  if (mainAppUrl) {
    try {
      for (const [idx, chunk] of chunks.entries()) {
        await sendPut(mainAppUrl, { data: chunk });
        logger.info({ dateKey, chunk: idx + 1, totalChunks: chunks.length, count: chunk.length, url: mainAppUrl }, "hourly publish (main app) chunk completed");
      }
      logger.info({ dateKey, count: data.length, url: mainAppUrl }, "hourly publish (main app) fully completed");
    } catch (err) {
      logger.error(
        { err: err.message, status: err.response?.status, dateKey, count: data.length, url: mainAppUrl },
        "hourly publish (main app) failed"
      );
      throw err;
    }
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
