/**
 * Diagnose runs for a date: result_per_page, pages_fetched, items_fetched.
 * Helps understand why ingestion may have fewer items than page-number API.
 *
 * Usage: node src/scripts/diagnoseRuns.js 2026-02-24
 */

import { db } from "../lib/db.js";
import dotenv from "dotenv";

dotenv.config();

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

async function main() {
  const { rows } = await db.query(
    `SELECT run_id, result_per_page, pages_fetched, items_fetched, ingestion_completed, start_time
     FROM runs
     WHERE DATE(start_time AT TIME ZONE 'Asia/Kolkata') = $1::date
     ORDER BY start_time`,
    [date]
  );

  console.log(`\nRuns for ${date}:\n`);
  if (rows.length === 0) {
    console.log("  No runs found.");
    await db.end();
    return;
  }

  let totalFetched = 0;
  for (const r of rows) {
    totalFetched += Number(r.items_fetched || 0);
    console.log(`  run_id: ${r.run_id}`);
    console.log(`    result_per_page: ${r.result_per_page}`);
    console.log(`    pages_fetched: ${r.pages_fetched}, items_fetched: ${r.items_fetched}`);
    console.log(`    ingestion_completed: ${r.ingestion_completed}`);
    console.log(`    start_time: ${r.start_time}`);
    console.log("");
  }

  const { rows: vr } = await db.query(
    `SELECT COUNT(DISTINCT gtin) as unique_gtins
     FROM validation_results vr
     JOIN runs r ON r.run_id = vr.run_id
     WHERE DATE(r.start_time AT TIME ZONE 'Asia/Kolkata') = $1::date`,
    [date]
  );

  console.log("─ Summary ─");
  console.log(`  Total items_fetched (sum): ${totalFetched}`);
  console.log(`  Unique GTINs in validation_results: ${vr[0]?.unique_gtins ?? 0}`);
  console.log(`  Page-number API (verifyCoverage): ~12,250 unique`);
  console.log("");
  console.log("  If items_fetched is low, cursor mode with result_per_page:100 may be failing.");
  console.log("  Try result_per_page: 10 for new runs.");
  console.log("");

  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
