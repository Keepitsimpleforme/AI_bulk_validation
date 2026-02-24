/**
 * Print one validation_result row's product_snapshot keys (and sample) so we can align CSV/dashboard mapping with GS1 response.
 * Run: node src/scripts/inspectProductSnapshot.js [date]
 * Or:  docker compose run --rm app node src/scripts/inspectProductSnapshot.js 2026-02-24
 */

import { db } from "../lib/db.js";

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

async function main() {
  const r = await db.query(
    `SELECT vr.gtin, vr.validation_status, vr.reasons, vr.product_snapshot
     FROM validation_results vr
     JOIN runs r ON r.run_id = vr.run_id
     WHERE DATE(r.start_time AT TIME ZONE 'Asia/Kolkata') = $1::date
     LIMIT 1`,
    [date]
  );
  const row = r.rows[0];
  if (!row) {
    console.log("No row for date:", date);
    await db.end();
    process.exit(0);
  }
  console.log("Sample row for date", date);
  console.log("gtin:", row.gtin);
  console.log("validation_status:", row.validation_status);
  console.log("product_snapshot is null?", row.product_snapshot == null);
  if (row.product_snapshot && typeof row.product_snapshot === "object") {
    console.log("product_snapshot keys:", Object.keys(row.product_snapshot).sort().join(", "));
    console.log("product_snapshot (sample):", JSON.stringify(row.product_snapshot, null, 2).slice(0, 1500));
  }
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
